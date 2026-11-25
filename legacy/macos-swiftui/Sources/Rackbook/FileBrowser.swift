import SwiftUI
import AppKit
import UniformTypeIdentifiers

struct FileEntry: Identifiable, Hashable {
    var id: String { name }
    var name: String
    var kind: Character
    var linkDir: Bool
    var size: Double
    var mtime: Date
    var perms: String
    var owner: String
    var isDir: Bool { kind == "d" || (kind == "l" && linkDir) }
}

struct FileBrowser: View {
    @Environment(FleetStore.self) private var store
    let cfg: ServerConfig

    @State private var path = ""
    @State private var cwd = ""
    @State private var entries: [FileEntry] = []
    @State private var loading = false
    @State private var listError: String?
    @State private var selected: String?
    @State private var filter = ""
    @State private var showHidden = false
    @State private var dropHover = false

    @State private var editTarget: EditTarget?
    @State private var askNewFile = false

    @State private var askMkdir = false
    @State private var askRename: FileEntry?
    @State private var nameField = ""
    @State private var askDelete: FileEntry?

    private var shown: [FileEntry] {
        let q = filter.trimmed.lowercased()
        return entries.filter { e in
            (showHidden || !e.name.hasPrefix(".")) && (q.isEmpty || e.name.lowercased().contains(q))
        }
    }

    var body: some View {
        Group {
            if let t = editTarget {
                FileEditorView(cfg: cfg, target: t) {
                    editTarget = nil
                    list(cwd)
                }
                .id(t.id)
            } else {
                listCard
            }
        }
        .padding(24)
        .onAppear { if cwd.isEmpty { list("") } }
        .alert("新建文件", isPresented: $askNewFile) {
            TextField("文件名，例如 config.yaml", text: $nameField)
            Button("在编辑器里打开") {
                let n = nameField.trimmed
                if n.isEmpty || n.contains("/") { store.say("名字不能为空，也不能含有 /。", .refuse) }
                else { editTarget = EditTarget(path: full(n), name: n) }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("在 \(cwd) 里新建；保存时才真正写到服务器上。")
        }
        .alert("新建文件夹", isPresented: $askMkdir) {
            TextField("名称", text: $nameField)
            Button("创建") { makeFolder(nameField) }
            Button("取消", role: .cancel) {}
        } message: {
            Text("在 \(cwd) 里新建。")
        }
        .alert("重命名", isPresented: Binding(get: { askRename != nil }, set: { if !$0 { askRename = nil } })) {
            TextField("新名称", text: $nameField)
            Button("改名") { if let e = askRename { renameEntry(e, to: nameField) } }
            Button("取消", role: .cancel) {}
        } message: {
            Text(askRename?.name ?? "")
        }
        .confirmationDialog("删除？",
                            isPresented: Binding(get: { askDelete != nil }, set: { if !$0 { askDelete = nil } }),
                            presenting: askDelete) { e in
            Button("永久删除「\(e.name)」", role: .destructive) { deleteEntry(e) }
            Button("取消", role: .cancel) {}
        } message: { e in
            Text(e.isDir ? "这是一个文件夹，里面的内容会一起删除，服务器上没有回收站，删了就找不回来。"
                         : "服务器上没有回收站，删了就找不回来。")
        }
    }

    // MARK: List

    private var listCard: some View {
        SketchCard(kicker: "Files", title: "文件目录", lit: dropHover) {
            HStack(spacing: 6) {
                Button("⌂") { list("") }.buttonStyle(SketchButtonStyle(kind: .chip)).help("主目录")
                Button("↑") { goUp() }.buttonStyle(SketchButtonStyle(kind: .chip)).help("上一级")
                breadcrumb
                Spacer(minLength: 6)
                Button("↻") { list(cwd) }.buttonStyle(SketchButtonStyle(kind: .chip)).help("刷新")
            }
            HStack(spacing: 8) {
                SketchField(placeholder: "前往路径，例如 /var/log", text: $path, mono: true) { list(path) }
                SketchField(placeholder: "筛选…", text: $filter).frame(width: 150)
                Button(showHidden ? "隐藏 ." : "显示 .") { showHidden.toggle() }
                    .buttonStyle(SketchButtonStyle(kind: .chip, active: showHidden))
                Button("新建文件") { nameField = ""; askNewFile = true }.buttonStyle(SketchButtonStyle(kind: .chip))
                Button("新建文件夹") { nameField = ""; askMkdir = true }.buttonStyle(SketchButtonStyle(kind: .chip))
                Button("上传…") { pickUpload() }.buttonStyle(SketchButtonStyle(kind: .chip))
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    Text("常用文件").font(Fonts.hand(13, bold: true)).foregroundStyle(Ink.red)
                    ForEach(Self.quickFiles, id: \.self) { p in
                        Button(p) { editTarget = EditTarget(path: p, name: (p as NSString).lastPathComponent) }
                            .buttonStyle(SketchButtonStyle(kind: .chip))
                    }
                }
                .padding(.vertical, 2)
            }
            HStack(spacing: 8) {
                Text("").frame(width: 22)
                Text("名称").frame(maxWidth: .infinity, alignment: .leading)
                Text("大小").frame(width: 80, alignment: .trailing)
                Text("修改时间").frame(width: 130, alignment: .leading)
                Text("权限").frame(width: 92, alignment: .leading)
                Text("所有者").frame(width: 70, alignment: .leading)
            }
            .font(Fonts.hand(13, bold: true))
            .foregroundStyle(Ink.red)

            if let err = listError {
                Text(err).font(Fonts.hand(15, bold: true)).foregroundStyle(Ink.red)
            }
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(shown) { e in
                        FileLine(e: e, selected: selected == e.name)
                            .onTapGesture(count: 2) { openEntry(e) }
                            .onTapGesture { selected = e.name }
                            .contextMenu { menu(e) }
                    }
                }
            }
            .frame(maxHeight: .infinity)
            .onDrop(of: [UTType.fileURL], isTargeted: $dropHover) { providers in
                handleDrop(providers)
                return true
            }
            Footnote(text: loading ? "正在读取…" :
                     "\(shown.count) 项 · 双击进入文件夹，或在可视化编辑器里打开文件 · 右键可下载、改名、删除 · 把 Finder 里的文件拖进来即上传")
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var breadcrumb: some View {
        let parts = cwd.split(separator: "/").map(String.init)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                Button("/") { list("/") }.buttonStyle(.plain)
                ForEach(Array(parts.enumerated()), id: \.offset) { i, p in
                    Button(p) { list("/" + parts[0...i].joined(separator: "/")) }.buttonStyle(.plain)
                    if i < parts.count - 1 { Text("/").foregroundStyle(Ink.muted) }
                }
            }
            .font(Fonts.mono(13, bold: true))
            .foregroundStyle(Ink.ink)
        }
    }

    @ViewBuilder private func menu(_ e: FileEntry) -> some View {
        Button(e.isDir ? "打开" : "在编辑器里打开") { openEntry(e) }
        Button("下载到 Mac…") { download(e) }
        Button("计算大小") { measure(e) }
        Button("复制路径") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(full(e.name), forType: .string)
            store.say("已复制：\(full(e.name))")
        }
        Divider()
        Button("重命名…") { nameField = e.name; askRename = e }
        Button("删除…", role: .destructive) { askDelete = e }
    }

    static let quickFiles = ["~/.bashrc", "~/.profile", "~/.bash_aliases", "~/.zshrc", "/etc/hosts", "/etc/ssh/sshd_config",
                             "/etc/docker/daemon.json", "/etc/fstab", "/etc/crontab", "/etc/environment"]

    // MARK: Remote operations

    private func full(_ name: String) -> String {
        cwd == "/" ? "/" + name : cwd + "/" + name
    }

    private func goUp() {
        guard !cwd.isEmpty, cwd != "/" else {
            store.say("已经在根目录了，没有上一级。", .refuse)
            return
        }
        list((cwd as NSString).deletingLastPathComponent)
    }

    private func list(_ target: String) {
        loading = true
        let cd = target.trimmed.isEmpty ? "cd" : "cd -- \(shq(target.trimmed))"
        let cmd = "\(cd) && pwd && LC_ALL=C find . -mindepth 1 -maxdepth 1 -printf '%y\\t%Y\\t%s\\t%T@\\t%M\\t%u\\t%P\\n' 2>/dev/null | head -n 5000"
        Task {
            let r = await store.run(cfg.id, cmd, timeout: 30)
            loading = false
            guard r.ok else {
                let msg = r.err.trimmed.isEmpty ? "退出码 \(r.code)" : r.err.trimmed
                listError = "打不开 \(target.isEmpty ? "主目录" : target)：\(msg)"
                store.say("还不行：\(target) 打不开（\(msg)）。", .refuse)
                return
            }
            var lines = r.out.split(separator: "\n", omittingEmptySubsequences: true)
            guard !lines.isEmpty else { return }
            let newCwd = String(lines.removeFirst())
            var list: [FileEntry] = []
            for line in lines {
                let f = line.split(separator: "\t", maxSplits: 6, omittingEmptySubsequences: false)
                guard f.count == 7, let k = f[0].first else { continue }
                let mt = Double(f[3]) ?? 0
                list.append(FileEntry(name: String(f[6]), kind: k, linkDir: f[1] == "d", size: Double(f[2]) ?? 0,
                                      mtime: Date(timeIntervalSince1970: mt), perms: String(f[4]), owner: String(f[5])))
            }
            list.sort { a, b in
                if a.isDir != b.isDir { return a.isDir }
                return a.name.localizedStandardCompare(b.name) == .orderedAscending
            }
            listError = nil
            cwd = newCwd
            path = newCwd
            entries = list
            selected = nil
            store.say("\(newCwd)：\(list.count) 项。")
        }
    }

    private func openEntry(_ e: FileEntry) {
        if e.isDir { list(full(e.name)); return }
        guard e.kind == "f" || e.kind == "l" else {
            store.say("「\(e.name)」不是普通文件，不能打开。", .refuse)
            return
        }
        editTarget = EditTarget(path: full(e.name), name: e.name)
    }

    private func makeFolder(_ name: String) {
        let n = name.trimmed
        guard !n.isEmpty, !n.contains("/") else { store.say("名字不能为空，也不能含有 /。", .refuse); return }
        Task {
            let r = await store.run(cfg.id, "mkdir -- \(shq(full(n)))")
            store.say(r.ok ? "建好了文件夹 \(n)。" : "没建成：\(r.err.trimmed)", r.ok ? .ok : .refuse)
            list(cwd)
        }
    }

    private func renameEntry(_ e: FileEntry, to name: String) {
        let n = name.trimmed
        guard !n.isEmpty, !n.contains("/"), n != e.name else { return }
        Task {
            let r = await store.run(cfg.id, "mv -n -- \(shq(full(e.name))) \(shq(full(n)))")
            store.say(r.ok ? "「\(e.name)」改名为「\(n)」。" : "没改成：\(r.err.trimmed)", r.ok ? .ok : .refuse)
            list(cwd)
        }
    }

    private func deleteEntry(_ e: FileEntry) {
        let p = full(e.name)
        guard p != "/" && !p.isEmpty else { return }
        Task {
            let r = await store.run(cfg.id, (e.isDir && e.kind == "d" ? "rm -rf -- " : "rm -f -- ") + shq(p), timeout: 120)
            store.say(r.ok ? "已删除 \(p)。" : "没删掉：\(r.err.trimmed)", r.ok ? .ok : .refuse)
            list(cwd)
        }
    }

    private func measure(_ e: FileEntry) {
        store.say("正在计算 \(e.name) 的大小…")
        Task {
            let r = await store.run(cfg.id, "du -sh -- \(shq(full(e.name))) 2>/dev/null | cut -f1", timeout: 120)
            let v = r.out.trimmed
            store.say(v.isEmpty ? "没算出来（可能没有权限）。" : "\(e.name) 共占 \(v)。", v.isEmpty ? .warn : .ok)
        }
    }

    private func download(_ e: FileEntry) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.prompt = "下载到这里"
        panel.message = "把「\(e.name)」下载到哪个文件夹？"
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        guard panel.runModal() == .OK, let dir = panel.url else { return }
        let remote = full(e.name)
        store.say("正在下载 \(e.name) …")
        Task {
            do {
                let r = try await SSH.download(cfg.resolved, remote: remote, to: dir, recursive: e.isDir)
                if r.ok {
                    let local = dir.appendingPathComponent(e.name)
                    store.say("已下载到 \(local.path)。", .ok)
                    NSWorkspace.shared.activateFileViewerSelecting([local])
                } else {
                    store.say("下载失败：\(SSH.cleanErr(r.err, fallback: "退出码 \(r.code)"))", .refuse)
                }
            } catch {
                store.say("下载失败：\(error.localizedDescription)", .refuse)
            }
        }
    }

    private func pickUpload() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.prompt = "上传"
        panel.message = "上传到 \(cfg.title):\(cwd)"
        guard panel.runModal() == .OK else { return }
        upload(panel.urls)
    }

    private func handleDrop(_ providers: [NSItemProvider]) {
        let group = DispatchGroup()
        let lock = NSLock()
        var urls: [URL] = []
        for p in providers {
            group.enter()
            _ = p.loadObject(ofClass: URL.self) { url, _ in
                if let url { lock.lock(); urls.append(url); lock.unlock() }
                group.leave()
            }
        }
        group.notify(queue: .main) { upload(urls) }
    }

    private func upload(_ urls: [URL]) {
        guard !urls.isEmpty else { return }
        guard !cwd.isEmpty else { store.say("还不行：目录还没打开。", .refuse); return }
        let dest = cwd
        store.say("正在上传 \(urls.count) 项到 \(dest)…")
        Task {
            do {
                let r = try await SSH.upload(cfg.resolved, locals: urls, remoteDir: dest)
                store.say(r.ok ? "已上传 \(urls.map(\.lastPathComponent).joined(separator: "、")) 到 \(dest)。"
                               : "上传失败：\(SSH.cleanErr(r.err, fallback: "退出码 \(r.code)"))", r.ok ? .ok : .refuse)
                list(dest)
            } catch {
                store.say("上传失败：\(error.localizedDescription)", .refuse)
            }
        }
    }
}

struct FileLine: View {
    let e: FileEntry
    let selected: Bool
    @State private var hover = false

    var body: some View {
        HStack(spacing: 8) {
            FileGlyph(kind: e.isDir ? "d" : (e.kind == "l" ? "l" : "f")).frame(width: 22, height: 18)
            Text(e.name + (e.kind == "l" ? " ↗" : ""))
                .font(Fonts.hand(16, bold: e.isDir))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(e.isDir ? "—" : Fmt.bytes(e.size)).font(Fonts.mono(11)).frame(width: 80, alignment: .trailing)
            Text(Fmt.date(e.mtime)).font(Fonts.mono(11)).frame(width: 130, alignment: .leading)
            Text(e.perms).font(Fonts.mono(11)).frame(width: 92, alignment: .leading)
            Text(e.owner).font(Fonts.mono(11)).lineLimit(1).frame(width: 70, alignment: .leading)
        }
        .foregroundStyle(Ink.ink)
        .padding(.vertical, 3)
        .padding(.horizontal, 4)
        .background(selected ? Ink.gold.opacity(0.55) : (hover ? Ink.gold.opacity(0.2) : Color.clear))
        .contentShape(Rectangle())
        .onHover { hover = $0 }
    }
}

struct FileGlyph: View {
    let kind: Character
    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            if kind == "d" {
                let tab = [CGPoint(x: 2, y: 4), CGPoint(x: 8, y: 4), CGPoint(x: 10, y: 6), CGPoint(x: w - 2, y: 6),
                           CGPoint(x: w - 2, y: h - 2), CGPoint(x: 2, y: h - 2)]
                ctx.marker(tab, Ink.tan, opacity: 1, seed: 11, offset: CGSize(width: 1, height: 1), streaks: false)
                ctx.ink(tab, closed: true, width: 1, amp: 0.25, seed: 12)
            } else {
                let page = [CGPoint(x: 5, y: 1), CGPoint(x: w - 9, y: 1), CGPoint(x: w - 5, y: 5),
                            CGPoint(x: w - 5, y: h - 1), CGPoint(x: 5, y: h - 1)]
                ctx.marker(page, kind == "l" ? Ink.sky : Ink.cream, opacity: 1, seed: 13, offset: CGSize(width: 1, height: 1), streaks: false)
                ctx.ink(page, closed: true, width: 1, amp: 0.25, seed: 14)
                for k in 0..<3 {
                    let y = 7 + CGFloat(k) * 3
                    ctx.ink([CGPoint(x: 8, y: y), CGPoint(x: w - 8, y: y)], width: 0.6, color: Ink.pencil, amp: 0, seed: 15)
                }
            }
        }
    }
}
