import SwiftUI

struct ServiceRow: Identifiable, Hashable {
    var id: String { name }
    var name: String
    var sub: String
    var desc: String
}

struct ProcessesTab: View {
    @Environment(FleetStore.self) private var store
    let cfg: ServerConfig
    let live: ServerLive

    struct KillRequest: Identifiable { let id = UUID(); let proc: ProcRow; let hard: Bool }
    struct ServiceRequest: Identifiable { let id = UUID(); let name: String; let verb: String }

    @State private var query = ""
    @State private var sortMem = false
    @State private var killing: KillRequest?
    @State private var services: [ServiceRow] = []
    @State private var svcQuery = ""
    @State private var loadingSvc = false
    @State private var svcAction: ServiceRequest?
    @State private var logTitle = ""
    @State private var logText: String?

    private var rows: [ProcRow] {
        let base = live.snap?.procs ?? []
        let sorted = sortMem ? base.sorted { $0.rss > $1.rss } : base
        let q = query.trimmed.lowercased()
        guard !q.isEmpty else { return sorted }
        return sorted.filter { $0.command.lowercased().contains(q) || $0.user.lowercased().contains(q) || String($0.pid) == q }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 18) {
            processCard
            serviceCard.frame(width: 400)
        }
        .padding(24)
        .confirmationDialog("结束这个进程？",
                            isPresented: Binding(get: { killing != nil }, set: { if !$0 { killing = nil } }),
                            presenting: killing) { k in
            Button(k.hard ? "强制结束 (SIGKILL) \(k.proc.pid)" : "结束 (SIGTERM) \(k.proc.pid)", role: .destructive) {
                sendSignal(k)
            }
            Button("取消", role: .cancel) {}
        } message: { k in
            Text("「\(k.proc.command)」，PID \(k.proc.pid)，属于 \(k.proc.user)。" + (k.hard ? "SIGKILL 不给进程收尾的机会。" : "SIGTERM 会请它自行退出。"))
        }
        .confirmationDialog("对服务执行操作？",
                            isPresented: Binding(get: { svcAction != nil }, set: { if !$0 { svcAction = nil } }),
                            presenting: svcAction) { a in
            Button("\(a.verb == "restart" ? "重启" : "停止") \(a.name)", role: .destructive) { service(a) }
            Button("取消", role: .cancel) {}
        } message: { a in
            Text("将以舰长 \(cfg.active?.title ?? "") 的身份在「\(cfg.title)」上执行 systemctl \(a.verb) \(a.name)。")
        }
        .sheet(isPresented: Binding(get: { logText != nil }, set: { if !$0 { logText = nil } })) {
            VStack(alignment: .leading, spacing: 12) {
                TitleBlock(kicker: "journalctl", title: logTitle)
                ScrollView {
                    Text(logText ?? "")
                        .font(Fonts.mono(11))
                        .foregroundStyle(Ink.ink)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(10)
                .background(Ink.cream)
                .overlay(SketchRect().stroke(Ink.ink, lineWidth: 1.1))
                HStack { Spacer(); Button("合上") { logText = nil }.buttonStyle(SketchButtonStyle(kind: .solid)) }
            }
            .padding(24)
            .frame(width: 860, height: 560)
            .background(PaperBackground(grid: false))
        }
    }

    private var processCard: some View {
        SketchCard(kicker: "Processes", title: "进程 · 按\(sortMem ? "内存" : " CPU")排序") {
            HStack(spacing: 8) {
                SketchField(placeholder: "筛选命令、用户或 PID…", text: $query)
                Button("按 CPU") { sortMem = false; store.say("按 CPU 排序（ps 的 %CPU 是进程生命周期内的平均值）。") }
                    .buttonStyle(SketchButtonStyle(kind: .chip, active: !sortMem))
                Button("按内存") { sortMem = true; store.say("按常驻内存 (RSS) 排序。") }
                    .buttonStyle(SketchButtonStyle(kind: .chip, active: sortMem))
            }
            HStack(spacing: 8) {
                Text("PID").frame(width: 64, alignment: .leading)
                Text("用户").frame(width: 84, alignment: .leading)
                Text("CPU").frame(width: 110, alignment: .leading)
                Text("内存").frame(width: 80, alignment: .trailing)
                Text("命令").frame(maxWidth: .infinity, alignment: .leading)
                Text("").frame(width: 120)
            }
            .font(Fonts.hand(13, bold: true))
            .foregroundStyle(Ink.red)
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(rows) { p in
                        ProcLine(p: p) { hard in killing = KillRequest(proc: p, hard: hard) }
                    }
                }
            }
            .frame(maxHeight: .infinity)
            Footnote(text: "列表随每次采样刷新，显示占用最高的 80 个进程。")
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var serviceCard: some View {
        SketchCard(kicker: "Services", title: "systemd 服务（运行中）", seed: 61) {
            HStack(spacing: 8) {
                SketchField(placeholder: "筛选服务…", text: $svcQuery)
                Button(loadingSvc ? "读取中…" : (services.isEmpty ? "读取" : "重读")) { loadServices() }
                    .buttonStyle(SketchButtonStyle(kind: .plain))
                    .disabled(loadingSvc)
            }
            let q = svcQuery.trimmed.lowercased()
            let shown = q.isEmpty ? services : services.filter { $0.name.lowercased().contains(q) || $0.desc.lowercased().contains(q) }
            if services.isEmpty {
                Text(loadingSvc ? "正在问 systemctl…" : "点「读取」列出正在运行的服务。没有 systemd 的系统会是空的。")
                    .font(Fonts.hand(15)).foregroundStyle(Ink.muted)
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(shown) { s in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(s.name.replacingOccurrences(of: ".service", with: ""))
                                    .font(Fonts.mono(12, bold: true)).foregroundStyle(Ink.ink).lineLimit(1)
                                Spacer()
                                Text(s.sub).font(Fonts.hand(13)).foregroundStyle(Ink.okInk)
                            }
                            Text(s.desc).font(Fonts.hand(13)).foregroundStyle(Ink.muted).lineLimit(1)
                            HStack(spacing: 6) {
                                Button("日志") { showLog(s.name) }.buttonStyle(SketchButtonStyle(kind: .chip))
                                Button("重启") { askService(s.name, "restart") }.buttonStyle(SketchButtonStyle(kind: .chip))
                                Button("停止") { askService(s.name, "stop") }.buttonStyle(SketchButtonStyle(kind: .danger))
                            }
                        }
                        .padding(.vertical, 4)
                        .overlay(alignment: .bottom) {
                            SketchRule(seed: 90).stroke(Ink.pencil.opacity(0.6), lineWidth: 0.7).frame(height: 2).offset(y: 5)
                        }
                    }
                }
            }
            .frame(maxHeight: .infinity)
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    // MARK: Actions

    private func sendSignal(_ k: KillRequest) {
        let sig = k.hard ? "KILL" : "TERM"
        Task {
            let r = await store.run(cfg.id, "kill -\(sig) \(k.proc.pid)")
            if r.ok {
                store.say("已向 \(k.proc.command)（PID \(k.proc.pid)）发送 SIG\(sig)。", .ok)
                store.refreshNow(cfg.id)
            } else {
                let e = r.err.trimmed
                store.say("没结束掉 PID \(k.proc.pid)：" + (e.contains("not permitted") ? "权限不够（进程不属于当前用户）。" : e), .refuse)
            }
        }
    }

    private func loadServices() {
        loadingSvc = true
        store.say("正在读取「\(cfg.title)」上运行中的 systemd 服务…")
        Task {
            let r = await store.run(cfg.id, "systemctl list-units --type=service --state=running --no-legend --no-pager --plain 2>/dev/null | head -n 400")
            var list: [ServiceRow] = []
            for line in r.out.split(separator: "\n") {
                let f = line.split(whereSeparator: { $0 == " " || $0 == "\t" })
                guard f.count >= 4 else { continue }
                list.append(ServiceRow(name: String(f[0]), sub: String(f[3]), desc: f.dropFirst(4).joined(separator: " ")))
            }
            services = list
            loadingSvc = false
            store.say(list.isEmpty ? "没读到服务（这台可能没有 systemd）。" : "读到 \(list.count) 个运行中的服务。", list.isEmpty ? .warn : .ok)
        }
    }

    private func askService(_ name: String, _ verb: String) {
        let p = store.privilege(cfg.id)
        guard p.canSudo else {
            store.say(p == .needsPassword
                      ? "还不行：舰长 \(cfg.active?.title ?? "") 还没存 sudo 密码，去「船员」页补上。"
                      : "还不行：你现在是领航员，\(verb == "restart" ? "重启" : "停止")服务需要舰长（sudo）。可在右上角切换账户。", .refuse)
            return
        }
        svcAction = ServiceRequest(name: name, verb: verb)
    }

    private func service(_ a: ServiceRequest) {
        store.say("正在\(a.verb == "restart" ? "重启" : "停止") \(a.name)…")
        Task {
            let r = await store.sudo(cfg.id, "systemctl \(a.verb) \(shq(a.name))", timeout: 90)
            if r.ok {
                store.say("\(a.name) 已\(a.verb == "restart" ? "重启" : "停止")。", .ok)
                loadServices()
            } else {
                store.say("没成功：" + SSH.cleanErr(r.err, fallback: "退出码 \(r.code)"), .refuse)
            }
        }
    }

    private func showLog(_ name: String) {
        store.say("正在取 \(name) 的最近 200 行日志…")
        Task {
            var r = await store.run(cfg.id, "journalctl -u \(shq(name)) -n 200 --no-pager 2>&1", timeout: 30)
            if store.privilege(cfg.id).canSudo && (r.out.contains("not seeing messages") || r.out.trimmed.isEmpty) {
                r = await store.sudo(cfg.id, "journalctl -u \(shq(name)) -n 200 --no-pager", timeout: 30)
            }
            logTitle = name
            logText = r.out.isEmpty ? r.err : r.out
            store.say("这是 \(name) 的最近日志。")
        }
    }
}

struct ProcLine: View {
    let p: ProcRow
    var onKill: (Bool) -> Void
    @State private var hover = false

    var body: some View {
        HStack(spacing: 8) {
            Text("\(p.pid)").font(Fonts.mono(11)).frame(width: 64, alignment: .leading)
            Text(p.user).font(Fonts.mono(11)).lineLimit(1).frame(width: 84, alignment: .leading)
            HStack(spacing: 4) {
                MarkerBar(value: p.cpu / 100, color: Ink.load(p.cpu), height: 7)
                Text(Fmt.num(p.cpu, 1)).font(Fonts.mono(11)).frame(width: 38, alignment: .trailing)
            }
            .frame(width: 110)
            Text(Fmt.bytes(p.rss)).font(Fonts.mono(11)).frame(width: 80, alignment: .trailing)
            Text(p.command).font(Fonts.hand(15)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 4) {
                Button("结束") { onKill(false) }.buttonStyle(SketchButtonStyle(kind: .chip))
                Button("强杀") { onKill(true) }.buttonStyle(SketchButtonStyle(kind: .danger))
            }
            .opacity(hover ? 1 : 0.25)
            .frame(width: 120)
        }
        .foregroundStyle(Ink.ink)
        .padding(.vertical, 4)
        .padding(.horizontal, 4)
        .background(hover ? Ink.gold.opacity(0.25) : Color.clear)
        .onHover { hover = $0 }
    }
}
