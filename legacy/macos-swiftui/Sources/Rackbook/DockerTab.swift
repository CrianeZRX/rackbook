import SwiftUI

struct Container: Identifiable, Hashable {
    var id: String
    var name: String
    var image: String
    var state: String
    var status: String
    var ports: String
    var cpu: String = ""
    var mem: String = ""
    var memPerc: Double = 0
    var net: String = ""
    var running: Bool { state == "running" }
}

struct DockerImage: Identifiable, Hashable {
    var id: String
    var repo: String
    var size: String
    var created: String
}

/// The cargo hold: every container is a shipping container on deck.
struct DockerTab: View {
    @Environment(FleetStore.self) private var store
    let cfg: ServerConfig

    struct Pending: Identifiable { let id = UUID(); let verb: String; let target: String; let label: String }

    @State private var containers: [Container] = []
    @State private var images: [DockerImage] = []
    @State private var version = ""
    @State private var loaded = false
    @State private var busy = false
    @State private var showStopped = true
    @State private var filter = ""
    @State private var pending: Pending?
    @State private var logTitle = ""
    @State private var logText: String?

    private var shown: [Container] {
        let q = filter.trimmed.lowercased()
        return containers.filter { c in
            (showStopped || c.running) && (q.isEmpty || c.name.lowercased().contains(q) || c.image.lowercased().contains(q))
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SketchCard(kicker: "Cargo hold", title: "Docker 货舱", seed: 160) {
                    HStack(spacing: 14) {
                        stat("\(containers.filter(\.running).count)", "运行中")
                        stat("\(containers.count)", "货柜总数")
                        stat("\(images.count)", "镜像")
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(version.isEmpty ? "—" : "Docker \(version)").font(Fonts.mono(11)).foregroundStyle(Ink.muted)
                            Text(roleLine).font(Fonts.hand(13)).foregroundStyle(Ink.muted)
                        }
                    }
                    HStack(spacing: 8) {
                        SketchField(placeholder: "筛选货柜名或镜像…", text: $filter)
                        Button(showStopped ? "隐藏已停止" : "显示已停止") { showStopped.toggle() }
                            .buttonStyle(SketchButtonStyle(kind: .chip, active: !showStopped))
                        Button(busy ? "读取中…" : "↻ 刷新") { Task { await load(quiet: false) } }
                            .buttonStyle(SketchButtonStyle(kind: .plain))
                            .disabled(busy)
                    }
                }

                if loaded && containers.isEmpty {
                    Text("货舱是空的：这艘船上还没有容器。").font(Fonts.hand(16)).foregroundStyle(Ink.muted)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 330, maximum: 480), spacing: 16)], spacing: 16) {
                    ForEach(shown) { c in containerCard(c) }
                }

                SketchCard(kicker: "Images", title: "镜像", seed: 161) {
                    if images.isEmpty {
                        Text(loaded ? "没有镜像。" : "正在读取…").font(Fonts.hand(15)).foregroundStyle(Ink.muted)
                    }
                    ForEach(images) { im in
                        HStack(spacing: 10) {
                            Text(im.repo).font(Fonts.mono(12, bold: true)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                            Text(im.id).font(Fonts.mono(11)).foregroundStyle(Ink.muted).frame(width: 110, alignment: .leading)
                            Text(im.size).font(Fonts.mono(11)).frame(width: 80, alignment: .trailing)
                            Text(im.created).font(Fonts.hand(13)).foregroundStyle(Ink.muted).frame(width: 120, alignment: .leading)
                            Button("删除") { ask("rmi", im.id, "删除镜像 \(im.repo)") }
                                .buttonStyle(SketchButtonStyle(kind: .danger))
                        }
                        .foregroundStyle(Ink.ink)
                    }
                }
                Footnote(text: "每 6 秒自动刷新一次。账户在 docker 组里时直接运行 docker，否则由舰长通过 sudo 运行；领航员会被拒绝。")
            }
            .padding(24)
        }
        .task {
            while !Task.isCancelled {
                await load(quiet: loaded)
                try? await Task.sleep(for: .seconds(6))
            }
        }
        .confirmationDialog("确定吗？",
                            isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
                            presenting: pending) { p in
            Button(p.label, role: .destructive) { perform(p) }
            Button("取消", role: .cancel) {}
        } message: { p in
            Text(p.verb == "rm" || p.verb == "rmi" ? "删除后不能撤销。" : "将在「\(cfg.title)」上执行 docker \(p.verb)。")
        }
        .sheet(isPresented: Binding(get: { logText != nil }, set: { if !$0 { logText = nil } })) {
            VStack(alignment: .leading, spacing: 12) {
                TitleBlock(kicker: "docker logs --tail 300", title: logTitle)
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
            .frame(width: 900, height: 580)
            .background(PaperBackground(grid: false))
        }
    }

    private var roleLine: String {
        let p = store.privilege(cfg.id)
        let viaSudo = store.live[cfg.id]?.dockerSudo ?? false
        if viaSudo { return p.canSudo ? "通过 sudo（舰长）" : "需要舰长权限" }
        return "以 \(cfg.active?.title ?? "") 直接操作"
    }

    private func stat(_ big: String, _ note: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(big).font(Fonts.serif(26)).foregroundStyle(Ink.ink)
            Text(note).font(Fonts.hand(13)).foregroundStyle(Ink.muted)
        }
    }

    private func containerCard(_ c: Container) -> some View {
        let wash: Color = c.running ? Ink.sage : (c.state == "paused" ? Ink.gold : (c.state == "restarting" ? Ink.rose : Ink.shade))
        return SketchCard(wash: Ink.cream, lit: c.state == "restarting", seed: UInt64(abs(c.id.hashValue) % 1000)) {
            HStack(alignment: .top, spacing: 12) {
                CargoBox(color: wash, running: c.running).frame(width: 76, height: 52)
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.name).font(Fonts.hand(18, bold: true)).foregroundStyle(Ink.ink).lineLimit(1)
                    Text(c.image).font(Fonts.mono(11)).foregroundStyle(Ink.muted).lineLimit(1)
                    Text(c.status).font(Fonts.hand(13)).foregroundStyle(c.running ? Ink.okInk : Ink.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            if c.running {
                MiniMeter(label: "MEM", value: c.memPerc / 100, text: Fmt.pct(c.memPerc))
                HStack {
                    Text("CPU \(c.cpu.isEmpty ? "—" : c.cpu)")
                    Spacer()
                    Text(c.mem.isEmpty ? "" : c.mem)
                }
                .font(Fonts.mono(10)).foregroundStyle(Ink.ink)
                if !c.net.isEmpty {
                    Text("网络 \(c.net)").font(Fonts.mono(10)).foregroundStyle(Ink.muted)
                }
            }
            if !c.ports.isEmpty {
                Text(c.ports).font(Fonts.mono(10)).foregroundStyle(Ink.muted).lineLimit(2)
            }
            HStack(spacing: 6) {
                if c.running {
                    Button("重启") { ask("restart", c.name, "重启 \(c.name)") }.buttonStyle(SketchButtonStyle(kind: .chip))
                    Button("停止") { ask("stop", c.name, "停止 \(c.name)") }.buttonStyle(SketchButtonStyle(kind: .danger))
                } else {
                    Button("启动") { perform(Pending(verb: "start", target: c.name, label: "启动 \(c.name)")) }
                        .buttonStyle(SketchButtonStyle(kind: .chip))
                    Button("删除") { ask("rm", c.name, "删除货柜 \(c.name)") }.buttonStyle(SketchButtonStyle(kind: .danger))
                }
                Button("日志") { showLogs(c) }.buttonStyle(SketchButtonStyle(kind: .chip))
                Spacer()
            }
        }
    }

    // MARK: Remote

    private static func lines(_ s: String) -> [[String: Any]] {
        s.split(separator: "\n").compactMap {
            try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any]
        }
    }

    private func load(quiet: Bool) async {
        if busy { return }
        busy = true
        defer { busy = false }
        async let psR = store.docker(cfg.id, "ps -a --format '{{json .}}'")
        async let stR = store.docker(cfg.id, "stats --no-stream --format '{{json .}}'", timeout: 30)
        async let imR = store.docker(cfg.id, "images --format '{{json .}}'")
        async let vR = store.docker(cfg.id, "version --format '{{.Server.Version}}'")
        let (ps, st, im, v) = await (psR, stR, imR, vR)

        guard ps.ok else {
            if !quiet || !loaded {
                store.say("还不行：读不了货舱（" + SSH.cleanErr(ps.err, fallback: "退出码 \(ps.code)") + "）。", .refuse)
            }
            loaded = true
            return
        }
        var stats: [String: [String: Any]] = [:]
        for d in Self.lines(st.out) {
            if let n = d["Name"] as? String { stats[n] = d }
        }
        var list: [Container] = []
        for d in Self.lines(ps.out) {
            let name = (d["Names"] as? String) ?? ""
            let status = (d["Status"] as? String) ?? ""
            var state = (d["State"] as? String) ?? ""
            if state.isEmpty {
                state = status.hasPrefix("Up") ? (status.contains("Paused") ? "paused" : "running") : "exited"
            }
            var c = Container(id: (d["ID"] as? String) ?? name, name: name, image: (d["Image"] as? String) ?? "",
                              state: state, status: status, ports: (d["Ports"] as? String) ?? "")
            if let s = stats[name] {
                c.cpu = (s["CPUPerc"] as? String) ?? ""
                c.mem = (s["MemUsage"] as? String) ?? ""
                c.net = (s["NetIO"] as? String) ?? ""
                c.memPerc = Double(((s["MemPerc"] as? String) ?? "").replacingOccurrences(of: "%", with: "")) ?? 0
            }
            list.append(c)
        }
        list.sort { a, b in a.running != b.running ? a.running : a.name < b.name }
        containers = list
        images = Self.lines(im.out).map { d in
            let repo = (d["Repository"] as? String) ?? "<none>"
            let tag = (d["Tag"] as? String) ?? ""
            return DockerImage(id: (d["ID"] as? String) ?? repo, repo: tag.isEmpty ? repo : "\(repo):\(tag)",
                               size: (d["Size"] as? String) ?? "", created: (d["CreatedSince"] as? String) ?? "")
        }
        version = v.out.trimmed
        if !quiet {
            store.say("货舱清点完毕：\(list.filter(\.running).count) 个货柜在运行，共 \(list.count) 个；\(images.count) 个镜像。", .ok)
        }
        loaded = true
    }

    private func ask(_ verb: String, _ target: String, _ label: String) {
        guard canAct() else { return }
        pending = Pending(verb: verb, target: target, label: label)
    }

    private func canAct() -> Bool {
        let viaSudo = store.live[cfg.id]?.dockerSudo ?? false
        let p = store.privilege(cfg.id)
        if viaSudo && !p.canSudo {
            store.say(p == .needsPassword ? "还不行：这个账户不在 docker 组，需要舰长 sudo，但还没存 sudo 密码。"
                                          : "还不行：你是领航员，又不在 docker 组，管不了货舱。请换舰长账户，或让舰长把你加入货舱。", .refuse)
            return false
        }
        return true
    }

    private func perform(_ p: Pending) {
        guard canAct() else { return }
        store.say("正在\(p.label)…")
        Task {
            let r = await store.docker(cfg.id, "\(p.verb) \(shq(p.target))", timeout: 120)
            store.say(r.ok ? "完成：\(p.label)。" : "没成功：" + SSH.cleanErr(r.err, fallback: "退出码 \(r.code)"), r.ok ? .ok : .refuse)
            await load(quiet: true)
        }
    }

    private func showLogs(_ c: Container) {
        store.say("正在取 \(c.name) 的日志…")
        Task {
            let r = await store.docker(cfg.id, "logs --tail 300 --timestamps \(shq(c.name)) 2>&1", timeout: 30)
            logTitle = c.name
            logText = r.out.isEmpty ? r.err : r.out
            store.say("这是 \(c.name) 最近 300 行日志。")
        }
    }
}

/// A corrugated shipping container, drawn with the pen.
struct CargoBox: View {
    var color: Color
    var running: Bool
    var body: some View {
        Canvas { ctx, size in
            let iso = Iso(origin: CGPoint(x: 4 + 22 * 0.866 * 0.62, y: 4 + 22 * 0.62), scale: 0.62)
            let b = Box3(x: 0, y: 0, z: 0, w: 80, d: 22, h: 22)
            ctx.box(iso, b, color, seed: 700, width: 1.1)
            for k in 1..<10 {
                let x = CGFloat(k) * 8
                ctx.ink([iso.p(x, 22, 2), iso.p(x, 22, 20)], width: 0.6, amp: 0, seed: 710)
            }
            ctx.ink([iso.p(80, 11, 2), iso.p(80, 11, 20)], width: 1.0, amp: 0, seed: 720)
            if running {
                ctx.dot(iso.p(80, 4, 18), 2.4, Ink.gold)
            }
        }
    }
}
