import SwiftUI
import AppKit

enum Pane: Hashable {
    case fleet
    case server(UUID)
}

enum Tone { case info, ok, warn, refuse }

@Observable
@MainActor
final class FleetStore {
    var servers: [ServerConfig] = []
    var live: [UUID: ServerLive] = [:]
    var pane: Pane = .fleet
    var status: String = "欢迎登舰。点左下角「＋ 新舰船」，记下第一艘。"
    var tone: Tone = .info
    var editing: ServerConfig? = nil
    var backgrounded = false
    var prefs: Prefs = Prefs.load() {
        didSet {
            guard prefs != oldValue else { return }
            prefs.save()
            Floater.shared.sync(self)
        }
    }

    static weak var shared: FleetStore?
    @ObservationIgnored var openMain: (() -> Void)?
    @ObservationIgnored var openSettingsUI: (() -> Void)?
    @ObservationIgnored weak var mainWindow: NSWindow?
    @ObservationIgnored var windowTokens: [NSObjectProtocol] = []
    @ObservationIgnored var forceBackground = false

    @ObservationIgnored private var loops: [UUID: Task<Void, Never>] = [:]
    @ObservationIgnored private var quitObserver: NSObjectProtocol?

    private var fileURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory())
        let dir = base.appendingPathComponent("Rackbook", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("servers.json")
    }

    init() {
        load()
        let active = servers.filter { !$0.paused }
        if !servers.isEmpty {
            status = "正在呼叫 \(active.count) 艘舰船" + (servers.count > active.count ? "（\(servers.count - active.count) 艘停泊中）…" : "…")
        }
        for s in servers {
            if s.paused {
                var l = ServerLive()
                l.phase = .disconnected
                live[s.id] = l
            } else {
                startLoop(s.id)
            }
        }
        quitObserver = NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification,
                                                              object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.servers.forEach { SSH.closeMasterNow($0.resolved) }
            }
        }
    }

    // MARK: Status line

    func say(_ text: String, _ tone: Tone = .info) {
        status = text
        self.tone = tone
    }

    func server(_ id: UUID) -> ServerConfig? { servers.first { $0.id == id } }
    func endpoint(_ id: UUID) -> ServerConfig? { server(id)?.resolved }
    func index(of id: UUID) -> Int { (servers.firstIndex { $0.id == id } ?? 0) + 1 }

    var onlineCount: Int {
        servers.filter { live[$0.id]?.phase == .online }.count
    }

    func privilege(_ id: UUID) -> Privilege { server(id)?.active?.privilege ?? .unknown }

    // MARK: Persistence

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let list = try? JSONDecoder().decode([ServerConfig].self, from: data) else { return }
        servers = list
    }

    func persist() {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? enc.encode(servers) { try? data.write(to: fileURL, options: .atomic) }
    }

    // MARK: Editing

    func save(_ cfg: ServerConfig) {
        if let i = servers.firstIndex(where: { $0.id == cfg.id }) {
            let old = servers[i]
            servers[i] = cfg
            Task { await SSH.closeMaster(old.resolved) }
            var l = ServerLive()
            l.hist = live[cfg.id]?.hist ?? History()
            live[cfg.id] = l
            say("已更新「\(cfg.title)」的航行日志，重新呼叫中。")
        } else {
            servers.append(cfg)
            say("新舰船入列：\(cfg.title)。正在第一次呼叫…")
            pane = .server(cfg.id)
        }
        servers[servers.firstIndex { $0.id == cfg.id }!].paused = false
        persist()
        startLoop(cfg.id)
    }

    func remove(_ id: UUID) {
        loops[id]?.cancel()
        loops[id] = nil
        guard let cfg = server(id) else { return }
        Task { await SSH.closeMaster(cfg.resolved) }
        for a in cfg.accounts { Keychain.delete(a.keychainKey); Keychain.delete(a.loginKey) }
        servers.removeAll { $0.id == id }
        live[id] = nil
        if pane == .server(id) { pane = .fleet }
        persist()
        say("「\(cfg.title)」已退出舰队（服务器本身没有任何改动）。")
    }

    func move(_ id: UUID, by delta: Int) {
        guard let i = servers.firstIndex(where: { $0.id == id }) else { return }
        let j = max(0, min(servers.count - 1, i + delta))
        guard i != j else { return }
        servers.swapAt(i, j)
        persist()
    }

    // MARK: Connect / disconnect

    /// Actively hang up: stop polling and close the SSH control master. Remembered across launches.
    func disconnect(_ id: UUID) {
        guard let cfg = server(id) else { return }
        if cfg.paused && live[id]?.isParked == true {
            say("「\(cfg.title)」本来就停泊着。", .refuse)
            return
        }
        loops[id]?.cancel()
        loops[id] = nil
        Task { await SSH.closeMaster(cfg.resolved) }
        if let i = servers.firstIndex(where: { $0.id == id }) { servers[i].paused = true }
        live[id]?.phase = .disconnected
        live[id]?.masterReady = false
        live[id]?.polling = false
        live[id]?.prev = nil
        persist()
        say("已主动断开「\(cfg.title)」：停止采集并关闭 SSH 连接，舰船停泊。", .ok)
    }

    func connect(_ id: UUID) {
        guard let cfg = server(id) else { return }
        if let i = servers.firstIndex(where: { $0.id == id }) { servers[i].paused = false }
        persist()
        live[id]?.phase = .connecting
        say("正在重新呼叫「\(cfg.title)」…")
        startLoop(id)
    }

    func disconnectAll() {
        let ids = servers.filter { !$0.paused }.map(\.id)
        guard !ids.isEmpty else { say("全舰队都已经停泊了。", .refuse); return }
        for id in ids { disconnect(id) }
        say("全舰队 \(ids.count) 艘已断开并停泊。", .ok)
    }

    func connectAll() {
        let ids = servers.filter { $0.paused }.map(\.id)
        guard !ids.isEmpty else { say("没有停泊的舰船。", .refuse); return }
        for id in ids { connect(id) }
        say("正在呼叫 \(ids.count) 艘停泊的舰船…")
    }

    // MARK: Accounts & roles

    func switchAccount(_ id: UUID, to accountID: UUID) {
        guard let i = servers.firstIndex(where: { $0.id == id }),
              let acct = servers[i].accounts.first(where: { $0.id == accountID }) else { return }
        if servers[i].activeAccount == accountID {
            say("已经是以 \(acct.title) 的身份登舰了。", .refuse)
            return
        }
        let old = servers[i].resolved
        servers[i].activeAccount = accountID
        persist()
        Task { await SSH.closeMaster(old) }
        live[id]?.masterReady = false
        live[id]?.probedAccount = nil
        live[id]?.dockerSudo = false
        say("换成 \(acct.title) 登舰（\(acct.privilege.roleName)），正在查验权限…")
        if servers[i].paused { connect(id) } else { refreshNow(id) }
    }

    private func setPrivilege(_ id: UUID, account: UUID, _ p: Privilege) {
        guard let i = servers.firstIndex(where: { $0.id == id }),
              let j = servers[i].accounts.firstIndex(where: { $0.id == account }) else { return }
        if servers[i].accounts[j].privilege != p {
            servers[i].accounts[j].privilege = p
            persist()
        }
    }

    /// Who are we on this server? root / passwordless sudo / sudo with the stored password / nothing.
    func probe(_ id: UUID) async {
        guard let cfg = endpoint(id), let acct = cfg.active else { return }
        let cmd = "echo \"U=$(id -un)\"; echo \"I=$(id -u)\"; echo \"G=$(id -Gn)\"; " +
                  "if [ \"$(id -u)\" -eq 0 ]; then echo P=root; elif sudo -n true 2>/dev/null; then echo P=nopasswd; else echo P=no; fi"
        guard let r = try? await SSH.run(cfg, cmd, timeout: 15), r.ok else { return }
        var kv: [String: String] = [:]
        for line in r.out.split(separator: "\n") {
            let parts = line.split(separator: "=", maxSplits: 1)
            if parts.count == 2 { kv[String(parts[0])] = String(parts[1]) }
        }
        var p: Privilege = .none
        switch kv["P"] ?? "" {
        case "root": p = .root
        case "nopasswd": p = .nopasswd
        default:
            let groups = (kv["G"] ?? "").split(separator: " ").map(String.init)
            let inSudo = groups.contains { ["sudo", "wheel", "admin"].contains($0) }
            if inSudo {
                p = .needsPassword
                if let pw = acct.sudoPassword {
                    let v = try? await SSH.run(cfg, "sudo -S -p '' true", stdin: pw + "\n", timeout: 15)
                    if v?.ok == true { p = .password }
                }
            }
        }
        live[id]?.probedAccount = acct.id
        let changed = acct.privilege != p
        setPrivilege(id, account: acct.id, p)
        if changed {
            say("「\(cfg.title)」上的 \(kv["U"] ?? acct.title) 是\(p.roleName)：\(p.detail)。", p.isCaptain ? .ok : .info)
        }
    }

    func reprobe(_ id: UUID) {
        live[id]?.probedAccount = nil
        say("重新查验权限…")
        Task { await probe(id) }
    }

    // MARK: Polling

    func startLoop(_ id: UUID) {
        loops[id]?.cancel()
        loops[id] = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                guard let cfg = self.server(id), !cfg.paused else { return }
                await self.poll(id)
                if Task.isCancelled { return }
                let l = self.live[id]
                let wait: Double
                if l?.isOffline == true { wait = max(cfg.interval, 15) }
                else if l?.prev != nil && (l?.hist.cpu.values.isEmpty ?? true) { wait = 1 }
                else { wait = max(1, cfg.interval) }
                try? await Task.sleep(for: .seconds(wait))
            }
        }
    }

    func refreshNow(_ id: UUID) {
        guard let cfg = server(id) else { return }
        if cfg.paused {
            say("还不行：「\(cfg.title)」停泊着，先点「接通」。", .refuse)
            return
        }
        say("正在刷新「\(cfg.title)」…")
        Task {
            await poll(id)
            if let l = live[id], l.phase == .online { say("「\(cfg.title)」刚刚刷新：\(Fmt.clock(Date()))。", .ok) }
        }
    }

    func poll(_ id: UUID) async {
        guard let base = server(id), !base.paused else { return }
        let cfg = base.resolved
        var l = live[id] ?? ServerLive()
        if l.polling { return }
        l.polling = true
        if l.snap == nil && !l.isOffline { l.phase = .connecting }
        live[id] = l

        do {
            if !(live[id]?.masterReady ?? false) {
                try await SSH.ensureMaster(cfg)
                live[id]?.masterReady = true
            }
            if live[id]?.probedAccount != base.active?.id { await probe(id) }
            let r = try await SSH.run(cfg, "sh -s", stdin: Collector.script, timeout: 25)
            if r.code == 255 {
                live[id]?.masterReady = false
                throw SSHError.failed(SSH.cleanErr(r.err, fallback: "SSH 连接中断"))
            }
            guard let built = Collector.build(r.out, prev: live[id]?.prev) else {
                throw SSHError.failed(r.err.trimmed.isEmpty ? "没读到完整数据（目标是 Linux 吗？）" : SSH.cleanErr(r.err, fallback: "读取失败"))
            }
            guard var cur = live[id], server(id)?.paused == false else { return }
            let wasDown = cur.isOffline || cur.snap == nil || cur.isParked
            let hadPrev = cur.prev != nil
            let snap = built.0
            cur.prev = built.1
            if hadPrev {
                cur.hist.cpu.push(snap.cpu)
                cur.hist.mem.push(snap.memFrac * 100)
                cur.hist.rx.push(snap.rxRate)
                cur.hist.tx.push(snap.txRate)
                cur.hist.ioR.push(snap.ioRead)
                cur.hist.ioW.push(snap.ioWrite)
                cur.hist.load.push(snap.load1)
                cur.hist.gpu.push(snap.gpuUtil)
                cur.snap = snap
            } else if cur.snap == nil || cur.isParked {
                cur.snap = snap
            }
            cur.phase = .online
            cur.lastUpdate = Date()
            cur.polling = false
            live[id] = cur
            if wasDown {
                let role = server(id)?.active?.privilege.roleName ?? ""
                say("「\(base.title)」接通了：\(snap.shipClass.name)，\(snap.cores) 核\(snap.gpus.isEmpty ? "" : "，\(snap.gpus.count) 块显卡")。以\(role)身份登舰。", .ok)
            }
        } catch {
            guard server(id)?.paused == false else { return }
            let msg = error.localizedDescription
            let was = live[id]?.isOffline ?? false
            live[id]?.polling = false
            live[id]?.masterReady = false
            live[id]?.phase = .offline(msg)
            if !was { say("「\(base.title)」失联：\(msg)", .warn) }
        }
    }

    // MARK: Running things

    func run(_ id: UUID, _ cmd: String, stdin: String? = nil, timeout: TimeInterval = 60) async -> SSHResult {
        guard let cfg = endpoint(id) else { return SSHResult(out: "", err: "这艘舰船已退出舰队", code: -1) }
        if server(id)?.paused == true { return SSHResult(out: "", err: "已断开（停泊中），先点「接通」", code: -1) }
        do {
            return try await SSH.run(cfg, cmd, stdin: stdin, timeout: timeout)
        } catch {
            return SSHResult(out: "", err: error.localizedDescription, code: -1)
        }
    }

    /// Runs a command with root power, the way the active account is allowed to.
    /// Navigators (no sudo) are refused with a reason.
    func sudo(_ id: UUID, _ cmd: String, timeout: TimeInterval = 90) async -> SSHResult {
        guard let acct = server(id)?.active else { return SSHResult(out: "", err: "没有登舰账户", code: -2) }
        switch acct.privilege {
        case .root:
            return await run(id, cmd, timeout: timeout)
        case .nopasswd:
            return await run(id, "sudo -n sh -c \(shq(cmd))", timeout: timeout)
        case .password:
            guard let pw = acct.sudoPassword else {
                return SSHResult(out: "", err: "钥匙串里找不到 \(acct.title) 的 sudo 密码", code: -2)
            }
            return await run(id, "sudo -S -p '' sh -c \(shq(cmd))", stdin: pw + "\n", timeout: timeout)
        case .needsPassword:
            return SSHResult(out: "", err: "\(acct.title) 是舰长，但还没存可用的 sudo 密码（在「船员」里补上）", code: -2)
        case .none:
            return SSHResult(out: "", err: "领航员 \(acct.title) 没有 sudo 权限，这个操作需要舰长", code: -2)
        case .unknown:
            return SSHResult(out: "", err: "还没查验 \(acct.title) 的权限", code: -2)
        }
    }

    /// docker, directly if the account is in the docker group, otherwise through sudo (captains only).
    func docker(_ id: UUID, _ args: String, timeout: TimeInterval = 60) async -> SSHResult {
        if !(live[id]?.dockerSudo ?? false) {
            let r = await run(id, "docker \(args)", timeout: timeout)
            let denied = r.err.lowercased().contains("permission denied")
            if r.ok || !denied { return r }
            live[id]?.dockerSudo = true
        }
        return await sudo(id, "docker \(args)", timeout: timeout)
    }

    func openTerminal(_ id: UUID) {
        guard let cfg = endpoint(id) else { return }
        do {
            try SSH.openInTerminal(cfg)
            say("已在「终端」里以 \(cfg.active?.title ?? cfg.user) 的身份打开交互式会话。", .ok)
        } catch {
            say("打不开终端：\(error.localizedDescription)", .warn)
        }
    }
}
