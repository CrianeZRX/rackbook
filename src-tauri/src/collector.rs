//! One shell script per poll, read straight from /proc. Nothing is installed on the server.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;

use crate::model::*;

pub const SCRIPT: &str = r#"export LC_ALL=C
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
echo @@USERS; getconf CLK_TCK 2>/dev/null || echo 100; getconf PAGESIZE 2>/dev/null || echo 4096
{ awk -F: '{print "P", $3, $1}' /etc/passwd 2>/dev/null; stat -c 'U %u %n' /proc/[0-9]* 2>/dev/null; awk '{l=$0; sub(/^[^)]*\) /,"",l); split(l,f," "); p=FILENAME; sub(/\/stat$/,"",p); print "S", p, f[12]+f[13], f[22]}' /proc/[0-9]*/stat 2>/dev/null; } | awk '$1=="P"{nm[$2]=$3; next} $1=="U"{u[$3]=$2; next} $1=="S"{k=($2 in u)? u[$2] : "?"; c[k]+=$3; m[k]+=$4; n[k]++} END{for(k in c){name=(k in nm)?nm[k]:k; print name, c[k], m[k], n[k]}}'
echo @@TCP; cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '$4=="01"{n++} END{print n+0}'
echo @@GPU; command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,clocks.sm,utilization.memory --format=csv,noheader,nounits 2>/dev/null
echo @@AMD; for d in /sys/class/drm/card*/device; do [ -r "$d/gpu_busy_percent" ] && echo "$(basename "$(dirname "$d")") $(cat "$d/gpu_busy_percent") $(cat "$d/mem_info_vram_used" 2>/dev/null || echo 0) $(cat "$d/mem_info_vram_total" 2>/dev/null || echo 0)"; done
echo @@DOCKER; command -v docker >/dev/null 2>&1 && echo yes
echo @@END
"#;

#[derive(Clone, Debug, Default)]
pub struct Raw {
    pub time: f64,
    pub cpu: HashMap<String, Vec<u64>>,
    pub net: HashMap<String, (u64, u64)>,
    pub io: HashMap<String, (u64, u64)>,
    /// cumulative CPU ticks per user, for the per-user CPU rate
    pub users: HashMap<String, u64>,
}

pub fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn sections(out: &str) -> HashMap<String, Vec<&str>> {
    let mut d: HashMap<String, Vec<&str>> = HashMap::new();
    let mut cur = String::new();
    for line in out.split('\n') {
        if let Some(name) = line.strip_prefix("@@") {
            cur = name.trim().to_string();
            d.entry(cur.clone()).or_default();
            continue;
        }
        if !cur.is_empty() {
            d.entry(cur.clone()).or_default().push(line);
        }
    }
    d
}

fn ws(s: &str) -> Vec<&str> {
    s.split_whitespace().collect()
}

const SKIP_TYPES: &[&str] = &[
    "tmpfs", "devtmpfs", "squashfs", "overlay", "efivarfs", "proc", "sysfs", "cgroup", "cgroup2", "nsfs",
    "fuse.lxcfs", "ramfs", "autofs", "devpts", "mqueue", "tracefs", "debugfs", "securityfs", "pstore", "bpf",
    "configfs", "fusectl", "hugetlbfs", "binfmt_misc", "rpc_pipefs", "shm",
];
const SKIP_MOUNTS: &[&str] = &["/snap/", "/run", "/dev", "/sys", "/proc", "/var/lib/docker", "/var/lib/kubelet"];
const VIRTUAL_IF: &[&str] = &["docker", "br-", "virbr", "cni", "flannel", "cali", "tun", "wg", "vnet", "kube"];

pub fn build(out: &str, prev: Option<&Raw>) -> Option<(Snapshot, Raw)> {
    let d = sections(out);
    if !d.contains_key("END") || !d.contains_key("STAT") {
        return None;
    }
    let t = now();
    let dt = prev.map(|p| t - p.time).unwrap_or(0.0);
    let mut s = Snapshot { time: t, ..Default::default() };
    let get = |k: &str| d.get(k).cloned().unwrap_or_default();

    let host = get("HOST");
    s.hostname = host.first().map(|x| x.to_string()).unwrap_or_default();
    s.kernel = host.get(1).map(|x| x.to_string()).unwrap_or_default();
    s.os = get("OS").first().map(|x| x.to_string()).unwrap_or_default();
    s.cores = get("NPROC").first().and_then(|x| x.trim().parse().ok()).unwrap_or(1);
    s.uptime = get("UPTIME").first().and_then(|l| ws(l).first().and_then(|v| v.parse().ok())).unwrap_or(0.0);
    if let Some(l) = get("LOAD").first() {
        let f = ws(l);
        s.load = f.iter().take(3).map(|v| v.parse().unwrap_or(0.0)).collect();
        s.procs_running = f.get(3).map(|x| x.to_string()).unwrap_or_default();
    }

    // CPU
    let mut cpu: HashMap<String, Vec<u64>> = HashMap::new();
    for line in get("STAT") {
        let f = ws(line);
        if f.len() > 4 {
            cpu.insert(f[0].to_string(), f[1..].iter().map(|v| v.parse().unwrap_or(0)).collect());
        }
    }
    let busy = |key: &str| -> Option<(f64, f64)> {
        let a = cpu.get(key)?;
        let b = prev?.cpu.get(key)?;
        if a.len() < 5 || b.len() < 5 { return None; }
        let ta: f64 = a.iter().take(8).map(|&x| x as f64).sum();
        let tb: f64 = b.iter().take(8).map(|&x| x as f64).sum();
        let total = ta - tb;
        if total <= 0.0 { return None; }
        let idle = (a[3] as f64 + a[4] as f64) - (b[3] as f64 + b[4] as f64);
        Some((((total - idle) / total * 100.0).clamp(0.0, 100.0), ((a[4] as f64 - b[4] as f64).max(0.0) / total * 100.0)))
    };
    if let Some((c, w)) = busy("cpu") { s.cpu = c; s.iowait = w; }
    let mut cores: Vec<&String> = cpu.keys().filter(|k| k.len() > 3 && k.starts_with("cpu")).collect();
    cores.sort_by_key(|k| k[3..].parse::<i64>().unwrap_or(0));
    s.per_core = cores.iter().map(|k| busy(k).map(|x| x.0).unwrap_or(0.0)).collect();

    // Memory
    let mut m: HashMap<String, f64> = HashMap::new();
    for line in get("MEM") {
        let f = ws(line);
        if f.len() >= 2 {
            m.insert(f[0].trim_end_matches(':').to_string(), f[1].parse::<f64>().unwrap_or(0.0) * 1024.0);
        }
    }
    let g = |k: &str| *m.get(k).unwrap_or(&0.0);
    s.mem_total = g("MemTotal");
    let cached = g("Cached") + g("SReclaimable");
    s.mem_avail = m.get("MemAvailable").copied().unwrap_or(g("MemFree") + g("Buffers") + cached);
    s.mem_used = (s.mem_total - s.mem_avail).max(0.0);
    s.mem_cache = g("Buffers") + cached;
    s.swap_total = g("SwapTotal");
    s.swap_used = (s.swap_total - g("SwapFree")).max(0.0);

    // Network
    let mut net = HashMap::new();
    for line in get("NET") {
        let Some((name, rest)) = line.split_once(':') else { continue };
        let name = name.trim().to_string();
        let f = ws(rest);
        if f.len() < 9 { continue; }
        let rx: u64 = f[0].parse().unwrap_or(0);
        let tx: u64 = f[8].parse().unwrap_or(0);
        net.insert(name.clone(), (rx, tx));
        if name == "lo" || name.starts_with("veth") { continue; }
        let mut i = NetIface { name: name.clone(), rx, tx, ..Default::default() };
        if dt > 0.0 {
            if let Some(&(prx, ptx)) = prev.and_then(|p| p.net.get(&name)) {
                i.rx_rate = if rx >= prx { (rx - prx) as f64 / dt } else { 0.0 };
                i.tx_rate = if tx >= ptx { (tx - ptx) as f64 / dt } else { 0.0 };
            }
        }
        s.nets.push(i);
    }
    s.nets.sort_by(|a, b| (b.rx + b.tx).cmp(&(a.rx + a.tx)));
    for n in &s.nets {
        if VIRTUAL_IF.iter().any(|p| n.name.starts_with(p)) { continue; }
        s.rx_rate += n.rx_rate;
        s.tx_rate += n.tx_rate;
    }

    // Filesystems
    let df = get("DF");
    let has_type = df.first().map(|l| l.contains("Type")).unwrap_or(false);
    let o = if has_type { 1 } else { 0 };
    for line in df.iter().skip(1) {
        let f = ws(line);
        if f.len() < 6 + o { continue; }
        let fs = f[0].to_string();
        let kind = if has_type { f[1].to_string() } else { String::new() };
        let size = f[1 + o].parse::<f64>().unwrap_or(0.0) * 1024.0;
        let used = f[2 + o].parse::<f64>().unwrap_or(0.0) * 1024.0;
        let avail = f[3 + o].parse::<f64>().unwrap_or(0.0) * 1024.0;
        let mount = f[5 + o..].join(" ");
        if SKIP_TYPES.contains(&kind.as_str()) || size <= 0.0 || fs == "none" || fs == "tmpfs" { continue; }
        if SKIP_MOUNTS.iter().any(|p| mount.starts_with(p)) { continue; }
        if fs.starts_with("/dev/") && s.mounts.iter().any(|m| m.fs == fs) { continue; }
        s.mounts.push(Mount { fs, kind, mount, size, used, avail });
    }

    // Disk I/O
    let disk_re = Regex::new(r"^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme[0-9]+n[0-9]+|mmcblk[0-9]+)$").unwrap();
    let mut io = HashMap::new();
    for line in get("IO") {
        let f = ws(line);
        if f.len() < 10 || !disk_re.is_match(f[2]) { continue; }
        let r = f[5].parse::<u64>().unwrap_or(0).wrapping_mul(512);
        let w = f[9].parse::<u64>().unwrap_or(0).wrapping_mul(512);
        io.insert(f[2].to_string(), (r, w));
        if dt > 0.0 {
            if let Some(&(pr, pw)) = prev.and_then(|p| p.io.get(f[2])) {
                if r >= pr { s.io_read += (r - pr) as f64 / dt; }
                if w >= pw { s.io_write += (w - pw) as f64 / dt; }
            }
        }
    }

    // Processes
    for line in get("PS") {
        let f = ws(line);
        if f.len() < 6 { continue; }
        let Ok(pid) = f[0].parse() else { continue };
        s.procs.push(ProcRow {
            pid,
            user: f[1].to_string(),
            cpu: f[2].parse().unwrap_or(0.0),
            mem: f[3].parse().unwrap_or(0.0),
            rss: f[4].parse::<f64>().unwrap_or(0.0) * 1024.0,
            command: f[5..].join(" "),
        });
    }
    // Users: CPU from the change in their processes' cumulative ticks since the last sample, memory from RSS pages
    let mut users_raw: HashMap<String, u64> = HashMap::new();
    {
        let u = get("USERS");
        let clk: f64 = u.first().and_then(|x| x.trim().parse().ok()).filter(|v: &f64| *v > 0.0).unwrap_or(100.0);
        let page: f64 = u.get(1).and_then(|x| x.trim().parse().ok()).filter(|v: &f64| *v > 0.0).unwrap_or(4096.0);
        let cores = (s.cores.max(1)) as f64;
        for line in u.iter().skip(2) {
            let f = ws(line);
            if f.len() < 4 { continue; }
            let (Ok(ticks), Ok(pages), Ok(n)) = (f[1].parse::<u64>(), f[2].parse::<f64>(), f[3].parse::<i64>()) else { continue };
            let name = f[0].to_string();
            let mut core_used = 0.0;
            if let Some(p) = prev {
                if dt > 0.0 {
                    if let Some(&pt) = p.users.get(&name) {
                        // a process that exited takes its ticks with it: never report negative use
                        core_used = (ticks.saturating_sub(pt) as f64 / clk / dt).max(0.0);
                    }
                }
            }
            users_raw.insert(name.clone(), ticks);
            s.users.push(UserUse { user: name, cores: core_used, cpu: (core_used / cores * 100.0).min(100.0), rss: pages * page, procs: n });
        }
        s.users.sort_by(|a, b| b.cpu.partial_cmp(&a.cpu).unwrap_or(std::cmp::Ordering::Equal).then(b.rss.partial_cmp(&a.rss).unwrap_or(std::cmp::Ordering::Equal)));
    }
    s.tcp = get("TCP").first().and_then(|x| x.trim().parse().ok()).unwrap_or(0);

    // GPUs
    for line in get("GPU") {
        let f: Vec<&str> = line.split(',').map(|x| x.trim()).collect();
        if f.len() < 5 { continue; }
        let Ok(index) = f[0].parse() else { continue };
        s.gpus.push(Gpu {
            index,
            name: f[1].to_string(),
            util: f[2].parse().unwrap_or(0.0),
            mem_used: f[3].parse::<f64>().unwrap_or(0.0) * 1_048_576.0,
            mem_total: f[4].parse::<f64>().unwrap_or(0.0) * 1_048_576.0,
            temp: f.get(5).and_then(|v| v.parse().ok()),
            power: f.get(6).and_then(|v| v.parse().ok()),
            power_limit: f.get(7).and_then(|v| v.parse().ok()),
            fan: f.get(8).and_then(|v| v.parse().ok()),
            clock_sm: f.get(9).and_then(|v| v.parse().ok()),
            mem_util: f.get(10).and_then(|v| v.parse().ok()),
        });
    }
    if s.gpus.is_empty() {
        for (i, line) in get("AMD").iter().enumerate() {
            let f = ws(line);
            if f.len() < 4 { continue; }
            s.gpus.push(Gpu {
                index: i as i64,
                name: format!("AMD {}", f[0]),
                util: f[1].parse().unwrap_or(0.0),
                mem_used: f[2].parse().unwrap_or(0.0),
                mem_total: f[3].parse().unwrap_or(0.0),
                ..Default::default()
            });
        }
    }
    s.has_docker = get("DOCKER").iter().any(|l| l.trim() == "yes");

    Some((s, Raw { time: t, cpu, net, io, users: users_raw }))
}
