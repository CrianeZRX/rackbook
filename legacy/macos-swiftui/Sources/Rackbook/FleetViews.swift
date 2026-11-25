import SwiftUI
import AppKit

// MARK: - Sidebar: the notebook's index

struct SidebarView: View {
    @Environment(FleetStore.self) private var store
    @State private var confirmDelete: ServerConfig?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text("RACKBOOK · 机房手账")
                    .font(Fonts.hand(12, bold: true)).tracking(1.6).foregroundStyle(Ink.red)
                Text("星际舰队").font(Fonts.serif(26)).foregroundStyle(Ink.ink)
                Text("every server is a ship; you are its crew")
                    .font(Fonts.hand(13)).foregroundStyle(Ink.muted)
            }
            .padding(.top, 42)
            .padding(.horizontal, 18)
            .padding(.bottom, 14)

            fleetRow
                .padding(.horizontal, 14)
                .padding(.bottom, 10)

            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(Array(store.servers.enumerated()), id: \.element.id) { i, s in
                        ServerRow(cfg: s, index: i + 1, selected: store.pane == .server(s.id))
                            .onTapGesture { store.pane = .server(s.id) }
                            .contextMenu {
                                Button("立即刷新") { store.refreshNow(s.id) }
                                if s.paused {
                                    Button("接通") { store.connect(s.id) }
                                } else {
                                    Button("断开") { store.disconnect(s.id) }
                                }
                                Button("在终端打开") { store.openTerminal(s.id) }
                                if s.accounts.count > 1 {
                                    Menu("切换登舰账户") {
                                        ForEach(s.accounts) { a in
                                            Button("\(a.privilege.roleName) · \(a.title)") { store.switchAccount(s.id, to: a.id) }
                                        }
                                    }
                                }
                                Button("编辑…") { store.editing = s }
                                Divider()
                                Button("上移") { store.move(s.id, by: -1) }
                                Button("下移") { store.move(s.id, by: 1) }
                                Divider()
                                Button("删除…", role: .destructive) { confirmDelete = s }
                            }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 4)
            }

            VStack(spacing: 8) {
                Button {
                    store.editing = ServerConfig()
                } label: {
                    Text("＋ 新舰船").frame(maxWidth: .infinity)
                }
                .buttonStyle(SketchButtonStyle(kind: .solid))
                HStack(spacing: 6) {
                    Button("设置") { store.showSettings() }
                        .buttonStyle(SketchButtonStyle(kind: .chip))
                    Spacer()
                    Button("转入后台 ⇧⌘B") { store.goBackground() }
                        .buttonStyle(SketchButtonStyle(kind: .chip))
                        .help("关闭主窗口但继续监控；菜单栏出现舰船图标，可选弹出悬浮窗")
                }
            }
            .padding(16)
        }
        .background(Ink.cream.opacity(0.5))
        .confirmationDialog("让这艘舰船退出舰队？",
                            isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }),
                            presenting: confirmDelete) { s in
            Button("删除「\(s.title)」", role: .destructive) { store.remove(s.id) }
            Button("取消", role: .cancel) {}
        } message: { _ in
            Text("只从 Rackbook 里移除（连同存在钥匙串里的 sudo 密码），不会改动服务器本身。")
        }
    }

    private var fleetRow: some View {
        let selected = store.pane == .fleet
        return HStack(spacing: 10) {
            Text("✦").font(Fonts.hand(18, bold: true)).foregroundStyle(Ink.red)
            VStack(alignment: .leading, spacing: 0) {
                Text("星图 · 舰队总览").font(Fonts.hand(18, bold: true)).foregroundStyle(Ink.ink)
                Text("\(store.servers.count) 台 · \(store.onlineCount) 在线")
                    .font(Fonts.mono(11)).foregroundStyle(Ink.muted)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            ZStack {
                Rectangle().fill(selected ? Ink.gold.opacity(0.55) : Ink.cream).offset(x: 2, y: 2)
                SketchRect(seed: 41).stroke(selected ? Ink.red : Ink.ink.opacity(0.7), lineWidth: selected ? 2 : 1.1)
            }
        )
        .contentShape(Rectangle())
        .onTapGesture {
            store.pane = .fleet
            store.say("星图：\(store.servers.count) 艘舰船，\(store.onlineCount) 艘在航。")
        }
    }
}

struct ServerRow: View {
    @Environment(FleetStore.self) private var store
    let cfg: ServerConfig
    let index: Int
    let selected: Bool

    var body: some View {
        let l = store.live[cfg.id]
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                HealthDot(health: l?.health ?? .unknown).frame(width: 13, height: 13)
                Text(cfg.title).font(Fonts.hand(18, bold: true)).foregroundStyle(Ink.ink).lineLimit(1)
                Spacer(minLength: 4)
                Text("No.\(index)").font(Fonts.mono(10)).foregroundStyle(Ink.red)
            }
            HStack(spacing: 6) {
                RoleBadge(privilege: cfg.active?.privilege ?? .unknown, small: true)
                Text(cfg.display).font(Fonts.mono(11)).foregroundStyle(Ink.muted).lineLimit(1)
            }
            if let s = l?.snap, l?.isOffline == false, l?.isParked == false {
                MiniMeter(label: "CPU", value: s.cpu / 100, text: Fmt.pct(s.cpu))
                MiniMeter(label: "MEM", value: s.memFrac, text: Fmt.pct(s.memFrac * 100))
                HStack {
                    Text("↓ " + Fmt.rate(s.rxRate))
                    Spacer()
                    Text("↑ " + Fmt.rate(s.txRate))
                }
                .font(Fonts.mono(10))
                .foregroundStyle(Ink.muted)
            } else {
                Text(phaseText(l?.phase))
                    .font(Fonts.hand(13))
                    .foregroundStyle(l?.isOffline == true ? Ink.red : Ink.muted)
                    .lineLimit(2)
            }
        }
        .padding(12)
        .background(
            ZStack {
                Rectangle().fill(Ink.wash(cfg.wash).opacity(selected ? 0.55 : 0.2)).offset(x: 2, y: 2)
                SketchRect().stroke(selected ? Ink.red : Ink.ink.opacity(0.7), lineWidth: selected ? 2.1 : 1.1)
            }
        )
        .contentShape(Rectangle())
    }
}

// MARK: - Fleet overview: a catalogue sheet, one card per machine

struct FleetOverview: View {
    @Environment(FleetStore.self) private var store

    var body: some View {
        let lives = store.servers.map { store.live[$0.id] ?? ServerLive() }
        let alerts = lives.reduce(0) { $0 + $1.alerts.count }
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .bottom) {
                    TitleBlock(kicker: "Starfleet · 星际舰队", title: "第一舰队",
                               subtitle: "\(store.servers.count) 艘 · \(store.onlineCount) 艘在航 · \(store.servers.filter(\.paused).count) 艘停泊 · \(alerts) 处需要留意")
                    Spacer()
                    VStack(alignment: .trailing, spacing: 8) {
                        legend
                        HStack(spacing: 6) {
                            Button("全部接通") { store.connectAll() }.buttonStyle(SketchButtonStyle(kind: .chip))
                            Button("全部断开") { store.disconnectAll() }.buttonStyle(SketchButtonStyle(kind: .danger))
                        }
                    }
                }
                if store.servers.isEmpty {
                    EmptyFleet()
                } else {
                    SketchCard(kicker: "Star chart", title: "编队航行中（点舰船登舰）", seed: 170) {
                        StarfleetChart().frame(height: 480)
                        Footnote(text: "舰级按规模定：侦察艇 ≤2 核、护卫舰、巡洋舰 ≥9 核或 24 GB、母舰 ≥32 核或 128 GB。尾焰长度随 CPU 负载，蓝→金→红；虚线护盾表示忙碌或吃紧；蓝点是网络流量。旗舰为核数最多的在航舰船。")
                    }
                    totals(lives)
                    Text("舰船名录").font(Fonts.hand(14, bold: true)).tracking(1.4).foregroundStyle(Ink.red)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 300, maximum: 460), spacing: 18)], spacing: 18) {
                        ForEach(Array(store.servers.enumerated()), id: \.element.id) { i, s in
                            FleetCard(cfg: s, index: i + 1)
                                .onTapGesture { store.pane = .server(s.id) }
                        }
                    }
                }
                Footnote(text: "数据经 SSH 从 /proc 读取，每艘按各自间隔刷新。颜色：绿 = 从容，黄 = 忙碌，红 = 吃紧，灰 = 失联，钢灰 = 停泊（主动断开）。")
            }
            .padding(28)
        }
    }

    private var legend: some View {
        HStack(spacing: 14) {
            ForEach([Health.ok, .warn, .hot, .down, .parked], id: \.label) { h in
                HStack(spacing: 5) {
                    HealthDot(health: h).frame(width: 12, height: 12)
                    Text(h.label).font(Fonts.hand(14)).foregroundStyle(Ink.ink)
                }
            }
        }
    }

    private func totals(_ lives: [ServerLive]) -> some View {
        let snaps = lives.compactMap { $0.isOffline ? nil : $0.snap }
        let cores = snaps.reduce(0) { $0 + $1.cores }
        let memU = snaps.reduce(0.0) { $0 + $1.memUsed }
        let memT = snaps.reduce(0.0) { $0 + $1.memTotal }
        let rx = snaps.reduce(0.0) { $0 + $1.rxRate }
        let tx = snaps.reduce(0.0) { $0 + $1.txRate }
        let dU = snaps.reduce(0.0) { acc, s in acc + s.mounts.reduce(0.0) { $0 + $1.used } }
        let dT = snaps.reduce(0.0) { acc, s in acc + s.mounts.reduce(0.0) { $0 + $1.used + $1.avail } }
        return HStack(spacing: 18) {
            TallyCard(kicker: "Cores", big: "\(cores)", note: "在线机器的 CPU 核数合计", wash: Ink.gold)
            TallyCard(kicker: "Memory", big: Fmt.bytes(memU), note: "共 \(Fmt.bytes(memT))", wash: Ink.blue, frac: memT > 0 ? memU / memT : nil)
            TallyCard(kicker: "Traffic", big: "↓ \(Fmt.rate(rx))", note: "↑ \(Fmt.rate(tx))", wash: Ink.sky)
            TallyCard(kicker: "Storage", big: Fmt.bytes(dU), note: "共 \(Fmt.bytes(dT))", wash: Ink.tan, frac: dT > 0 ? dU / dT : nil)
        }
    }
}

struct TallyCard: View {
    var kicker: String
    var big: String
    var note: String
    var wash: Color
    var frac: Double? = nil

    var body: some View {
        SketchCard(kicker: kicker, wash: Ink.cream) {
            Text(big).font(Fonts.serif(24)).foregroundStyle(Ink.ink).lineLimit(1).minimumScaleFactor(0.6)
            if let f = frac { MarkerBar(value: f, color: wash, height: 9) }
            Text(note).font(Fonts.hand(14)).foregroundStyle(Ink.muted).lineLimit(1)
        }
    }
}

struct FleetCard: View {
    @Environment(FleetStore.self) private var store
    let cfg: ServerConfig
    let index: Int

    var body: some View {
        let l = store.live[cfg.id] ?? ServerLive()
        SketchCard(wash: Ink.cream, lit: l.health == .hot, seed: UInt64(index * 13 + 1)) {
            HStack(alignment: .top, spacing: 12) {
                MiniShip(cls: l.snap?.shipClass ?? .frigate, hull: Ink.wash(cfg.wash), health: l.health, load: (l.snap?.cpu ?? 0) / 100)
                    .frame(width: 104, height: 76)
                VStack(alignment: .leading, spacing: 3) {
                    Text("No.\(index) · \(l.snap?.shipClass.name ?? "舰船") · \(l.health.label)")
                        .font(Fonts.hand(12, bold: true)).tracking(1).foregroundStyle(Ink.red)
                    Text(cfg.title).font(Fonts.hand(21, bold: true)).foregroundStyle(Ink.ink).lineLimit(1)
                    HStack(spacing: 6) {
                        RoleBadge(privilege: cfg.active?.privilege ?? .unknown, small: true)
                        Text(cfg.display).font(Fonts.mono(11)).foregroundStyle(Ink.muted).lineLimit(1)
                    }
                    if let s = l.snap {
                        Text("\(s.cores) 核\(s.gpus.isEmpty ? "" : " · \(s.gpus.count) GPU") · \(Fmt.bytes(s.memTotal)) · 运行 \(Fmt.uptime(s.uptime))")
                            .font(Fonts.hand(13)).foregroundStyle(Ink.muted).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            if let s = l.snap, !l.isOffline, !l.isParked {
                MiniMeter(label: "CPU", value: s.cpu / 100, text: Fmt.pct(s.cpu))
                MiniMeter(label: "MEM", value: s.memFrac, text: Fmt.pct(s.memFrac * 100))
                MiniMeter(label: "DISK", value: s.worstDisk?.frac ?? 0, text: Fmt.pct((s.worstDisk?.frac ?? 0) * 100))
                Sparkline(values: l.hist.cpu.values, color: Ink.gold, maxY: 100).frame(height: 34)
                HStack {
                    Text("↓ " + Fmt.rate(s.rxRate))
                    Spacer()
                    Text("↑ " + Fmt.rate(s.txRate))
                    Spacer()
                    Text("load " + Fmt.num(s.load1))
                }
                .font(Fonts.mono(11))
                .foregroundStyle(Ink.ink)
                ForEach(l.alerts, id: \.self) { a in
                    Text("● " + a).font(Fonts.hand(14, bold: true)).foregroundStyle(Ink.red)
                }
            } else {
                Text(phaseText(l.phase))
                    .font(Fonts.hand(15))
                    .foregroundStyle(l.isOffline ? Ink.red : Ink.muted)
                    .lineLimit(3)
            }
        }
        .contentShape(Rectangle())
    }
}

/// A small isometric 2U box for the catalogue cards.
struct MiniRack: View {
    var health: Health
    var wash: Color
    var load: Double

    var body: some View {
        Canvas { ctx, size in
            let w: CGFloat = 100, d: CGFloat = 50, h: CGFloat = 26
            let s = min(size.width / ((w + d) * 0.866 + 8), size.height / ((w + d) * 0.5 + h + 10))
            let iso = Iso(origin: CGPoint(x: 4 + d * 0.866 * s, y: 4 + h * s), scale: s)
            let down = health == .down
            let b = Box3(x: 0, y: 0, z: 0, w: w, d: d, h: h)
            let shadow = [iso.p(0, 0, 0), iso.p(w, 0, 0), iso.p(w, d, 0), iso.p(0, d, 0)].map { CGPoint(x: $0.x + 5, y: $0.y + 5) }
            ctx.fill(Sketch.poly(shadow), with: .color(Ink.shadow.opacity(0.15)))
            ctx.box(iso, b, down ? Ink.shade : wash, seed: 900, width: 1.2, lit: health == .hot)
            for k in 0..<3 {
                let y0 = 5 + CGFloat(k) * 15
                let bay = [iso.p(w, y0, 5), iso.p(w, y0 + 12, 5), iso.p(w, y0 + 12, 13), iso.p(w, y0, 13)]
                ctx.ink(bay, closed: true, width: 0.8, amp: 0.2, seed: 910 + UInt64(k))
            }
            ctx.dot(iso.p(w, d - 5, 20), 2.6, health.color)
            for k in 0..<5 {
                let x = 12 + CGFloat(k) * 14
                ctx.ink([iso.p(x, d, 8), iso.p(x + 8, d, 8)], width: 0.8, amp: 0, seed: 920 + UInt64(k))
            }
            if !down && load > 0.005 {
                let f = CGFloat(min(1, load))
                let strip = [iso.p(10, 18, h), iso.p(10 + 80 * f, 18, h), iso.p(10 + 80 * f, 32, h), iso.p(10, 32, h)]
                ctx.marker(strip, Ink.load(load * 100), opacity: 1, seed: 930, offset: .zero, streaks: false)
            }
            if down {
                ctx.hatch(iso.outline(b), color: Ink.pencil.opacity(0.9), gap: 4)
                ctx.draw(Text("z z").font(Fonts.hand(14, bold: true)).foregroundStyle(Ink.pencil),
                         at: iso.p(20, 0, h + 14), anchor: .center)
            }
        }
    }
}

struct EmptyFleet: View {
    @Environment(FleetStore.self) private var store
    var body: some View {
        SketchCard(kicker: "Page one", title: "还是空白的一页") {
            HStack(alignment: .top, spacing: 24) {
                MiniRack(health: .unknown, wash: Ink.sky, load: 0).frame(width: 150, height: 110)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Rackbook 用你 Mac 上的 ssh 去读服务器的 /proc，不需要在服务器上安装任何东西。")
                    Text("1. 确认终端里 `ssh 你的主机` 能免密登录（密钥或 ssh-agent）。")
                    Text("2. 点「＋ 新舰船」，填主机（也可以是 ~/.ssh/config 里的别名），再加上登舰账户。")
                    Text("3. 有 sudo 的账户是舰长，没有的是领航员；一艘船可以挂多个账户随时切换。")
                    Button("＋ 让第一艘舰船入列") { store.editing = ServerConfig() }
                        .buttonStyle(SketchButtonStyle(kind: .solid))
                        .padding(.top, 6)
                }
                .font(Fonts.hand(16))
                .foregroundStyle(Ink.ink)
            }
        }
    }
}

// MARK: - Editor sheet

struct ServerEditor: View {
    @Environment(FleetStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ServerConfig
    @State private var original: ServerConfig
    @State private var portText: String
    @State private var passwords: [UUID: String] = [:]
    @State private var logins: [UUID: String] = [:]
    @State private var forget: Set<UUID> = []
    @State private var testing = false
    @State private var testMsg: String?
    @State private var testOK = false

    init(initial: ServerConfig) {
        _draft = State(initialValue: initial)
        _original = State(initialValue: initial)
        _portText = State(initialValue: String(initial.port))
    }

    private var isNew: Bool { !store.servers.contains { $0.id == draft.id } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            TitleBlock(kicker: isNew ? "New ship · 新舰船入列" : "Ship's log · 修改",
                       title: isNew ? "添加舰船（服务器）" : draft.title,
                       subtitle: "用 Mac 自带的 ssh：支持密钥、ssh-agent、密码登录、~/.ssh/config 别名和跳板机")
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    row("舰名") { SketchField(placeholder: "例如 web-01", text: $draft.name) }
                    row("主机") { SketchField(placeholder: "IP、域名，或 ~/.ssh/config 里的 Host 别名", text: $draft.host, mono: true) }
                    row("端口") {
                        HStack(spacing: 10) {
                            SketchField(placeholder: "22", text: $portText, mono: true).frame(width: 80)
                            Text("跳板机").font(Fonts.hand(15, bold: true)).foregroundStyle(Ink.ink)
                            SketchField(placeholder: "可选，例如 me@bastion", text: $draft.jumpHost, mono: true)
                        }
                    }
                    row("刷新间隔") {
                        Stepper(value: $draft.interval, in: 1...60, step: 1) {
                            Text("每 \(Int(draft.interval)) 秒读一次").font(Fonts.hand(16)).foregroundStyle(Ink.ink)
                        }
                    }
                    row("船体颜色") {
                        HStack(spacing: 8) {
                            ForEach(Ink.washes.map { $0.0 }, id: \.self) { name in
                                let on = draft.wash == name
                                let swatch = Ink.wash(name)
                                Canvas { ctx, size in
                                    let pts = Sketch.circle(CGPoint(x: size.width / 2, y: size.height / 2), size.width / 2 - 2, n: 12)
                                    ctx.marker(pts, swatch, opacity: 1, seed: 3, offset: .zero, streaks: false)
                                    ctx.ink(pts, closed: true, width: on ? 2.2 : 1, color: on ? Ink.red : Ink.ink, amp: 0.4, seed: 4)
                                }
                                .frame(width: 24, height: 24)
                                .contentShape(Rectangle())
                                .onTapGesture { draft.wash = name }
                            }
                        }
                    }

                    HStack {
                        Text("登舰账户 · 角色").font(Fonts.hand(14, bold: true)).tracking(1.2).foregroundStyle(Ink.red)
                        Spacer()
                        Button("＋ 添加账户") {
                            var a = Account()
                            a.label = "账户 \(draft.accounts.count + 1)"
                            draft.accounts.append(a)
                        }
                        .buttonStyle(SketchButtonStyle(kind: .chip))
                    }
                    Text("角色按 sudo 权限自动判定：有 sudo 的是舰长，没有的是领航员。sudo 要密码的账户，把密码存进钥匙串后才能执行舰长操作。")
                        .font(Fonts.hand(13)).foregroundStyle(Ink.muted).fixedSize(horizontal: false, vertical: true)
                    ForEach($draft.accounts) { $acct in
                        accountEditor($acct)
                    }
                }
                .padding(.trailing, 6)
            }
            if let m = testMsg {
                Text(m)
                    .font(Fonts.hand(15, bold: true))
                    .foregroundStyle(testOK ? Ink.okInk : Ink.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 10) {
                Button(testing ? "测试中…" : "用当前账户测试") { test() }
                    .buttonStyle(SketchButtonStyle(kind: .plain))
                    .disabled(draft.host.trimmed.isEmpty || testing)
                Spacer()
                Button("取消") { store.editing = nil; dismiss() }
                    .buttonStyle(SketchButtonStyle(kind: .plain))
                    .keyboardShortcut(.cancelAction)
                Button(isNew ? "入列" : "保存") { commit() }
                    .buttonStyle(SketchButtonStyle(kind: .solid))
                    .disabled(draft.host.trimmed.isEmpty || draft.accounts.isEmpty)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(28)
        .frame(width: 720, height: 760)
        .background(PaperBackground(grid: false))
    }

    private func accountEditor(_ acct: Binding<Account>) -> some View {
        let a = acct.wrappedValue
        let on = draft.activeAccount == a.id
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button(on ? "● 当前登舰" : "○ 设为当前") { draft.activeAccount = a.id }
                    .buttonStyle(SketchButtonStyle(kind: .chip, active: on))
                RoleBadge(privilege: a.privilege, small: true)
                Text(a.privilege.detail).font(Fonts.hand(12)).foregroundStyle(Ink.muted).lineLimit(1)
                Spacer()
                if draft.accounts.count > 1 {
                    Button("移除") {
                        forget.insert(a.id)
                        draft.accounts.removeAll { $0.id == a.id }
                        if draft.activeAccount == a.id { draft.activeAccount = draft.accounts.first?.id }
                    }
                    .buttonStyle(SketchButtonStyle(kind: .danger))
                }
            }
            HStack(spacing: 8) {
                SketchField(placeholder: "称呼，例如 运维舰长", text: acct.label).frame(width: 170)
                SketchField(placeholder: "用户名（留空 = 沿用 ssh 配置）", text: acct.user, mono: true)
            }
            HStack(spacing: 6) {
                Text("登录方式").font(Fonts.hand(14, bold: true)).foregroundStyle(Ink.ink)
                Button("密钥 / ssh-agent") { acct.wrappedValue.usePassword = false }
                    .buttonStyle(SketchButtonStyle(kind: .chip, active: !a.usePassword))
                Button("密码") { acct.wrappedValue.usePassword = true }
                    .buttonStyle(SketchButtonStyle(kind: .chip, active: a.usePassword))
            }
            if a.usePassword {
                SecureField(a.hasLoginPassword ? "钥匙串里已有登录密码（输入以替换）" : "登录密码（只存在这台 Mac 的钥匙串里）",
                            text: Binding(get: { logins[a.id] ?? "" }, set: { logins[a.id] = $0 }))
                    .textFieldStyle(.plain)
                    .font(Fonts.mono(13))
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(ZStack { Rectangle().fill(Ink.cream); SketchRect(amp: 0.6, inset: 1).stroke(Ink.ink.opacity(0.8), lineWidth: 1.1) })
                Text("连接建立时用一次密码，之后所有命令复用这条已认证的连接。sudo 密码留空时，默认与登录密码相同。")
                    .font(Fonts.hand(12)).foregroundStyle(Ink.muted).fixedSize(horizontal: false, vertical: true)
            } else {
                HStack(spacing: 8) {
                    SketchField(placeholder: "私钥（可选），例如 ~/.ssh/id_ed25519", text: acct.identityFile, mono: true)
                    Button("选择…") { if let p = pickKey() { acct.wrappedValue.identityFile = p } }
                        .buttonStyle(SketchButtonStyle(kind: .chip))
                }
            }
            HStack(spacing: 8) {
                SecureField(a.hasSudoPassword && !forget.contains(a.id) ? "钥匙串里已有 sudo 密码（输入以替换）"
                            : (a.usePassword ? "sudo 密码（留空 = 同登录密码）" : "sudo 密码（可选，只存钥匙串）"),
                            text: Binding(get: { passwords[a.id] ?? "" }, set: { passwords[a.id] = $0 }))
                    .textFieldStyle(.plain)
                    .font(Fonts.mono(13))
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(ZStack { Rectangle().fill(Ink.cream); SketchRect(amp: 0.6, inset: 1).stroke(Ink.ink.opacity(0.8), lineWidth: 1.1) })
                if a.hasSudoPassword && !forget.contains(a.id) {
                    Button("忘掉密码") { forget.insert(a.id) }.buttonStyle(SketchButtonStyle(kind: .chip))
                }
            }
        }
        .padding(12)
        .background(on ? Ink.gold.opacity(0.18) : Ink.cream.opacity(0.6))
        .overlay(SketchRect(amp: 0.6).stroke(on ? Ink.red : Ink.ink.opacity(0.6), lineWidth: on ? 1.6 : 1))
    }

    private func row<V: View>(_ label: String, @ViewBuilder _ content: () -> V) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Text(label)
                .font(Fonts.hand(15, bold: true))
                .foregroundStyle(Ink.ink)
                .frame(width: 80, alignment: .trailing)
            content()
        }
    }

    private func normalized() -> ServerConfig {
        var c = draft
        c.host = c.host.trimmed
        c.port = Int(portText.trimmed) ?? 22
        if c.name.trimmed.isEmpty { c.name = c.host }
        for i in c.accounts.indices {
            c.accounts[i].user = c.accounts[i].user.trimmed
            c.accounts[i].identityFile = c.accounts[i].identityFile.trimmed
            if let old = original.accounts.first(where: { $0.id == c.accounts[i].id }),
               old.user != c.accounts[i].user || old.identityFile != c.accounts[i].identityFile
                || old.usePassword != c.accounts[i].usePassword || c.host != original.host {
                c.accounts[i].privilege = .unknown
            }
        }
        if c.activeAccount == nil { c.activeAccount = c.accounts.first?.id }
        return c
    }

    private func pickKey() -> String? {
        let panel = NSOpenPanel()
        panel.showsHiddenFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: NSHomeDirectory() + "/.ssh")
        panel.prompt = "用这个私钥"
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        return url.path.replacingOccurrences(of: NSHomeDirectory(), with: "~")
    }

    private func test() {
        var draftCfg = normalized()
        for i in draftCfg.accounts.indices {
            if let pw = logins[draftCfg.accounts[i].id], !pw.isEmpty, Keychain.set(pw, for: draftCfg.accounts[i].loginKey) {
                draftCfg.accounts[i].hasLoginPassword = true
            }
        }
        let cfg = draftCfg.resolved
        testing = true
        testMsg = "正在呼叫 \(cfg.display)…"
        testOK = false
        Task {
            do {
                try await SSH.ensureMaster(cfg)
                let r = try await SSH.run(cfg, "uname -sr; hostname; id -un; if [ \"$(id -u)\" -eq 0 ]; then echo '舰长 (root)'; elif sudo -n true 2>/dev/null; then echo '舰长 (免密 sudo)'; else echo '领航员或需要 sudo 密码'; fi", timeout: 15)
                if r.ok {
                    testOK = true
                    testMsg = "接通了：" + r.out.split(separator: "\n").joined(separator: " · ")
                } else {
                    testMsg = "没接通：" + SSH.cleanErr(r.err, fallback: "退出码 \(r.code)")
                }
            } catch {
                testMsg = "没接通：" + error.localizedDescription
            }
            testing = false
        }
    }

    private func commit() {
        var c = normalized()
        for i in c.accounts.indices {
            let id = c.accounts[i].id
            if forget.contains(id) {
                Keychain.delete(c.accounts[i].keychainKey)
                c.accounts[i].hasSudoPassword = false
                if c.accounts[i].privilege == .password { c.accounts[i].privilege = .unknown }
            }
            if let pw = passwords[id], !pw.isEmpty, Keychain.set(pw, for: c.accounts[i].keychainKey) {
                c.accounts[i].hasSudoPassword = true
                c.accounts[i].privilege = .unknown
            }
            if let pw = logins[id], !pw.isEmpty, Keychain.set(pw, for: c.accounts[i].loginKey) {
                c.accounts[i].hasLoginPassword = true
                c.accounts[i].privilege = .unknown
            }
            if !c.accounts[i].usePassword && c.accounts[i].hasLoginPassword {
                Keychain.delete(c.accounts[i].loginKey)
                c.accounts[i].hasLoginPassword = false
            }
        }
        for gone in original.accounts where !c.accounts.contains(where: { $0.id == gone.id }) {
            Keychain.delete(gone.keychainKey)
            Keychain.delete(gone.loginKey)
        }
        store.save(c)
        store.editing = nil
        dismiss()
    }
}
