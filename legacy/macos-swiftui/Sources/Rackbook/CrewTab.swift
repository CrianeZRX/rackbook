import SwiftUI

// MARK: - Role stamp: 舰长 (captain, has sudo) / 领航员 (navigator, no sudo)

struct RoleBadge: View {
    var privilege: Privilege
    var small = false

    var body: some View {
        let color: Color = privilege == .unknown ? Ink.muted : (privilege.isCaptain ? Ink.red : Ink.shadow)
        Text((privilege.isCaptain ? "★ " : (privilege == .none ? "✦ " : "")) + privilege.roleName)
            .font(Fonts.hand(small ? 12 : 14, bold: true))
            .foregroundStyle(color)
            .padding(.horizontal, small ? 5 : 7)
            .padding(.vertical, small ? 0 : 1)
            .background(
                ZStack {
                    Rectangle().fill((privilege.isCaptain ? Ink.rose : Ink.sky).opacity(privilege == .unknown ? 0.1 : 0.22))
                    SketchRect(amp: 0.5, inset: 0.5).stroke(color, lineWidth: 1.2)
                }
            )
            .rotationEffect(.degrees(-3))
            .help(privilege.detail)
    }
}

extension FleetStore {
    func setSudoPassword(_ id: UUID, account: UUID, _ password: String?) {
        guard let i = servers.firstIndex(where: { $0.id == id }),
              let j = servers[i].accounts.firstIndex(where: { $0.id == account }) else { return }
        let key = servers[i].accounts[j].keychainKey
        if let pw = password, !pw.isEmpty {
            guard Keychain.set(pw, for: key) else {
                say("没能存进钥匙串。", .warn)
                return
            }
            servers[i].accounts[j].hasSudoPassword = true
            say("sudo 密码已存进钥匙串，正在验证…")
        } else {
            Keychain.delete(key)
            servers[i].accounts[j].hasSudoPassword = false
            say("已从钥匙串删除 sudo 密码。")
        }
        persist()
        if servers[i].active?.id == account && !servers[i].paused { reprobe(id) }
        else { servers[i].accounts[j].privilege = .unknown; persist() }
    }
}

// MARK: - Header switcher

struct AccountSwitcher: View {
    @Environment(FleetStore.self) private var store
    let cfg: ServerConfig
    @State private var open = false

    var body: some View {
        let a = cfg.active
        Button {
            open.toggle()
        } label: {
            HStack(spacing: 6) {
                RoleBadge(privilege: a?.privilege ?? .unknown, small: true)
                Text(a?.title ?? "—").font(Fonts.hand(15, bold: true)).lineLimit(1)
                Text("▾").font(Fonts.hand(13))
            }
        }
        .buttonStyle(SketchButtonStyle(kind: .plain))
        .popover(isPresented: $open, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 10) {
                Text("以谁的身份登舰？").font(Fonts.hand(13, bold: true)).tracking(1).foregroundStyle(Ink.red)
                ForEach(cfg.accounts) { acct in
                    let on = acct.id == cfg.active?.id
                    Button {
                        open = false
                        store.switchAccount(cfg.id, to: acct.id)
                    } label: {
                        HStack(spacing: 8) {
                            Text(on ? "●" : "○").font(Fonts.hand(14)).foregroundStyle(on ? Ink.red : Ink.muted)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(acct.title).font(Fonts.hand(16, bold: true)).foregroundStyle(Ink.ink)
                                Text((acct.user.isEmpty ? "（沿用 ssh 配置）" : acct.user) + " · " + acct.privilege.detail)
                                    .font(Fonts.hand(12)).foregroundStyle(Ink.muted).lineLimit(1)
                            }
                            Spacer(minLength: 12)
                            RoleBadge(privilege: acct.privilege, small: true)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                SketchRule(seed: 44).stroke(Ink.pencil, lineWidth: 0.8).frame(height: 3)
                Button("管理账户与角色…") { open = false; store.editing = cfg }
                    .buttonStyle(SketchButtonStyle(kind: .chip))
            }
            .padding(16)
            .frame(width: 360)
            .background(Ink.cream)
        }
    }
}

// MARK: - Crew tab

struct RemoteUser: Identifiable, Hashable {
    var id: String { name }
    var name: String
    var uid: Int
    var home: String
    var shell: String
    var captain: Bool
    var docker: Bool
    var disabled: Bool { shell.hasSuffix("nologin") || shell.hasSuffix("/false") }
}

struct CrewTab: View {
    @Environment(FleetStore.self) private var store
    let cfg: ServerConfig
    let live: ServerLive

    struct Change: Identifiable { let id = UUID(); let user: RemoteUser; let action: String }

    @State private var users: [RemoteUser] = []
    @State private var loading = false
    @State private var loginName = ""
    @State private var change: Change?
    @State private var pwFor: Account?
    @State private var pwText = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                rules
                HStack(alignment: .top, spacing: 18) {
                    accountsCard
                    remoteCard
                }
            }
            .padding(24)
        }
        .task { if live.phase == .online && users.isEmpty { await loadUsers() } }
        .confirmationDialog("调整船员角色？",
                            isPresented: Binding(get: { change != nil }, set: { if !$0 { change = nil } }),
                            presenting: change) { c in
            Button(label(c), role: .destructive) { apply(c) }
            Button("取消", role: .cancel) {}
        } message: { c in
            Text("将以舰长 \(cfg.active?.title ?? "") 的身份在「\(cfg.title)」上修改 \(c.user.name) 的用户组。对方下次登录后生效。")
        }
        .sheet(item: $pwFor) { acct in
            VStack(alignment: .leading, spacing: 14) {
                TitleBlock(kicker: "Keychain · 钥匙串", title: "\(acct.title) 的 sudo 密码",
                           subtitle: "只存在这台 Mac 的钥匙串里，用来让舰长执行 sudo")
                SecureField("sudo 密码", text: $pwText)
                    .textFieldStyle(.plain)
                    .font(Fonts.mono(14))
                    .padding(8)
                    .background(ZStack { Rectangle().fill(Ink.cream); SketchRect().stroke(Ink.ink, lineWidth: 1.1) })
                    .onSubmit { savePw(acct) }
                HStack {
                    if acct.hasSudoPassword {
                        Button("删除已存密码") {
                            store.setSudoPassword(cfg.id, account: acct.id, nil)
                            pwFor = nil
                        }
                        .buttonStyle(SketchButtonStyle(kind: .danger))
                    }
                    Spacer()
                    Button("取消") { pwFor = nil }.buttonStyle(SketchButtonStyle(kind: .plain))
                    Button("存进钥匙串") { savePw(acct) }
                        .buttonStyle(SketchButtonStyle(kind: .solid))
                        .disabled(pwText.isEmpty)
                }
            }
            .padding(26)
            .frame(width: 480)
            .background(PaperBackground(grid: false))
        }
    }

    private var rules: some View {
        SketchCard(kicker: "Ship's rules", title: "两种角色，按 sudo 权限划分", seed: 140) {
            HStack(alignment: .top, spacing: 24) {
                VStack(alignment: .leading, spacing: 4) {
                    RoleBadge(privilege: .root)
                    Text("舰长：root、免密 sudo，或者在 sudo/wheel 组里并存了 sudo 密码。可以重启服务、管理 Docker、调整船员角色。")
                        .font(Fonts.hand(14)).foregroundStyle(Ink.ink).fixedSize(horizontal: false, vertical: true)
                }
                VStack(alignment: .leading, spacing: 4) {
                    RoleBadge(privilege: .none)
                    Text("领航员：没有 sudo。能看全部仪表、管自己的进程和文件；需要 sudo 的操作会被拒绝，并说明原因。")
                        .font(Fonts.hand(14)).foregroundStyle(Ink.ink).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // In-app accounts used to board this server
    private var accountsCard: some View {
        SketchCard(kicker: "Boarding accounts", title: "登舰账户（这台 Mac 上）", seed: 141) {
            ForEach(cfg.accounts) { acct in
                let on = acct.id == cfg.active?.id
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        RoleBadge(privilege: acct.privilege)
                        Text(acct.title).font(Fonts.hand(18, bold: true)).foregroundStyle(Ink.ink)
                        if on { Text("· 当前").font(Fonts.hand(14, bold: true)).foregroundStyle(Ink.red) }
                        Spacer()
                    }
                    Text("\(acct.user.isEmpty ? "（用户名沿用 ssh 配置）" : acct.user) · \(acct.authText)")
                        .font(Fonts.mono(11)).foregroundStyle(Ink.muted)
                    Text(acct.privilege.detail + (acct.hasSudoPassword ? " · 钥匙串里有 sudo 密码" : ""))
                        .font(Fonts.hand(13)).foregroundStyle(Ink.muted)
                    HStack(spacing: 6) {
                        if !on {
                            Button("以此登舰") { store.switchAccount(cfg.id, to: acct.id) }
                                .buttonStyle(SketchButtonStyle(kind: .chip))
                        } else {
                            Button("重新查验权限") {
                                guard !cfg.paused else { store.say("还不行：先接通再查验。", .refuse); return }
                                store.reprobe(cfg.id)
                            }
                            .buttonStyle(SketchButtonStyle(kind: .chip))
                        }
                        Button(acct.hasSudoPassword ? "改 sudo 密码…" : "存 sudo 密码…") {
                            pwText = ""
                            pwFor = acct
                        }
                        .buttonStyle(SketchButtonStyle(kind: .chip))
                    }
                }
                .padding(10)
                .background(on ? Ink.gold.opacity(0.22) : Color.clear)
                .overlay(SketchRect(amp: 0.6).stroke(on ? Ink.red : Ink.ink.opacity(0.5), lineWidth: on ? 1.6 : 0.9))
            }
            Button("＋ 添加 / 编辑账户…") { store.editing = cfg }
                .buttonStyle(SketchButtonStyle(kind: .plain))
        }
        .frame(width: 440)
    }

    // Real accounts on the server and their roles
    private var remoteCard: some View {
        let p = store.privilege(cfg.id)
        return SketchCard(kicker: "Crew manifest", title: "舰上的船员（服务器账户）", seed: 142) {
            HStack {
                Text(p.canSudo ? "你是舰长，可以调整船员角色。" : "你是\(p.roleName)，只能查看；调整角色需要舰长。")
                    .font(Fonts.hand(14)).foregroundStyle(p.canSudo ? Ink.okInk : Ink.muted)
                Spacer()
                Button(loading ? "读取中…" : "↻ 读取") { Task { await loadUsers() } }
                    .buttonStyle(SketchButtonStyle(kind: .chip))
                    .disabled(loading)
            }
            if users.isEmpty {
                Text(live.phase == .online ? (loading ? "正在读取 /etc/passwd…" : "点「读取」列出船员。")
                                           : "接通以后才能读取船员名单。")
                    .font(Fonts.hand(15)).foregroundStyle(Ink.muted)
            }
            ForEach(users) { u in
                HStack(spacing: 10) {
                    RoleBadge(privilege: u.uid == 0 ? .root : (u.captain ? .nopasswd : .none), small: true)
                        .frame(width: 74, alignment: .leading)
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 6) {
                            Text(u.name).font(Fonts.mono(13, bold: true)).foregroundStyle(Ink.ink)
                            if u.name == loginName { Text("← 正在登舰").font(Fonts.hand(12, bold: true)).foregroundStyle(Ink.red) }
                            if u.docker { Text("· 货舱").font(Fonts.hand(12)).foregroundStyle(Ink.wood) }
                            if u.disabled { Text("· 不能登录").font(Fonts.hand(12)).foregroundStyle(Ink.muted) }
                        }
                        Text("uid \(u.uid) · \(u.home) · \(u.shell)").font(Fonts.mono(10)).foregroundStyle(Ink.muted).lineLimit(1)
                    }
                    Spacer()
                    if u.uid != 0 {
                        if u.captain {
                            Button("降为领航员") { ask(u, "demote") }.buttonStyle(SketchButtonStyle(kind: .danger))
                        } else {
                            Button("升为舰长") { ask(u, "promote") }.buttonStyle(SketchButtonStyle(kind: .chip))
                        }
                        Button(u.docker ? "移出货舱" : "进入货舱") { ask(u, u.docker ? "undock" : "dock") }
                            .buttonStyle(SketchButtonStyle(kind: .chip))
                            .help("docker 组：不用 sudo 就能管理 Docker")
                    }
                }
                .padding(.vertical, 4)
            }
            Footnote(text: "角色按 sudo / wheel / admin 组判断；通过 /etc/sudoers 单独授权的账户这里看不出来。")
        }
    }

    // MARK: Actions

    private func label(_ c: Change) -> String {
        switch c.action {
        case "promote": return "把 \(c.user.name) 升为舰长（加入 sudo/wheel 组）"
        case "demote": return "把 \(c.user.name) 降为领航员（移出 sudo/wheel/admin 组）"
        case "dock": return "让 \(c.user.name) 进入货舱（加入 docker 组）"
        default: return "让 \(c.user.name) 移出货舱（移出 docker 组）"
        }
    }

    private func ask(_ u: RemoteUser, _ action: String) {
        let p = store.privilege(cfg.id)
        guard p.canSudo else {
            store.say(p == .needsPassword ? "还不行：先给舰长 \(cfg.active?.title ?? "") 存一个 sudo 密码。"
                                          : "还不行：你现在是领航员，调整船员角色需要舰长。", .refuse)
            return
        }
        if action == "demote" && u.name == loginName {
            store.say("还不行：不能把正在登舰的自己降为领航员，否则会把自己锁在门外。换一个舰长账户再操作。", .refuse)
            return
        }
        if action == "dock" || action == "undock", !(live.snap?.hasDocker ?? false) {
            store.say("还不行：这艘船上没装 Docker。", .refuse)
            return
        }
        change = Change(user: u, action: action)
    }

    private func apply(_ c: Change) {
        let u = shq(c.user.name)
        let cmd: String
        switch c.action {
        case "promote":
            cmd = "if getent group sudo >/dev/null; then usermod -aG sudo \(u); else usermod -aG wheel \(u); fi"
        case "demote":
            cmd = "for g in sudo wheel admin; do getent group $g >/dev/null && gpasswd -d \(u) $g >/dev/null 2>&1; done; true"
        case "dock":
            cmd = "usermod -aG docker \(u)"
        default:
            cmd = "gpasswd -d \(u) docker"
        }
        Task {
            let r = await store.sudo(cfg.id, cmd)
            if r.ok {
                store.say("完成：\(label(c))。", .ok)
                await loadUsers()
            } else {
                store.say("没成功：" + SSH.cleanErr(r.err, fallback: "退出码 \(r.code)"), .refuse)
            }
        }
    }

    private func savePw(_ acct: Account) {
        guard !pwText.isEmpty else { return }
        store.setSudoPassword(cfg.id, account: acct.id, pwText)
        pwText = ""
        pwFor = nil
    }

    private func loadUsers() async {
        loading = true
        let cmd = "id -un; echo @@U; getent passwd | awk -F: '$3==0 || ($3>=1000 && $3<65534) {print $1\":\"$3\":\"$6\":\"$7}'; " +
                  "echo @@G; for g in sudo wheel admin docker; do getent group $g; done"
        let r = await store.run(cfg.id, cmd, timeout: 20)
        loading = false
        guard r.ok else {
            store.say("没读到船员名单：" + SSH.cleanErr(r.err, fallback: "退出码 \(r.code)"), .refuse)
            return
        }
        var section = "ME"
        var rows: [(String, Int, String, String)] = []
        var captains = Set<String>(), dockers = Set<String>()
        for line in r.out.split(separator: "\n") {
            let t = line.trimmingCharacters(in: .whitespaces)
            if t == "@@U" { section = "U"; continue }
            if t == "@@G" { section = "G"; continue }
            switch section {
            case "ME": loginName = t
            case "U":
                let f = t.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
                if f.count >= 4, let uid = Int(f[1]) { rows.append((f[0], uid, f[2], f[3])) }
            default:
                let f = t.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
                guard f.count >= 4 else { continue }
                let members = f[3].split(separator: ",").map(String.init)
                if f[0] == "docker" { dockers.formUnion(members) } else { captains.formUnion(members) }
            }
        }
        users = rows.map { RemoteUser(name: $0.0, uid: $0.1, home: $0.2, shell: $0.3,
                                      captain: $0.1 == 0 || captains.contains($0.0), docker: dockers.contains($0.0)) }
            .sorted { ($0.uid == 0 ? -1 : $0.uid) < ($1.uid == 0 ? -1 : $1.uid) }
        let caps = users.filter(\.captain).count
        store.say("船员名单：\(users.count) 人，其中舰长 \(caps) 人、领航员 \(users.count - caps) 人。")
    }
}
