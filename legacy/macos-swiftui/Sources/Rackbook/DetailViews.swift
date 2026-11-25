import SwiftUI

enum DetailTab: String, CaseIterable, Identifiable {
    case teardown, procs, docker, files, console, crew
    var id: String { rawValue }
    var title: String {
        switch self {
        case .teardown: return "拆解图"
        case .procs: return "进程 · 服务"
        case .docker: return "Docker 货舱"
        case .files: return "文件"
        case .console: return "命令"
        case .crew: return "船员 · 权限"
        }
    }
    var needsLink: Bool { self != .teardown && self != .crew }
}

struct ServerDetailView: View {
    @Environment(FleetStore.self) private var store
    let cfg: ServerConfig
    @State private var tab: DetailTab = .teardown

    var body: some View {
        let l = store.live[cfg.id] ?? ServerLive()
        VStack(alignment: .leading, spacing: 0) {
            header(l)
                .padding(.horizontal, 28)
                .padding(.top, 30)
                .padding(.bottom, 12)
            tabStrip(l)
                .padding(.horizontal, 28)
            Group {
                switch tab {
                case .teardown: TeardownTab(cfg: cfg, live: l)
                case .procs: ProcessesTab(cfg: cfg, live: l)
                case .docker: DockerTab(cfg: cfg)
                case .files: FileBrowser(cfg: cfg)
                case .console: ConsoleTab(cfg: cfg)
                case .crew: CrewTab(cfg: cfg, live: l)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func header(_ l: ServerLive) -> some View {
        let sub: String
        if let s = l.snap {
            sub = "\(s.os.isEmpty ? s.kernel : s.os) · 内核 \(s.kernel) · \(s.cores) 核 · 已运行 \(Fmt.uptime(s.uptime))"
        } else {
            sub = phaseText(l.phase)
        }
        return HStack(alignment: .bottom, spacing: 14) {
            TitleBlock(kicker: "Sheet No.\(store.index(of: cfg.id)) · \(cfg.display)", title: cfg.title, subtitle: sub)
            Spacer()
            HStack(spacing: 6) {
                HealthDot(health: l.health).frame(width: 14, height: 14)
                Text(l.health.label).font(Fonts.hand(16, bold: true)).foregroundStyle(Ink.ink)
                if let t = l.lastUpdate {
                    Text("· \(Fmt.clock(t))").font(Fonts.mono(11)).foregroundStyle(Ink.muted)
                }
            }
            AccountSwitcher(cfg: cfg)
            if l.isParked {
                Button("⚡ 接通") { store.connect(cfg.id) }.buttonStyle(SketchButtonStyle(kind: .solid))
            } else {
                Button("↻ 刷新") { store.refreshNow(cfg.id) }.buttonStyle(SketchButtonStyle(kind: .plain))
                Button("断开") { store.disconnect(cfg.id) }.buttonStyle(SketchButtonStyle(kind: .danger))
            }
            Button("终端") { store.openTerminal(cfg.id) }.buttonStyle(SketchButtonStyle(kind: .plain))
            Button("编辑") { store.editing = cfg }.buttonStyle(SketchButtonStyle(kind: .plain))
        }
    }

    private func tabStrip(_ l: ServerLive) -> some View {
        HStack(spacing: 0) {
            ForEach(DetailTab.allCases) { t in
                let on = tab == t
                Button {
                    if t.needsLink && l.isParked {
                        store.say("还不行：「\(cfg.title)」已断开停泊，\(t.title)要先点「接通」。", .refuse)
                        return
                    }
                    if t.needsLink && t != .crew && l.phase != .online {
                        store.say("还不行：「\(cfg.title)」还没接通，\(t.title)要等连上以后才能用。", .refuse)
                        return
                    }
                    if t == .docker && !(l.snap?.hasDocker ?? false) {
                        store.say("还不行：这艘船上没找到 docker 命令，没有货舱可管。", .refuse)
                        return
                    }
                    tab = t
                    store.say("翻到「\(t.title)」这一页。")
                } label: {
                    Text(t.title)
                        .font(Fonts.hand(17, bold: true))
                        .foregroundStyle(on ? Ink.ink : Ink.muted)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                        .background(
                            ZStack(alignment: .bottom) {
                                if on {
                                    Rectangle().fill(Ink.gold.opacity(0.55)).padding(.top, 14).offset(x: 2)
                                }
                            }
                        )
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .overlay(alignment: .bottom) {
            SketchRule(seed: 33).stroke(Ink.ink, lineWidth: 1.2).frame(height: 3)
        }
    }
}

// MARK: - Teardown tab

struct TeardownTab: View {
    @Environment(FleetStore.self) private var store
    let cfg: ServerConfig
    let live: ServerLive
    @State private var focus: Subsystem = .cpu
    @State private var exploded = true

    var body: some View {
        let s = (live.isOffline || live.isParked) ? nil : live.snap
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top, spacing: 18) {
                    SketchCard(kicker: "Teardown", title: exploded ? "拆开看：每个部件此刻在做什么" : "合上：一台完整的机器", seed: 3) {
                        TeardownView(snap: s, health: live.health, focus: $focus, exploded: exploded) { sub in
                            store.say(sub.sentence(s))
                        }
                        .frame(height: 500)
                        HStack(spacing: 8) {
                            Button(exploded ? "◂ 合上" : "拆开 ▸") {
                                exploded.toggle()
                                store.say(exploded ? "拆开了：盖板掀起，硬盘抽出，网卡和电源往后退。点任一部件看细节。"
                                                   : "合上了。数字仍在实时更新。")
                            }
                            .buttonStyle(SketchButtonStyle(kind: .solid))
                            ForEach(Subsystem.allCases) { sub in
                                Button(sub.title) {
                                    focus = sub
                                    store.say(sub.sentence(s))
                                }
                                .buttonStyle(SketchButtonStyle(kind: .chip, active: focus == sub))
                            }
                            Spacer()
                        }
                        Footnote(text: "风扇转速与数据包的动画按真实负载缩放，属示意；其余数字都来自 /proc。")
                    }
                    FocusPanel(sub: focus, snap: s, hist: live.hist)
                        .frame(width: 320)
                }

                LazyVGrid(columns: [GridItem(.flexible(), spacing: 18), GridItem(.flexible(), spacing: 18)], spacing: 18) {
                    ChartCard(kicker: "CPU", title: "处理器占用", big: s.map { Fmt.pct($0.cpu) } ?? "—",
                              note: s.map { "iowait \(Fmt.pct($0.iowait)) · 负载 \($0.loadText)" } ?? "",
                              lit: focus == .cpu,
                              lines: [SketchChart.Line(values: live.hist.cpu.values, color: Ink.gold)],
                              maxY: 100, format: { Fmt.pct($0) })
                        .onTapGesture { focus = .cpu; store.say(Subsystem.cpu.sentence(s)) }
                    ChartCard(kicker: "Memory", title: "内存占用", big: s.map { Fmt.pct($0.memFrac * 100) } ?? "—",
                              note: s.map { "\(Fmt.bytes($0.memUsed)) / \(Fmt.bytes($0.memTotal))" } ?? "",
                              lit: focus == .mem,
                              lines: [SketchChart.Line(values: live.hist.mem.values, color: Ink.blue)],
                              maxY: 100, format: { Fmt.pct($0) })
                        .onTapGesture { focus = .mem; store.say(Subsystem.mem.sentence(s)) }
                    ChartCard(kicker: "Network", title: "网络吞吐", big: s.map { "↓ " + Fmt.rate($0.rxRate) } ?? "—",
                              note: s.map { "↑ " + Fmt.rate($0.txRate) + "   蓝 = 下行，红 = 上行" } ?? "",
                              lit: focus == .net,
                              lines: [SketchChart.Line(values: live.hist.rx.values, color: Ink.sky),
                                      SketchChart.Line(values: live.hist.tx.values, color: Ink.rose, fill: false)],
                              maxY: nil, format: { Fmt.rate($0) })
                        .onTapGesture { focus = .net; store.say(Subsystem.net.sentence(s)) }
                    ChartCard(kicker: "Disk I/O", title: "磁盘读写", big: s.map { "读 " + Fmt.rate($0.ioRead) } ?? "—",
                              note: s.map { "写 " + Fmt.rate($0.ioWrite) + "   绿 = 读，棕 = 写" } ?? "",
                              lit: focus == .disk,
                              lines: [SketchChart.Line(values: live.hist.ioR.values, color: Ink.sage),
                                      SketchChart.Line(values: live.hist.ioW.values, color: Ink.wood, fill: false)],
                              maxY: nil, format: { Fmt.rate($0) })
                        .onTapGesture { focus = .disk; store.say(Subsystem.disk.sentence(s)) }
                    if let g = s?.gpus, !g.isEmpty {
                        ChartCard(kicker: "GPU", title: "显卡占用（平均）", big: Fmt.pct(s?.gpuUtil ?? 0),
                                  note: "\(g.count) 块 · " + g.map { $0.name }.joined(separator: ", "),
                                  lit: focus == .gpu,
                                  lines: [SketchChart.Line(values: live.hist.gpu.values, color: Ink.pink)],
                                  maxY: 100, format: { Fmt.pct($0) })
                            .onTapGesture { focus = .gpu; store.say(Subsystem.gpu.sentence(s)) }
                    }
                }

                HStack(alignment: .top, spacing: 18) {
                    DisksCard(snap: s, lit: focus == .disk)
                    NetCard(snap: s, lit: focus == .net)
                }
                Footnote(text: "历史曲线保留最近 150 次采样。CPU 与磁盘、网络速率由相邻两次读数相减得出。")
            }
            .padding(24)
        }
    }
}

struct FocusPanel: View {
    let sub: Subsystem
    let snap: Snapshot?
    let hist: History

    var body: some View {
        SketchCard(kicker: sub.tag, title: sub.title, lit: true, seed: 71) {
            if let s = snap {
                switch sub {
                case .cpu: cpu(s)
                case .mem: mem(s)
                case .gpu: gpu(s)
                case .net: net(s)
                case .disk: disk(s)
                }
            } else {
                Text("还没有数据。等服务器接通后，这里会列出\(sub.title)的细节。")
                    .font(Fonts.hand(15)).foregroundStyle(Ink.muted)
            }
        }
    }

    private func big(_ t: String, _ note: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(t).font(Fonts.serif(32)).foregroundStyle(Ink.ink).lineLimit(1).minimumScaleFactor(0.5)
            Text(note).font(Fonts.hand(14)).foregroundStyle(Ink.muted).lineLimit(2)
        }
    }

    @ViewBuilder private func cpu(_ s: Snapshot) -> some View {
        big(Fmt.pct(s.cpu), "\(s.cores) 核 · 运行队列 \(s.procsRunning) · iowait \(Fmt.pct(s.iowait))")
        Text("每个核一格（catalogue）").font(Fonts.hand(13, bold: true)).foregroundStyle(Ink.red)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 30, maximum: 40), spacing: 6)], spacing: 6) {
            ForEach(Array(s.perCore.enumerated()), id: \.offset) { i, v in
                CoreCell(index: i, pct: v)
            }
        }
        Text("负载 1 / 5 / 15 分钟：\(s.loadText)").font(Fonts.mono(11)).foregroundStyle(Ink.ink)
        Sparkline(values: hist.load.values, color: Ink.tan).frame(height: 30)
    }

    @ViewBuilder private func mem(_ s: Snapshot) -> some View {
        big(Fmt.bytes(s.memUsed), "共 \(Fmt.bytes(s.memTotal)) · 可用 \(Fmt.bytes(s.memAvail))")
        StackBar(parts: [(s.memUsed, Ink.blue), (s.memCache, Ink.sky), (max(0, s.memTotal - s.memUsed - s.memCache), Ink.cream)])
            .frame(height: 16)
        HStack(spacing: 10) {
            legendDot(Ink.blue, "已用")
            legendDot(Ink.sky, "缓存")
            legendDot(Ink.cream, "空闲")
        }
        if s.swapTotal > 0 {
            MiniMeter(label: "SWAP", value: s.swapUsed / s.swapTotal, text: Fmt.bytes(s.swapUsed))
        }
        Text("最占内存的进程").font(Fonts.hand(13, bold: true)).foregroundStyle(Ink.red).padding(.top, 4)
        ForEach(s.procs.sorted { $0.rss > $1.rss }.prefix(6)) { p in
            HStack {
                Text(p.command).font(Fonts.hand(14)).lineLimit(1)
                Spacer()
                Text(Fmt.bytes(p.rss)).font(Fonts.mono(11))
            }
            .foregroundStyle(Ink.ink)
        }
    }

    @ViewBuilder private func gpu(_ s: Snapshot) -> some View {
        if s.gpus.isEmpty {
            big("—", "没检测到显卡")
            Text("Rackbook 通过 nvidia-smi（NVIDIA）或 /sys/class/drm 的 amdgpu 节点读取显卡。都没有时，拆解图上画的是一个空的 PCIe 槽。")
                .font(Fonts.hand(14)).foregroundStyle(Ink.muted).fixedSize(horizontal: false, vertical: true)
        } else {
            big(Fmt.pct(s.gpuUtil), "\(s.gpus.count) 块显卡的平均占用")
            ForEach(s.gpus) { g in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text("#\(g.index) \(g.name)").font(Fonts.mono(12, bold: true)).lineLimit(1)
                        Spacer()
                        if let t = g.temp { Text("\(Int(t))°C").font(Fonts.mono(11)).foregroundStyle(t > 80 ? Ink.red : Ink.ink) }
                    }
                    MiniMeter(label: "UTIL", value: g.util / 100, text: Fmt.pct(g.util))
                    MiniMeter(label: "VRAM", value: g.memFrac, text: Fmt.pct(g.memFrac * 100))
                    Text("显存 \(Fmt.bytes(g.memUsed)) / \(Fmt.bytes(g.memTotal))" + (g.power.map { " · \(Int($0)) W" } ?? ""))
                        .font(Fonts.hand(13)).foregroundStyle(Ink.muted)
                }
                .foregroundStyle(Ink.ink)
            }
        }
    }

    @ViewBuilder private func net(_ s: Snapshot) -> some View {
        big("↓ " + Fmt.rate(s.rxRate), "↑ \(Fmt.rate(s.txRate)) · \(s.tcp) 个 TCP 连接")
        Text("网卡").font(Fonts.hand(13, bold: true)).foregroundStyle(Ink.red)
        ForEach(s.nets.prefix(8)) { n in
            VStack(alignment: .leading, spacing: 1) {
                Text(n.name).font(Fonts.mono(12, bold: true)).foregroundStyle(Ink.ink)
                HStack {
                    Text("↓ " + Fmt.rate(n.rxRate))
                    Spacer()
                    Text("↑ " + Fmt.rate(n.txRate))
                }
                .font(Fonts.mono(11)).foregroundStyle(Ink.muted)
            }
        }
    }

    @ViewBuilder private func disk(_ s: Snapshot) -> some View {
        big("读 " + Fmt.rate(s.ioRead), "写 \(Fmt.rate(s.ioWrite))")
        Text("挂载点").font(Fonts.hand(13, bold: true)).foregroundStyle(Ink.red)
        ForEach(s.mounts.prefix(8)) { m in
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(m.mount).font(Fonts.mono(12, bold: true)).lineLimit(1)
                    Spacer()
                    Text(Fmt.pct(m.frac * 100)).font(Fonts.mono(11))
                }
                .foregroundStyle(m.frac > 0.9 ? Ink.red : Ink.ink)
                MarkerBar(value: m.frac, color: Ink.load(m.frac * 100), height: 8)
            }
        }
    }

    private func legendDot(_ c: Color, _ t: String) -> some View {
        HStack(spacing: 4) {
            Rectangle().fill(c).frame(width: 10, height: 10).overlay(Rectangle().stroke(Ink.ink, lineWidth: 0.8))
            Text(t).font(Fonts.hand(13)).foregroundStyle(Ink.ink)
        }
    }
}

struct CoreCell: View {
    let index: Int
    let pct: Double
    var body: some View {
        VStack(spacing: 1) {
            Canvas { ctx, size in
                let f = CGFloat(max(0, min(1, pct / 100)))
                let h = size.height
                if f > 0.01 {
                    ctx.marker([CGPoint(x: 1, y: h - h * f), CGPoint(x: size.width - 1, y: h - h * f + 1),
                                CGPoint(x: size.width - 1, y: h), CGPoint(x: 1, y: h)],
                               Ink.load(pct), opacity: 1, seed: UInt64(index + 3), offset: .zero, streaks: false)
                }
                ctx.ink([CGPoint(x: 0, y: 0), CGPoint(x: size.width, y: 0), CGPoint(x: size.width, y: h), CGPoint(x: 0, y: h)],
                        closed: true, width: 1, amp: 0.4, seed: UInt64(index + 11))
            }
            .frame(height: 26)
            Text("c\(index)").font(Fonts.mono(9)).foregroundStyle(Ink.muted)
        }
        .help("核 \(index)：\(Fmt.pct(pct))")
    }
}

struct StackBar: View {
    let parts: [(Double, Color)]
    var body: some View {
        Canvas { ctx, size in
            let total = max(1, parts.reduce(0) { $0 + $1.0 })
            var x: CGFloat = 0
            for (i, p) in parts.enumerated() {
                let w = size.width * CGFloat(p.0 / total)
                if w > 0.5 {
                    ctx.marker([CGPoint(x: x, y: 0), CGPoint(x: x + w, y: 0), CGPoint(x: x + w, y: size.height), CGPoint(x: x, y: size.height)],
                               p.1, opacity: 1, seed: UInt64(i + 60), offset: .zero, streaks: true)
                    if i > 0 {
                        ctx.ink([CGPoint(x: x, y: 0), CGPoint(x: x, y: size.height)], width: 0.8, amp: 0, seed: UInt64(70 + i))
                    }
                }
                x += w
            }
            ctx.ink([CGPoint(x: 0, y: 0), CGPoint(x: size.width, y: 0), CGPoint(x: size.width, y: size.height), CGPoint(x: 0, y: size.height)],
                    closed: true, width: 1.1, amp: 0.5, seed: 80)
        }
    }
}

// MARK: - Charts drawn with the pen

struct SketchChart: View {
    struct Line {
        var values: [Double]
        var color: Color
        var fill: Bool = true
    }
    var lines: [Line]
    var maxY: Double? = nil
    var format: (Double) -> String

    static func niceCeil(_ v: Double) -> Double {
        guard v > 0, v.isFinite else { return 1 }
        let e = pow(10, floor(log10(v)))
        for m in [1.0, 2.0, 2.5, 5.0, 10.0] where m * e >= v { return m * e }
        return 10 * e
    }

    var body: some View {
        Canvas { ctx, size in
            let plot = CGRect(x: 62, y: 8, width: size.width - 68, height: size.height - 24)
            let dataMax = lines.flatMap(\.values).max() ?? 0
            let ymax = maxY ?? Self.niceCeil(max(dataMax * 1.15, 1024))
            for k in 0...3 {
                let y = plot.maxY - plot.height * CGFloat(k) / 3
                ctx.ink([CGPoint(x: plot.minX, y: y), CGPoint(x: plot.maxX, y: y)], width: 0.6,
                        color: Ink.pencil.opacity(0.6), amp: 0.4, seed: UInt64(k + 1) * 31)
                ctx.draw(Text(format(ymax * Double(k) / 3)).font(Fonts.mono(9)).foregroundStyle(Ink.muted),
                         at: CGPoint(x: plot.minX - 6, y: y), anchor: .trailing)
            }
            ctx.ink([CGPoint(x: plot.minX, y: plot.minY), CGPoint(x: plot.minX, y: plot.maxY), CGPoint(x: plot.maxX, y: plot.maxY)],
                    width: 1.3, seed: 5)
            ctx.draw(Text("← 最近 150 次采样").font(Fonts.hand(11)).foregroundStyle(Ink.muted),
                     at: CGPoint(x: plot.minX + 4, y: plot.maxY + 9), anchor: .leading)
            let cap = 150
            let step = plot.width / CGFloat(cap - 1)
            for line in lines {
                let vals = line.values
                guard vals.count >= 2 else { continue }
                let n = vals.count
                let x0 = plot.maxX - step * CGFloat(n - 1)
                let pts = vals.enumerated().map { (i, v) -> CGPoint in
                    CGPoint(x: x0 + step * CGFloat(i),
                            y: plot.maxY - plot.height * CGFloat(min(1, max(0, v / ymax))))
                }
                if line.fill {
                    var area = Path()
                    area.move(to: CGPoint(x: pts[0].x, y: plot.maxY))
                    for p in pts { area.addLine(to: p) }
                    area.addLine(to: CGPoint(x: pts[n - 1].x, y: plot.maxY))
                    area.closeSubpath()
                    ctx.fill(area, with: .color(line.color.opacity(0.45)))
                }
                var path = Path()
                path.addLines(pts)
                ctx.stroke(path, with: .color(Ink.darker(line.color, 0.45)),
                           style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
                ctx.dot(pts[n - 1], 3.4, Ink.red, ring: Ink.ink, ringWidth: 0.8)
            }
            if lines.allSatisfy({ $0.values.count < 2 }) {
                ctx.draw(Text("正在攒数据…").font(Fonts.hand(15)).foregroundStyle(Ink.muted),
                         at: CGPoint(x: plot.midX, y: plot.midY), anchor: .center)
            }
        }
    }
}

struct ChartCard: View {
    var kicker: String
    var title: String
    var big: String
    var note: String
    var lit: Bool
    var lines: [SketchChart.Line]
    var maxY: Double?
    var format: (Double) -> String

    var body: some View {
        SketchCard(kicker: kicker, title: title, lit: lit) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(big).font(Fonts.serif(26)).foregroundStyle(Ink.ink).lineLimit(1)
                Text(note).font(Fonts.hand(14)).foregroundStyle(Ink.muted).lineLimit(1)
            }
            SketchChart(lines: lines, maxY: maxY, format: format)
                .frame(height: 140)
        }
        .contentShape(Rectangle())
    }
}

struct DisksCard: View {
    let snap: Snapshot?
    let lit: Bool
    var body: some View {
        SketchCard(kicker: "Storage", title: "挂载点", lit: lit, seed: 51) {
            if let s = snap, !s.mounts.isEmpty {
                ForEach(s.mounts) { m in
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(m.mount).font(Fonts.hand(16, bold: true)).lineLimit(1)
                            Text("\(m.fs) · \(m.type)").font(Fonts.mono(10)).foregroundStyle(Ink.muted).lineLimit(1)
                        }
                        .frame(width: 170, alignment: .leading)
                        MarkerBar(value: m.frac, color: Ink.load(m.frac * 100), height: 11)
                        Text("\(Fmt.bytes(m.used)) / \(Fmt.bytes(m.used + m.avail))")
                            .font(Fonts.mono(11)).frame(width: 150, alignment: .trailing)
                        Text(Fmt.pct(m.frac * 100)).font(Fonts.mono(12, bold: true)).frame(width: 44, alignment: .trailing)
                    }
                    .foregroundStyle(m.frac > 0.9 ? Ink.red : Ink.ink)
                }
            } else {
                Text("没有可显示的挂载点。").font(Fonts.hand(15)).foregroundStyle(Ink.muted)
            }
        }
    }
}

struct NetCard: View {
    let snap: Snapshot?
    let lit: Bool
    var body: some View {
        SketchCard(kicker: "Interfaces", title: "网卡", lit: lit, seed: 52) {
            if let s = snap, !s.nets.isEmpty {
                HStack {
                    Text("名称").frame(width: 110, alignment: .leading)
                    Text("下行").frame(width: 92, alignment: .trailing)
                    Text("上行").frame(width: 92, alignment: .trailing)
                    Text("累计 收 / 发").frame(maxWidth: .infinity, alignment: .trailing)
                }
                .font(Fonts.hand(13, bold: true)).foregroundStyle(Ink.red)
                ForEach(s.nets.prefix(10)) { n in
                    HStack {
                        Text(n.name).font(Fonts.mono(12, bold: true)).frame(width: 110, alignment: .leading).lineLimit(1)
                        Text(Fmt.rate(n.rxRate)).frame(width: 92, alignment: .trailing)
                        Text(Fmt.rate(n.txRate)).frame(width: 92, alignment: .trailing)
                        Text("\(Fmt.bytes(Double(n.rx))) / \(Fmt.bytes(Double(n.tx)))").frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .font(Fonts.mono(11))
                    .foregroundStyle(Ink.ink)
                }
            } else {
                Text("没有网卡数据。").font(Fonts.hand(15)).foregroundStyle(Ink.muted)
            }
        }
    }
}
