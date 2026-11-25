import SwiftUI

struct ConsoleRun: Identifiable {
    let id = UUID()
    let cmd: String
    let start = Date()
    var out = ""
    var err = ""
    var code: Int32? = nil
    var seconds: Double = 0
}

struct ConsoleTab: View {
    @Environment(FleetStore.self) private var store
    let cfg: ServerConfig
    @State private var runs: [ConsoleRun] = []
    @State private var cmd = ""
    @State private var recall: [String] = []

    private let snippets = [
        "uptime", "free -h", "df -h", "top -bn1 | head -n 20", "ss -tunlp | head -n 30",
        "docker ps", "journalctl -n 60 --no-pager", "last -n 10", "systemctl --failed"
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SketchCard(kicker: "Console", title: "在「\(cfg.title)」上执行命令", seed: 91) {
                HStack(spacing: 8) {
                    Text("$").font(Fonts.mono(16, bold: true)).foregroundStyle(Ink.red)
                    SketchField(placeholder: "输入命令后回车（非交互式；需要交互的程序请用「终端」）", text: $cmd, mono: true) { submit() }
                    Button("执行") { submit() }
                        .buttonStyle(SketchButtonStyle(kind: .solid))
                        .disabled(cmd.trimmed.isEmpty)
                    Button("在终端打开") { store.openTerminal(cfg.id) }
                        .buttonStyle(SketchButtonStyle(kind: .plain))
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(snippets, id: \.self) { s in
                            Button(s) { cmd = s; submit() }.buttonStyle(SketchButtonStyle(kind: .chip))
                        }
                    }
                    .padding(.vertical, 2)
                }
            }

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if runs.isEmpty {
                            Text("这里像一卷收据纸：每条命令和它的输出依次往下记。")
                                .font(Fonts.hand(16)).foregroundStyle(Ink.muted)
                        }
                        ForEach(runs) { r in
                            receipt(r).id(r.id)
                        }
                    }
                    .padding(18)
                }
                .background(
                    ZStack {
                        Rectangle().fill(Ink.cream.opacity(0.95))
                        SketchRect(seed: 92).stroke(Ink.ink, lineWidth: 1.3)
                    }
                )
                .onChange(of: runs.count) { _, _ in
                    if let last = runs.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            HStack {
                Footnote(text: "每条命令单独开一次 SSH 会话（复用连接），超时 120 秒。")
                Spacer()
                Button("清空") { runs.removeAll(); store.say("收据纸撕掉了。") }
                    .buttonStyle(SketchButtonStyle(kind: .chip))
            }
        }
        .padding(24)
    }

    private func receipt(_ r: ConsoleRun) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("$ " + r.cmd).font(Fonts.mono(13, bold: true)).foregroundStyle(Ink.ink).textSelection(.enabled)
                Spacer()
                Text(Fmt.clock(r.start)).font(Fonts.mono(10)).foregroundStyle(Ink.muted)
            }
            if !r.out.isEmpty {
                Text(r.out).font(Fonts.mono(12)).foregroundStyle(Ink.ink).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !r.err.trimmed.isEmpty {
                Text(r.err).font(Fonts.mono(12)).foregroundStyle(Ink.red).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let c = r.code {
                Text("退出码 \(c) · \(Fmt.num(r.seconds, 2)) 秒")
                    .font(Fonts.hand(13)).foregroundStyle(c == 0 ? Ink.okInk : Ink.red)
            } else {
                Text("运行中…").font(Fonts.hand(13)).foregroundStyle(Ink.wood)
            }
            SketchRule(seed: 93).stroke(Ink.pencil, style: StrokeStyle(lineWidth: 0.8, dash: [4, 3])).frame(height: 4)
        }
    }

    private func submit() {
        let c = cmd.trimmed
        guard !c.isEmpty else { return }
        guard store.live[cfg.id]?.phase == .online else {
            store.say("还不行：「\(cfg.title)」现在没接通，命令发不出去。", .refuse)
            return
        }
        let run = ConsoleRun(cmd: c)
        runs.append(run)
        recall.append(c)
        cmd = ""
        store.say("正在「\(cfg.title)」上执行：\(c)")
        Task {
            let r = await store.run(cfg.id, c, timeout: 120)
            if let i = runs.firstIndex(where: { $0.id == run.id }) {
                runs[i].out = String(r.out.prefix(200_000))
                runs[i].err = r.err
                runs[i].code = r.code
                runs[i].seconds = Date().timeIntervalSince(run.start)
            }
            store.say("「\(c)」结束，退出码 \(r.code)。", r.code == 0 ? .ok : .warn)
        }
    }
}
