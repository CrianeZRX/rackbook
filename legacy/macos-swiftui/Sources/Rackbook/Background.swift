import SwiftUI
import AppKit

// MARK: - Preferences (UserDefaults)

struct Prefs: Codable, Equatable {
    var backgroundOnClose = true
    var floatEnabled = true
    var floatMode = "list"                       // "list" | "ships"
    var floatMetrics: [String] = ["cpu", "mem", "net"]
    var floatServers: [UUID] = []                // empty = every ship
    var floatAlertsOnly = false
    var floatOpacity: Double = 0.96

    static let metrics: [(String, String)] = [("cpu", "CPU"), ("mem", "内存"), ("net", "网络"), ("disk", "磁盘"), ("gpu", "显卡"), ("load", "负载")]
    private static let key = "rackbook.prefs"

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        backgroundOnClose = try c.decodeIfPresent(Bool.self, forKey: .backgroundOnClose) ?? true
        floatEnabled = try c.decodeIfPresent(Bool.self, forKey: .floatEnabled) ?? true
        floatMode = try c.decodeIfPresent(String.self, forKey: .floatMode) ?? "list"
        floatMetrics = try c.decodeIfPresent([String].self, forKey: .floatMetrics) ?? ["cpu", "mem", "net"]
        floatServers = try c.decodeIfPresent([UUID].self, forKey: .floatServers) ?? []
        floatAlertsOnly = try c.decodeIfPresent(Bool.self, forKey: .floatAlertsOnly) ?? false
        floatOpacity = try c.decodeIfPresent(Double.self, forKey: .floatOpacity) ?? 0.96
    }

    static func load() -> Prefs {
        guard let d = UserDefaults.standard.data(forKey: key), let p = try? JSONDecoder().decode(Prefs.self, from: d) else { return Prefs() }
        return p
    }
    func save() {
        if let d = try? JSONEncoder().encode(self) { UserDefaults.standard.set(d, forKey: Self.key) }
    }
    func shows(_ id: UUID) -> Bool { floatServers.isEmpty || floatServers.contains(id) }
}

// MARK: - Background mode on the store

extension FleetStore {
    func adoptMain(_ w: NSWindow) {
        guard mainWindow !== w else { return }
        mainWindow = w
        windowTokens.forEach { NotificationCenter.default.removeObserver($0) }
        windowTokens = [
            NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.mainClosed() }
            },
            NotificationCenter.default.addObserver(forName: NSWindow.didBecomeKeyNotification, object: w, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.enterForeground() }
            }
        ]
    }

    /// Whether closing the main window keeps the app alive.
    var keepsRunning: Bool { prefs.backgroundOnClose || forceBackground }

    private func mainClosed() {
        mainWindow = nil
        if keepsRunning { enterBackground() }
        forceBackground = false
    }

    func goBackground() {
        forceBackground = true
        if let w = mainWindow { w.close() } else { enterBackground() }
    }

    func enterBackground() {
        backgrounded = true
        NSApp.setActivationPolicy(.accessory)
        Floater.shared.sync(self)
        say("已转入后台：舰队继续监控，菜单栏右上角有舰船图标" + (prefs.floatEnabled ? "，悬浮窗已弹出。" : "。"), .ok)
    }

    func enterForeground() {
        guard backgrounded else { return }
        backgrounded = false
        NSApp.setActivationPolicy(.regular)
        Floater.shared.sync(self)
        say("回到主窗口。")
    }

    func showMain(server: UUID? = nil) {
        if let s = server { pane = .server(s) }
        NSApp.setActivationPolicy(.regular)
        if let w = mainWindow, w.isVisible {
            w.makeKeyAndOrderFront(nil)
        } else {
            openMain?()
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    func showSettings() {
        NSApp.activate(ignoringOtherApps: true)
        openSettingsUI?()
    }

    var alertTotal: Int {
        servers.reduce(0) { acc, s in
            let l = live[s.id]
            return acc + (l?.alerts.count ?? 0) + (l?.isOffline == true ? 1 : 0)
        }
    }
}

/// Grabs the NSWindow hosting the main SwiftUI view.
struct WindowGrabber: NSViewRepresentable {
    var onWindow: (NSWindow) -> Void
    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        DispatchQueue.main.async { if let w = v.window { onWindow(w) } }
        return v
    }
    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async { if let w = nsView.window { onWindow(w) } }
    }
}

// MARK: - Menu bar icon: a tiny ship, as a template image

enum MenuIcon {
    static let image: NSImage = {
        let img = NSImage(size: NSSize(width: 22, height: 16), flipped: true) { _ in
            let hull = NSBezierPath()
            hull.move(to: NSPoint(x: 21, y: 8))
            hull.line(to: NSPoint(x: 13, y: 4.6))
            hull.line(to: NSPoint(x: 5, y: 4))
            hull.line(to: NSPoint(x: 3, y: 6))
            hull.line(to: NSPoint(x: 3, y: 10))
            hull.line(to: NSPoint(x: 5, y: 12))
            hull.line(to: NSPoint(x: 13, y: 11.4))
            hull.close()
            let wings = NSBezierPath()
            wings.move(to: NSPoint(x: 12, y: 5)); wings.line(to: NSPoint(x: 8, y: 0.5)); wings.line(to: NSPoint(x: 5.5, y: 0.5)); wings.line(to: NSPoint(x: 6.5, y: 4.5)); wings.close()
            wings.move(to: NSPoint(x: 12, y: 11)); wings.line(to: NSPoint(x: 8, y: 15.5)); wings.line(to: NSPoint(x: 5.5, y: 15.5)); wings.line(to: NSPoint(x: 6.5, y: 11.5)); wings.close()
            NSColor.black.setFill()
            hull.fill()
            wings.fill()
            let flame = NSBezierPath()
            flame.move(to: NSPoint(x: 3, y: 6.6)); flame.line(to: NSPoint(x: 0, y: 8)); flame.line(to: NSPoint(x: 3, y: 9.4)); flame.close()
            flame.fill()
            NSColor.clear.setFill()
            return true
        }
        img.isTemplate = true
        return img
    }()
}

// MARK: - Floating panel

final class FloatingPanel: NSPanel {
    static let autosave = "RackbookFloatingPanel"

    private var downAt: NSPoint?
    private var originAtDown: NSPoint?
    private var dragging = false

    init(contentRect: NSRect) {
        super.init(contentRect: contentRect, styleMask: [.nonactivatingPanel, .borderless], backing: .buffered, defer: false)
        isFloatingPanel = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        isMovable = true
        isMovableByWindowBackground = false
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
    }
    override var canBecomeKey: Bool { true }

    /// SwiftUI content swallows mouse events, so the background-drag that AppKit offers never fires.
    /// Move the panel ourselves: a press that travels more than 3 points is a drag; anything else is
    /// passed through untouched, so double-click and the context menu keep working.
    override func sendEvent(_ event: NSEvent) {
        switch event.type {
        case .leftMouseDown:
            downAt = NSEvent.mouseLocation
            originAtDown = frame.origin
            dragging = false
            super.sendEvent(event)
        case .leftMouseDragged:
            guard let start = downAt, let origin = originAtDown else { super.sendEvent(event); return }
            let now = NSEvent.mouseLocation
            let dx = now.x - start.x, dy = now.y - start.y
            if dragging || hypot(dx, dy) > 3 {
                dragging = true
                setFrameOrigin(NSPoint(x: origin.x + dx, y: origin.y + dy))
                NSCursor.closedHand.set()
                return
            }
            super.sendEvent(event)
        case .leftMouseUp:
            let wasDragging = dragging
            downAt = nil
            originAtDown = nil
            dragging = false
            if wasDragging {
                saveFrame(usingName: Self.autosave)
                NSCursor.arrow.set()
            }
            super.sendEvent(event)
        default:
            super.sendEvent(event)
        }
    }
}

/// Lets a drag anywhere on the SwiftUI content move the panel.
final class DragHostingView: NSHostingView<AnyView> {
    override var mouseDownCanMoveWindow: Bool { true }
}

@MainActor
final class Floater {
    static let shared = Floater()
    private var panel: FloatingPanel?
    private let autosave = FloatingPanel.autosave

    /// The panel is shown only while the app runs in the background and the user has it switched on.
    func sync(_ store: FleetStore) {
        if store.backgrounded && store.prefs.floatEnabled && !store.servers.isEmpty {
            show(store)
        } else {
            panel?.orderOut(nil)
        }
    }

    private func show(_ store: FleetStore) {
        if panel == nil {
            let host = DragHostingView(rootView: AnyView(FloatView().environment(store)))
            let p = FloatingPanel(contentRect: NSRect(x: 0, y: 0, width: 290, height: 220))
            p.contentView = host
            if !p.setFrameUsingName(autosave) { placeTopRight(p) }
            p.setFrameAutosaveName(autosave)
            panel = p
        }
        panel?.orderFrontRegardless()
    }

    private func placeTopRight(_ p: NSPanel) {
        guard let vf = NSScreen.main?.visibleFrame else { return }
        p.setFrameTopLeftPoint(NSPoint(x: vf.maxX - p.frame.width - 16, y: vf.maxY - 12))
    }

    func resetPosition() {
        guard let p = panel else { return }
        placeTopRight(p)
        p.saveFrame(usingName: autosave)
    }
}

// MARK: - What the floating panel shows

struct FloatView: View {
    @Environment(FleetStore.self) private var store

    var body: some View {
        let p = store.prefs
        let ships = store.servers.filter { s in
            guard p.shows(s.id) else { return false }
            guard p.floatAlertsOnly else { return true }
            let l = store.live[s.id]
            return !(l?.alerts.isEmpty ?? true) || l?.isOffline == true
        }
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("RACKBOOK · 舰队简报").font(Fonts.hand(12, bold: true)).tracking(1.2).foregroundStyle(Ink.red)
                Spacer()
                Text("\(store.onlineCount)/\(store.servers.count) 在航").font(Fonts.mono(10)).foregroundStyle(Ink.muted)
            }
            SketchRule(seed: 61).stroke(Ink.ink, lineWidth: 1).frame(height: 3)
            if ships.isEmpty {
                Text(p.floatAlertsOnly ? "一切从容，没有需要留意的舰船。" : "悬浮窗里没有选中的舰船。")
                    .font(Fonts.hand(14)).foregroundStyle(Ink.muted)
            }
            ForEach(ships) { s in
                FloatRow(cfg: s, mode: p.floatMode, metrics: p.floatMetrics)
                    .contentShape(Rectangle())
                    .onTapGesture(count: 2) { store.showMain(server: s.id) }
            }
            Text("拖动可移动 · 双击登舰 · 右键设置").font(Fonts.hand(11)).foregroundStyle(Ink.muted)
        }
        .padding(12)
        .frame(width: p.floatMode == "ships" ? 310 : 280, alignment: .leading)
        .background(
            ZStack {
                Rectangle().fill(Ink.shadow.opacity(0.14 * p.floatOpacity)).offset(x: 4, y: 4)
                Rectangle().fill(Ink.paper.opacity(p.floatOpacity))
                SketchRect(seed: 5).stroke(Ink.ink, style: StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round))
            }
        )
        .padding(8)
        .contextMenu {
            Button("打开主窗口") { store.showMain() }
            Button("悬浮窗设置…") { store.showSettings() }
            Divider()
            Button("隐藏悬浮窗") { store.prefs.floatEnabled = false }
        }
        .fixedSize()
    }
}

struct FloatRow: View {
    @Environment(FleetStore.self) private var store
    let cfg: ServerConfig
    let mode: String
    let metrics: [String]

    var body: some View {
        let l = store.live[cfg.id] ?? ServerLive()
        HStack(alignment: .center, spacing: 8) {
            if mode == "ships" {
                MiniShip(cls: l.snap?.shipClass ?? .frigate, hull: Ink.wash(cfg.wash), health: l.health, load: (l.snap?.cpu ?? 0) / 100)
                    .frame(width: 58, height: 40)
            } else {
                HealthDot(health: l.health).frame(width: 11, height: 11)
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(cfg.title).font(Fonts.hand(15, bold: true)).foregroundStyle(l.health == .hot ? Ink.red : Ink.ink).lineLimit(1)
                    Spacer(minLength: 4)
                    Text(l.health.label).font(Fonts.hand(11)).foregroundStyle(Ink.muted)
                }
                if let s = l.snap, l.phase == .online {
                    ForEach(metrics, id: \.self) { m in metric(m, s) }
                    ForEach(l.alerts.prefix(2), id: \.self) { a in
                        Text("● " + a).font(Fonts.hand(12, bold: true)).foregroundStyle(Ink.red).lineLimit(1)
                    }
                } else {
                    Text(phaseText(l.phase)).font(Fonts.hand(12)).foregroundStyle(l.isOffline ? Ink.red : Ink.muted).lineLimit(1)
                }
            }
        }
    }

    @ViewBuilder private func metric(_ m: String, _ s: Snapshot) -> some View {
        switch m {
        case "cpu": MiniMeter(label: "CPU", value: s.cpu / 100, text: Fmt.pct(s.cpu))
        case "mem": MiniMeter(label: "MEM", value: s.memFrac, text: Fmt.pct(s.memFrac * 100))
        case "disk":
            MiniMeter(label: "DISK", value: s.worstDisk?.frac ?? 0, text: Fmt.pct((s.worstDisk?.frac ?? 0) * 100))
        case "gpu":
            if !s.gpus.isEmpty { MiniMeter(label: "GPU", value: s.gpuUtil / 100, text: Fmt.pct(s.gpuUtil)) }
        case "net":
            HStack {
                Text("↓ " + Fmt.rate(s.rxRate))
                Spacer()
                Text("↑ " + Fmt.rate(s.txRate))
            }
            .font(Fonts.mono(10)).foregroundStyle(Ink.ink)
        case "load":
            Text("负载 " + s.loadText).font(Fonts.mono(10)).foregroundStyle(Ink.ink)
        default:
            EmptyView()
        }
    }
}

// MARK: - Menu bar panel (shown while running in the background)

struct MenuBarContent: View {
    @Environment(FleetStore.self) private var store
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TitleBlock(kicker: "Rackbook · 后台值班", title: "星际舰队",
                       subtitle: "\(store.onlineCount)/\(store.servers.count) 在航 · \(store.alertTotal) 处需要留意")
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(store.servers) { s in
                        FloatRow(cfg: s, mode: "list", metrics: ["cpu", "mem"])
                            .contentShape(Rectangle())
                            .onTapGesture { open(s.id) }
                    }
                }
            }
            .frame(maxHeight: 360)
            SketchRule(seed: 62).stroke(Ink.ink, lineWidth: 1).frame(height: 3)
            HStack(spacing: 6) {
                Button("打开主窗口") { open(nil) }.buttonStyle(SketchButtonStyle(kind: .solid))
                Button(store.prefs.floatEnabled ? "关闭悬浮窗" : "打开悬浮窗") { store.prefs.floatEnabled.toggle() }
                    .buttonStyle(SketchButtonStyle(kind: .chip, active: store.prefs.floatEnabled))
            }
            HStack(spacing: 6) {
                Button("设置…") { NSApp.activate(ignoringOtherApps: true); openSettings() }
                    .buttonStyle(SketchButtonStyle(kind: .chip))
                Button("全部接通") { store.connectAll() }.buttonStyle(SketchButtonStyle(kind: .chip))
                Button("全部断开") { store.disconnectAll() }.buttonStyle(SketchButtonStyle(kind: .danger))
                Spacer()
                Button("退出") { NSApp.terminate(nil) }.buttonStyle(SketchButtonStyle(kind: .chip))
            }
        }
        .padding(16)
        .frame(width: 340)
        .background(PaperBackground(grid: false))
        .onAppear {
            store.openMain = { openWindow(id: "main") }
            store.openSettingsUI = { openSettings() }
        }
    }

    private func open(_ id: UUID?) {
        if let id { store.pane = .server(id) }
        NSApp.setActivationPolicy(.regular)
        openWindow(id: "main")
        NSApp.activate(ignoringOtherApps: true)
    }
}

// MARK: - Settings window

struct SketchCheck: View {
    var title: String
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(alignment: .top, spacing: 8) {
                Canvas { ctx, size in
                    let r = CGRect(origin: .zero, size: size).insetBy(dx: 1.5, dy: 1.5)
                    let box = [CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.minX, y: r.maxY)]
                    if isOn { ctx.marker(box, Ink.gold, opacity: 0.9, seed: 3, offset: .zero, streaks: false) }
                    ctx.ink(box, closed: true, width: 1.2, amp: 0.4, seed: 4)
                    if isOn {
                        ctx.ink([CGPoint(x: r.minX + 3, y: r.midY), CGPoint(x: r.midX - 1, y: r.maxY - 3), CGPoint(x: r.maxX + 2, y: r.minY - 2)],
                                width: 2, color: Ink.red, amp: 0.3, seed: 5)
                    }
                }
                .frame(width: 17, height: 17)
                Text(title)
                    .font(Fonts.hand(15))
                    .foregroundStyle(Ink.ink)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct SettingsView: View {
    @Environment(FleetStore.self) private var store

    var body: some View {
        @Bindable var store = store
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                TitleBlock(kicker: "Settings · 设置", title: "后台与悬浮窗", subtitle: "改动立即生效")

                SketchCard(kicker: "Background", title: "后台运行", seed: 180) {
                    SketchCheck(title: "关闭主窗口时转入后台，继续监控（Dock 图标隐藏，菜单栏右上角出现舰船图标）",
                                isOn: $store.prefs.backgroundOnClose)
                    Text("不勾选时，关闭主窗口就是退出。随时可以用 ⇧⌘B 或侧栏的「转入后台」手动转入后台。")
                        .font(Fonts.hand(13)).foregroundStyle(Ink.muted).fixedSize(horizontal: false, vertical: true)
                    Button("立即转入后台") { store.goBackground() }.buttonStyle(SketchButtonStyle(kind: .plain))
                }

                SketchCard(kicker: "Floating window", title: "悬浮窗", seed: 181) {
                    SketchCheck(title: "转入后台时弹出悬浮窗（回到主窗口时自动收起）", isOn: $store.prefs.floatEnabled)

                    label("样式")
                    HStack(spacing: 6) {
                        Button("列表") { store.prefs.floatMode = "list" }
                            .buttonStyle(SketchButtonStyle(kind: .chip, active: store.prefs.floatMode == "list"))
                        Button("小舰船") { store.prefs.floatMode = "ships" }
                            .buttonStyle(SketchButtonStyle(kind: .chip, active: store.prefs.floatMode == "ships"))
                    }

                    label("显示哪些指标")
                    HStack(spacing: 6) {
                        ForEach(Prefs.metrics.map { $0.0 }, id: \.self) { key in
                            let on = store.prefs.floatMetrics.contains(key)
                            let name = Prefs.metrics.first { $0.0 == key }?.1 ?? key
                            Button(name) {
                                if on { store.prefs.floatMetrics.removeAll { $0 == key } }
                                else {
                                    let order = Prefs.metrics.map { $0.0 }
                                    store.prefs.floatMetrics = order.filter { store.prefs.floatMetrics.contains($0) || $0 == key }
                                }
                            }
                            .buttonStyle(SketchButtonStyle(kind: .chip, active: on))
                        }
                    }

                    label("显示哪些舰船")
                    SketchCheck(title: "全部舰船", isOn: Binding(
                        get: { store.prefs.floatServers.isEmpty },
                        set: { all in store.prefs.floatServers = all ? [] : store.servers.prefix(1).map(\.id) }))
                    ForEach(store.servers) { s in
                        SketchCheck(title: "\(s.title)  ·  \(s.display)", isOn: Binding(
                            get: { store.prefs.shows(s.id) },
                            set: { on in
                                var ids = store.prefs.floatServers.isEmpty ? store.servers.map(\.id) : store.prefs.floatServers
                                if on { if !ids.contains(s.id) { ids.append(s.id) } } else { ids.removeAll { $0 == s.id } }
                                store.prefs.floatServers = ids.count == store.servers.count ? [] : ids
                            }))
                            .padding(.leading, 18)
                    }
                    SketchCheck(title: "只显示需要留意或失联的舰船（一切正常时只剩标题）", isOn: $store.prefs.floatAlertsOnly)

                    label("纸张不透明度 \(Int(store.prefs.floatOpacity * 100))%")
                    Slider(value: $store.prefs.floatOpacity, in: 0.5...1)
                        .tint(Ink.red)
                        .frame(width: 260)

                    Button("把悬浮窗放回右上角") { Floater.shared.resetPosition() }
                        .buttonStyle(SketchButtonStyle(kind: .chip))
                }
            }
            .padding(24)
        }
        .frame(width: 600, height: 680)
        .background(PaperBackground(grid: false))
    }

    private func label(_ t: String) -> some View {
        Text(t).font(Fonts.hand(14, bold: true)).tracking(1).foregroundStyle(Ink.red).padding(.top, 4)
    }
}
