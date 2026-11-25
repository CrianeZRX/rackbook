import Foundation

/// One shell script per poll, read straight from /proc. Nothing is installed on the server.
enum Collector {
    static let script = """
    export LC_ALL=C
    echo @@HOST; hostname 2>/dev/null; uname -r 2>/dev/null
    echo @@OS; ( . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" ) || uname -s
    echo @@NPROC; nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo
    echo @@UPTIME; cat /proc/uptime 2>/dev/null
    echo @@LOAD; cat /proc/loadavg 2>/dev/null
    echo @@STAT; grep '^cpu' /proc/stat 2>/dev/null
    echo @@MEM; cat /proc/meminfo 2>/dev/null
    echo @@NET; cat /proc/net/dev 2>/dev/null
    echo @@DF; df -PkT 2>/dev/null || df -Pk 2>/dev/null
    echo @@IO; cat /proc/diskstats 2>/dev/null
    echo @@PS; ps -eo pid=,user=,pcpu=,pmem=,rss=,comm= --sort=-pcpu 2>/dev/null | head -n 80
    echo @@TCP; cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '$4=="01"{n++} END{print n+0}'
    echo @@GPU; command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits 2>/dev/null
    echo @@AMD; for d in /sys/class/drm/card*/device; do [ -r "$d/gpu_busy_percent" ] && echo "$(basename "$(dirname "$d")") $(cat "$d/gpu_busy_percent") $(cat "$d/mem_info_vram_used" 2>/dev/null || echo 0) $(cat "$d/mem_info_vram_total" 2>/dev/null || echo 0)"; done
    echo @@DOCKER; command -v docker >/dev/null 2>&1 && echo yes
    echo @@END
    """

    static func sections(_ out: String) -> [String: [Substring]] {
        var d: [String: [Substring]] = [:]
        var cur = ""
        for line in out.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("@@") {
                cur = line.dropFirst(2).trimmingCharacters(in: .whitespaces)
                d[cur] = []
                continue
            }
            if !cur.isEmpty { d[cur, default: []].append(line) }
        }
        return d
    }

    static func ws(_ s: Substring) -> [Substring] {
        s.split(whereSeparator: { $0 == " " || $0 == "\t" })
    }

    static func isWholeDisk(_ n: String) -> Bool {
        n.range(of: #"^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme[0-9]+n[0-9]+|mmcblk[0-9]+)$"#,
                options: .regularExpression) != nil
    }

    static let skipTypes: Set<String> = [
        "tmpfs", "devtmpfs", "squashfs", "overlay", "efivarfs", "proc", "sysfs", "cgroup", "cgroup2",
        "nsfs", "fuse.lxcfs", "ramfs", "autofs", "devpts", "mqueue", "tracefs", "debugfs", "securityfs",
        "pstore", "bpf", "configfs", "fusectl", "hugetlbfs", "binfmt_misc", "rpc_pipefs", "shm"
    ]

    static let virtualIf = ["docker", "br-", "virbr", "cni", "flannel", "cali", "tun", "wg", "vnet", "kube"]

    static func build(_ out: String, prev: RawCounters?) -> (Snapshot, RawCounters)? {
        let d = sections(out)
        guard d["END"] != nil, d["STAT"] != nil else { return nil }
        let now = Date()
        var s = Snapshot()
        s.time = now
        let dt = prev.map { now.timeIntervalSince($0.time) } ?? 0

        let host = d["HOST"] ?? []
        s.hostname = host.first.map(String.init) ?? ""
        s.kernel = host.count > 1 ? String(host[1]) : ""
        s.os = d["OS"]?.first.map(String.init) ?? ""
        s.cores = Int(d["NPROC"]?.first?.trimmingCharacters(in: .whitespaces) ?? "") ?? 1
        if let u = d["UPTIME"]?.first, let v = ws(u).first { s.uptime = Double(v) ?? 0 }
        if let l = d["LOAD"]?.first {
            let f = ws(l)
            s.load = f.prefix(3).map { Double($0) ?? 0 }
            if f.count > 3 { s.procsRunning = String(f[3]) }
        }

        // CPU
        var cpu: [String: [UInt64]] = [:]
        for line in d["STAT"] ?? [] {
            let f = ws(line)
            guard f.count > 4 else { continue }
            cpu[String(f[0])] = f.dropFirst().map { UInt64($0) ?? 0 }
        }
        func busy(_ key: String) -> (Double, Double)? {
            guard let a = cpu[key], let b = prev?.cpu[key], a.count >= 5, b.count >= 5 else { return nil }
            let ta = a.prefix(8).reduce(0.0) { $0 + Double($1) }
            let tb = b.prefix(8).reduce(0.0) { $0 + Double($1) }
            let total = ta - tb
            guard total > 0 else { return nil }
            let idle = (Double(a[3]) + Double(a[4])) - (Double(b[3]) + Double(b[4]))
            let pct = max(0, min(100, (total - idle) / total * 100))
            let iow = max(0, Double(a[4]) - Double(b[4])) / total * 100
            return (pct, iow)
        }
        if let r = busy("cpu") { s.cpu = r.0; s.iowait = r.1 }
        let coreKeys = cpu.keys
            .filter { $0.count > 3 && $0.hasPrefix("cpu") }
            .sorted { (Int($0.dropFirst(3)) ?? 0) < (Int($1.dropFirst(3)) ?? 0) }
        s.perCore = coreKeys.map { busy($0)?.0 ?? 0 }

        // Memory
        var m: [String: Double] = [:]
        for line in d["MEM"] ?? [] {
            let f = ws(line)
            guard f.count >= 2 else { continue }
            m[String(f[0].dropLast())] = (Double(f[1]) ?? 0) * 1024
        }
        s.memTotal = m["MemTotal"] ?? 0
        let free = m["MemFree"] ?? 0, buf = m["Buffers"] ?? 0
        let cached = (m["Cached"] ?? 0) + (m["SReclaimable"] ?? 0)
        s.memAvail = m["MemAvailable"] ?? (free + buf + cached)
        s.memUsed = max(0, s.memTotal - s.memAvail)
        s.memCache = buf + cached
        s.swapTotal = m["SwapTotal"] ?? 0
        s.swapUsed = max(0, s.swapTotal - (m["SwapFree"] ?? 0))

        // Network
        var net: [String: (UInt64, UInt64)] = [:]
        for line in d["NET"] ?? [] {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces)
            let f = ws(line[line.index(after: colon)...])
            guard f.count >= 9 else { continue }
            let rx = UInt64(f[0]) ?? 0, tx = UInt64(f[8]) ?? 0
            net[name] = (rx, tx)
            if name == "lo" || name.hasPrefix("veth") { continue }
            var ifc = NetIface(name: name, rx: rx, tx: tx)
            if dt > 0, let p = prev?.net[name] {
                ifc.rxRate = rx >= p.0 ? Double(rx - p.0) / dt : 0
                ifc.txRate = tx >= p.1 ? Double(tx - p.1) / dt : 0
            }
            s.nets.append(ifc)
        }
        s.nets.sort { ($0.rx + $0.tx) > ($1.rx + $1.tx) }
        let physical = s.nets.filter { n in !virtualIf.contains { n.name.hasPrefix($0) } }
        s.rxRate = physical.reduce(0) { $0 + $1.rxRate }
        s.txRate = physical.reduce(0) { $0 + $1.txRate }

        // Filesystems
        let dfLines = d["DF"] ?? []
        let hasType = dfLines.first?.contains("Type") ?? false
        for line in dfLines.dropFirst() {
            let f = ws(line)
            let o = hasType ? 1 : 0
            guard f.count >= 6 + o else { continue }
            let fs = String(f[0])
            let type = hasType ? String(f[1]) : ""
            let size = (Double(f[1 + o]) ?? 0) * 1024
            let used = (Double(f[2 + o]) ?? 0) * 1024
            let avail = (Double(f[3 + o]) ?? 0) * 1024
            let mount = f[(5 + o)...].joined(separator: " ")
            if skipTypes.contains(type) || size <= 0 || fs == "none" || fs == "tmpfs" { continue }
            if ["/snap/", "/run", "/dev", "/sys", "/proc", "/var/lib/docker", "/var/lib/kubelet"].contains(where: { mount.hasPrefix($0) }) { continue }
            if fs.hasPrefix("/dev/") && s.mounts.contains(where: { $0.fs == fs }) { continue }
            s.mounts.append(Mount(fs: fs, type: type, mount: mount, size: size, used: used, avail: avail))
        }

        // Disk I/O
        var io: [String: (UInt64, UInt64)] = [:]
        for line in d["IO"] ?? [] {
            let f = ws(line)
            guard f.count >= 10 else { continue }
            let name = String(f[2])
            guard isWholeDisk(name) else { continue }
            let r = (UInt64(f[5]) ?? 0) &* 512, w = (UInt64(f[9]) ?? 0) &* 512
            io[name] = (r, w)
            if dt > 0, let p = prev?.io[name] {
                s.ioRead += r >= p.0 ? Double(r - p.0) / dt : 0
                s.ioWrite += w >= p.1 ? Double(w - p.1) / dt : 0
            }
        }

        // Processes
        for line in d["PS"] ?? [] {
            let f = ws(line)
            guard f.count >= 6, let pid = Int(f[0]) else { continue }
            s.procs.append(ProcRow(pid: pid, user: String(f[1]), cpu: Double(f[2]) ?? 0, mem: Double(f[3]) ?? 0,
                                   rss: (Double(f[4]) ?? 0) * 1024, command: f[5...].joined(separator: " ")))
        }
        s.tcp = Int(d["TCP"]?.first?.trimmingCharacters(in: .whitespaces) ?? "") ?? 0

        // GPUs: NVIDIA via nvidia-smi, AMD via sysfs
        for line in d["GPU"] ?? [] {
            let f = line.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            guard f.count >= 5, let idx = Int(f[0]) else { continue }
            s.gpus.append(GPU(index: idx, name: f[1], util: Double(f[2]) ?? 0,
                              memUsed: (Double(f[3]) ?? 0) * 1_048_576, memTotal: (Double(f[4]) ?? 0) * 1_048_576,
                              temp: f.count > 5 ? Double(f[5]) : nil, power: f.count > 6 ? Double(f[6]) : nil))
        }
        if s.gpus.isEmpty {
            for (i, line) in (d["AMD"] ?? []).enumerated() {
                let f = ws(line)
                guard f.count >= 4 else { continue }
                s.gpus.append(GPU(index: i, name: "AMD " + String(f[0]), util: Double(f[1]) ?? 0,
                                  memUsed: Double(f[2]) ?? 0, memTotal: Double(f[3]) ?? 0, temp: nil, power: nil))
            }
        }
        s.hasDocker = d["DOCKER"]?.contains(where: { $0.trimmingCharacters(in: .whitespaces) == "yes" }) ?? false

        return (s, RawCounters(time: now, cpu: cpu, net: net, io: io))
    }
}
