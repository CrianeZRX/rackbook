import SwiftUI
import AppKit

@main
struct RackbookApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var store: FleetStore

    init() {
        // When ssh runs us as its SSH_ASKPASS helper: print the login password from the Keychain and quit.
        if let key = ProcessInfo.processInfo.environment["RACKBOOK_ASKPASS"] {
            let pw = Keychain.get(key) ?? ""
            FileHandle.standardOutput.write(Data((pw + "\n").utf8))
            exit(pw.isEmpty ? 1 : 0)
        }
        let s = FleetStore()
        FleetStore.shared = s
        _store = State(initialValue: s)
    }

    var body: some Scene {
        Window("Rackbook", id: "main") {
            RootView()
                .environment(store)
                .preferredColorScheme(.light)
                .frame(minWidth: 1180, minHeight: 760)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1400, height: 900)
        .commands {
            CommandGroup(after: .windowArrangement) {
                Button("转入后台") { store.goBackground() }
                    .keyboardShortcut("b", modifiers: [.command, .shift])
            }
            CommandGroup(replacing: .newItem) {
                Button("新服务器…") { store.editing = ServerConfig() }
                    .keyboardShortcut("n", modifiers: [.command])
                Button("立即刷新") {
                    if case .server(let id) = store.pane { store.refreshNow(id) }
                }
                .keyboardShortcut("r", modifiers: [.command])
                Button("舰队总览") { store.pane = .fleet }
                    .keyboardShortcut("0", modifiers: [.command])
            }
        }

        Settings {
            SettingsView()
                .environment(store)
                .preferredColorScheme(.light)
        }

        MenuBarExtra(isInserted: Binding(get: { store.backgrounded }, set: { _ in })) {
            MenuBarContent()
                .environment(store)
                .preferredColorScheme(.light)
        } label: {
            HStack(spacing: 2) {
                Image(nsImage: MenuIcon.image)
                if store.alertTotal > 0 { Text("\(store.alertTotal)") }
            }
        }
        .menuBarExtraStyle(.window)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        signal(SIGPIPE, SIG_IGN)
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        !(FleetStore.shared?.keepsRunning ?? false)
    }

    /// Clicking the app again (Finder, Spotlight) while it runs in the background brings the window back.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { FleetStore.shared?.showMain() }
        return true
    }
}

struct RootView: View {
    @Environment(FleetStore.self) private var store
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        @Bindable var store = store
        HStack(spacing: 0) {
            SidebarView()
                .frame(width: 276)
            SketchRule(vertical: true, seed: 8)
                .stroke(Ink.ink, style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
                .frame(width: 4)
            VStack(spacing: 0) {
                Group {
                    switch store.pane {
                    case .fleet:
                        FleetOverview()
                    case .server(let id):
                        if let cfg = store.server(id) {
                            ServerDetailView(cfg: cfg).id(id)
                        } else {
                            FleetOverview()
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                StatusLine()
            }
        }
        .background(PaperBackground())
        .background(WindowGrabber { store.adoptMain($0) })
        .onAppear {
            store.openMain = { openWindow(id: "main") }
            store.openSettingsUI = { openSettings() }
            store.enterForeground()
        }
        .sheet(item: $store.editing) { cfg in
            ServerEditor(initial: cfg)
                .environment(store)
        }
    }
}

// MARK: - Status line: every press says what happened

struct StatusLine: View {
    @Environment(FleetStore.self) private var store

    var body: some View {
        let color: Color = {
            switch store.tone {
            case .info: return Ink.ink
            case .ok: return Ink.okInk
            case .warn: return Ink.wood
            case .refuse: return Ink.red
            }
        }()
        HStack(spacing: 10) {
            Canvas { ctx, size in
                let c = CGPoint(x: size.width / 2, y: size.height / 2)
                ctx.dot(c, 4.5, Ink.red, ring: Ink.ink, ringWidth: 1)
                ctx.ink([CGPoint(x: c.x, y: c.y + 4), CGPoint(x: c.x + 1, y: c.y + 9)], width: 1.2, amp: 0, seed: 2)
            }
            .frame(width: 14, height: 20)
            Text(store.status)
                .font(Fonts.hand(16))
                .foregroundStyle(color)
                .lineLimit(1)
                .truncationMode(.tail)
                .textSelection(.enabled)
            Spacer()
            Text("\(store.onlineCount)/\(store.servers.count) 在线 · \(Fmt.clock(Date()))")
                .font(Fonts.mono(11))
                .foregroundStyle(Ink.muted)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .background(
            VStack(spacing: 0) {
                SketchRule(seed: 13).stroke(Ink.ink, lineWidth: 1.3).frame(height: 3)
                Ink.cream.opacity(0.75)
            }
        )
    }
}
