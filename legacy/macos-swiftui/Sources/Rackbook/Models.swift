import Foundation
import SwiftUI

struct ServerConfig: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var name: String = ""
    var host: String = ""
    var port: Int = 22
    var user: String = ""
    var identityFile: String = ""
    var jumpHost: String = ""
    var wash: String = "sky"
    var interval: Double = 3
    var accounts: [Account] = []
    var activeAccount: UUID? = nil
    var paused: Bool = false
    /// Filled in by `resolved` from the active account; not edited directly.
    var usePassword: Bool = false
    var passwordKey: String = ""

    init() {
        let a = Account()
        accounts = [a]
        activeAccount = a.id
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        host = try c.decodeIfPresent(String.self, forKey: .host) ?? ""
        port = try c.decodeIfPresent(Int.self, forKey: .port) ?? 22
        user = try c.decodeIfPresent(String.self, forKey: .user) ?? ""
        identityFile = try c.decodeIfPresent(String.self, forKey: .identityFile) ?? ""
        jumpHost = try c.decodeIfPresent(String.self, forKey: .jumpHost) ?? ""
        wash = try c.decodeIfPresent(String.self, forKey: .wash) ?? "sky"
        interval = try c.decodeIfPresent(Double.self, forKey: .interval) ?? 3
        accounts = try c.decodeIfPresent([Account].self, forKey: .accounts) ?? []
        activeAccount = try c.decodeIfPresent(UUID.self, forKey: .activeAccount)
        paused = try c.decodeIfPresent(Bool.self, forKey: .paused) ?? false
        usePassword = try c.decodeIfPresent(Bool.self, forKey: .usePassword) ?? false
        passwordKey = try c.decodeIfPresent(String.self, forKey: .passwordKey) ?? ""
        if accounts.isEmpty {
            var a = Account()
            a.user = user
            a.identityFile = identityFile
            accounts = [a]
        }
        if activeAccount == nil || !accounts.contains(where: { $0.id == activeAccount }) {
            activeAccount = accounts.first?.id
        }
    }

    /// The account currently used to board this server.
    var active: Account? { accounts.first { $0.id == activeAccount } ?? accounts.first }

    /// This config with the active account's login filled in; this is what SSH uses.
    var resolved: ServerConfig {
        var c = self
        if let a = active {
            c.user = a.user
            c.identityFile = a.usePassword ? "" : a.identityFile
            c.usePassword = a.usePassword
            c.passwordKey = a.loginKey
        }
        return c
    }

    var title: String { name.trimmed.isEmpty ? host : name }
    var display: String {
        let u = (active?.user ?? user).trimmed
        let base = u.isEmpty ? host : "\(u)@\(host)"
        return port == 22 ? base : "\(base):\(port)"
    }
}

/// How much power an account has on a server. Decides its role.
enum Privilege: String, Codable {
    case unknown        // not probed yet
    case root           // uid 0
    case nopasswd       // passwordless sudo
    case password       // sudo with a password kept in the Keychain (verified)
    case needsPassword  // in the sudo/wheel group, but no working password stored
    case none           // no sudo at all

    var isCaptain: Bool { self == .root || self == .nopasswd || self == .password || self == .needsPassword }
    var canSudo: Bool { self == .root || self == .nopasswd || self == .password }

    var roleName: String {
        switch self {
        case .unknown: return "待查验"
        case .none: return "领航员"
        default: return "舰长"
        }
    }
    var roleTag: String {
        switch self {
        case .unknown: return "UNKNOWN"
        case .none: return "NAVIGATOR"
        default: return "CAPTAIN"
        }
    }
    var detail: String {
        switch self {
        case .unknown: return "还没登舰查验过权限"
        case .root: return "root：拥有全部权限"
        case .nopasswd: return "免密 sudo"
        case .password: return "sudo（密码存在钥匙串）"
        case .needsPassword: return "在 sudo 组，但还没存可用的 sudo 密码"
        case .none: return "没有 sudo 权限，只能查看和管理自己的东西"
        }
    }
}

struct Account: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var label: String = ""
    var user: String = ""
    var identityFile: String = ""
    var hasSudoPassword: Bool = false
    var privilege: Privilege = .unknown
    /// Log in with a password (kept in the Keychain) instead of a key / ssh-agent.
    var usePassword: Bool = false
    var hasLoginPassword: Bool = false

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? ""
        user = try c.decodeIfPresent(String.self, forKey: .user) ?? ""
        identityFile = try c.decodeIfPresent(String.self, forKey: .identityFile) ?? ""
        hasSudoPassword = try c.decodeIfPresent(Bool.self, forKey: .hasSudoPassword) ?? false
        privilege = try c.decodeIfPresent(Privilege.self, forKey: .privilege) ?? .unknown
        usePassword = try c.decodeIfPresent(Bool.self, forKey: .usePassword) ?? false
        hasLoginPassword = try c.decodeIfPresent(Bool.self, forKey: .hasLoginPassword) ?? false
    }

    var title: String {
        let l = label.trimmed
        if !l.isEmpty { return l }
        return user.trimmed.isEmpty ? "默认账户" : user
    }
    var keychainKey: String { "sudo-" + id.uuidString }
    var loginKey: String { "login-" + id.uuidString }

    /// Password for sudo: its own if stored, otherwise the login password (usually the same).
    var sudoPassword: String? {
        if hasSudoPassword, let p = Keychain.get(keychainKey) { return p }
        if usePassword && hasLoginPassword { return Keychain.get(loginKey) }
        return nil
    }
    var authText: String { usePassword ? "密码登录" : (identityFile.isEmpty ? "密钥 / ssh-agent" : "私钥 \(identityFile)") }
}

struct GPU: Identifiable, Hashable {
    var id: String { "\(index)-\(name)" }
    var index: Int
    var name: String
    var util: Double
    var memUsed: Double
    var memTotal: Double
    var temp: Double?
    var power: Double?
    var memFrac: Double { memTotal > 0 ? memUsed / memTotal : 0 }
}

/// Every server is a starship. Its class follows from its size.
enum ShipClass {
    case scout, frigate, cruiser, carrier

    init(cores: Int, mem: Double) {
        let gb = mem / 1_073_741_824
        if cores >= 32 || gb >= 128 { self = .carrier }
        else if cores >= 9 || gb >= 24 { self = .cruiser }
        else if cores >= 3 || gb >= 4 { self = .frigate }
        else { self = .scout }
    }
    var name: String {
        switch self {
        case .scout: return "侦察艇"
        case .frigate: return "护卫舰"
        case .cruiser: return "巡洋舰"
        case .carrier: return "母舰"
        }
    }
    var size: CGFloat {
        switch self {
        case .scout: return 0.72
        case .frigate: return 0.9
        case .cruiser: return 1.1
        case .carrier: return 1.35
        }
    }
    var engines: Int {
        switch self {
        case .scout: return 1
        case .frigate: return 2
        case .cruiser: return 2
        case .carrier: return 3
        }
    }
}

struct NetIface: Identifiable, Hashable {
    var id: String { name }
    var name: String
    var rx: UInt64
    var tx: UInt64
    var rxRate: Double = 0
    var txRate: Double = 0
}

struct Mount: Identifiable, Hashable {
    var id: String { mount }
    var fs: String
    var type: String
    var mount: String
    var size: Double
    var used: Double
    var avail: Double
    var frac: Double { (used + avail) > 0 ? used / (used + avail) : 0 }
}

struct ProcRow: Identifiable, Hashable {
    var id: Int { pid }
    var pid: Int
    var user: String
    var cpu: Double
    var mem: Double
    var rss: Double
    var command: String
}

struct Snapshot {
    var time = Date()
    var hostname = ""
    var kernel = ""
    var os = ""
    var cores = 1
    var uptime: Double = 0
    var load: [Double] = [0, 0, 0]
    var procsRunning = ""
    var cpu: Double = 0
    var iowait: Double = 0
    var perCore: [Double] = []
    var memTotal: Double = 0
    var memUsed: Double = 0
    var memAvail: Double = 0
    var memCache: Double = 0
    var swapTotal: Double = 0
    var swapUsed: Double = 0
    var nets: [NetIface] = []
    var rxRate: Double = 0
    var txRate: Double = 0
    var mounts: [Mount] = []
    var ioRead: Double = 0
    var ioWrite: Double = 0
    var procs: [ProcRow] = []
    var tcp = 0
    var gpus: [GPU] = []
    var hasDocker = false

    var gpuUtil: Double { gpus.isEmpty ? 0 : gpus.reduce(0) { $0 + $1.util } / Double(gpus.count) }
    var shipClass: ShipClass { ShipClass(cores: cores, mem: memTotal) }

    var memFrac: Double { memTotal > 0 ? memUsed / memTotal : 0 }
    var worstDisk: Mount? { mounts.max { $0.frac < $1.frac } }
    var load1: Double { load.first ?? 0 }
    var loadText: String {
        (0..<3).map { Fmt.num($0 < load.count ? load[$0] : 0) }.joined(separator: " / ")
    }
}

struct RawCounters {
    var time: Date
    var cpu: [String: [UInt64]]
    var net: [String: (UInt64, UInt64)]
    var io: [String: (UInt64, UInt64)]
}

struct Series {
    var values: [Double] = []
    var cap = 150
    mutating func push(_ v: Double) {
        values.append(v.isFinite ? v : 0)
        if values.count > cap { values.removeFirst(values.count - cap) }
    }
}

struct History {
    var cpu = Series()
    var mem = Series()
    var rx = Series()
    var tx = Series()
    var ioR = Series()
    var ioW = Series()
    var load = Series()
    var gpu = Series()
}

enum Phase: Equatable {
    case idle, connecting, online, disconnected
    case offline(String)
}

enum Health: Equatable {
    case unknown, ok, warn, hot, down, parked

    var label: String {
        switch self {
        case .unknown: return "等待"
        case .ok: return "从容"
        case .warn: return "忙碌"
        case .hot: return "吃紧"
        case .down: return "离线"
        case .parked: return "停泊"
        }
    }
    var color: Color {
        switch self {
        case .unknown: return Ink.steel
        case .ok: return Ink.sage
        case .warn: return Ink.gold
        case .hot: return Ink.rose
        case .down: return Ink.shade
        case .parked: return Ink.steel
        }
    }
}

struct ServerLive {
    var phase: Phase = .idle
    var snap: Snapshot?
    var hist = History()
    var prev: RawCounters?
    var masterReady = false
    var probedAccount: UUID?
    var dockerSudo = false
    var lastUpdate: Date?
    var polling = false

    var isOffline: Bool {
        if case .offline = phase { return true }
        return false
    }

    var isParked: Bool { phase == .disconnected }

    var health: Health {
        if isParked { return .parked }
        if isOffline { return .down }
        guard let s = snap else { return .unknown }
        let disk = s.worstDisk?.frac ?? 0
        if s.cpu > 90 || s.memFrac > 0.92 || disk > 0.92 { return .hot }
        if s.cpu > 70 || s.memFrac > 0.8 || disk > 0.85 { return .warn }
        return .ok
    }

    var alerts: [String] {
        guard let s = snap, !isOffline, !isParked else { return [] }
        var a: [String] = []
        if s.cpu > 90 { a.append("CPU 吃紧 \(Fmt.pct(s.cpu))") }
        if s.memFrac > 0.92 { a.append("内存吃紧 \(Fmt.pct(s.memFrac * 100))") }
        for m in s.mounts where m.frac > 0.9 { a.append("\(m.mount) 已用 \(Fmt.pct(m.frac * 100))") }
        if s.swapTotal > 0 && s.swapUsed / s.swapTotal > 0.5 { a.append("swap 已用 \(Fmt.pct(s.swapUsed / s.swapTotal * 100))") }
        return a
    }
}

func phaseText(_ p: Phase?) -> String {
    switch p {
    case .none, .some(.idle): return "等待连接…"
    case .some(.connecting): return "正在连接…"
    case .some(.online): return "在线"
    case .some(.disconnected): return "已断开 · 停泊中（点「接通」重新连接）"
    case .some(.offline(let m)): return "离线 · \(m)"
    }
}

// MARK: - Formatting

enum Fmt {
    static func bytes(_ v: Double) -> String {
        guard v.isFinite, v > 0 else { return "0 B" }
        let units = ["B", "KB", "MB", "GB", "TB", "PB"]
        var x = v
        var i = 0
        while x >= 1024 && i < units.count - 1 { x /= 1024; i += 1 }
        if i == 0 { return "\(Int(x)) B" }
        let f = x >= 100 ? "%.0f" : (x >= 10 ? "%.1f" : "%.2f")
        return String(format: f, x) + " " + units[i]
    }
    static func rate(_ v: Double) -> String { bytes(v) + "/s" }
    static func pct(_ v: Double) -> String { String(format: "%.0f%%", v.isFinite ? v : 0) }
    static func num(_ v: Double, _ digits: Int = 2) -> String { String(format: "%.\(digits)f", v) }

    static func uptime(_ s: Double) -> String {
        let t = Int(s)
        let d = t / 86400, h = (t % 86400) / 3600, m = (t % 3600) / 60
        if d > 0 { return "\(d) 天 \(h) 小时" }
        if h > 0 { return "\(h) 小时 \(m) 分" }
        return "\(m) 分"
    }

    private static let clockF: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "HH:mm:ss"; return f
    }()
    private static let dateF: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm"; return f
    }()
    static func clock(_ d: Date) -> String { clockF.string(from: d) }
    static func date(_ d: Date) -> String { dateF.string(from: d) }
}
