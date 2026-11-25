import SwiftUI
import AppKit

// MARK: - File kinds

enum FileKind: String, CaseIterable, Identifiable {
    case json, yaml, shell, ini, text
    var id: String { rawValue }
    var label: String {
        switch self {
        case .json: return "JSON"
        case .yaml: return "YAML"
        case .shell: return "Shell"
        case .ini: return "配置"
        case .text: return "文本"
        }
    }

    static func detect(name: String, content: String) -> FileKind {
        let n = name.lowercased()
        let ext = (n as NSString).pathExtension
        if ["json", "jsonc", "geojson", "json5"].contains(ext) || n == ".babelrc" || n == ".prettierrc" { return .json }
        if ["yml", "yaml"].contains(ext) { return .yaml }
        let shellNames = [".bashrc", ".bash_profile", ".bash_login", ".bash_logout", ".bash_aliases", ".profile",
                          ".zshrc", ".zprofile", ".zshenv", ".zlogin", ".kshrc", "bashrc", "profile", "bash.bashrc"]
        if ["sh", "bash", "zsh", "ksh"].contains(ext) || shellNames.contains(n) { return .shell }
        let first = content.prefix(200).split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
        if first.hasPrefix("#!") && (first.contains("sh") ) { return .shell }
        let iniNames = ["sshd_config", "ssh_config", ".env", ".gitconfig", ".npmrc", ".editorconfig", "hosts", "fstab",
                        "crontab", "sysctl.conf", "my.cnf", ".wgetrc", ".curlrc", "environment"]
        if ["ini", "conf", "cfg", "env", "toml", "properties", "service", "timer", "socket", "mount", "desktop", "cnf", "network"].contains(ext)
            || iniNames.contains(n) { return .ini }
        let t = content.drop(while: { $0 == " " || $0 == "\n" || $0 == "\t" || $0 == "\r" })
        if t.hasPrefix("{") || t.hasPrefix("[") && ext.isEmpty { return .json }
        if t.hasPrefix("---") { return .yaml }
        return .text
    }
}

// MARK: - Syntax colouring, in ink and marker colours

enum Highlighter {
    struct Rule {
        let re: NSRegularExpression
        let color: NSColor
        let bold: Bool
        let group: Int
    }

    private static func r(_ p: String, _ c: NSColor, bold: Bool = false, group: Int = 0) -> Rule {
        Rule(re: try! NSRegularExpression(pattern: p, options: [.anchorsMatchLines]), color: c, bold: bold, group: group)
    }

    static let inkC = NSColor(Ink.ink)
    static let keyC = NSColor(Ink.shadow)
    static let strC = NSColor(Ink.okInk)
    static let numC = NSColor(Ink.red)
    static let litC = NSColor(Ink.wood)
    static let comC = NSColor(Ink.pencil)

    static let json: [Rule] = [
        r(#"(?<![\w"])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?"#, numC),
        r(#"\b(?:true|false|null)\b"#, litC, bold: true),
        r(#""(?:\\.|[^"\\\n])*""#, strC),
        r(#"("(?:\\.|[^"\\\n])*")\s*:"#, keyC, bold: true, group: 1),
    ]
    static let yaml: [Rule] = [
        r(#"(?<![\w.])-?\d+(?:\.\d+)?\b"#, numC),
        r(#"\b(?:true|false|null|yes|no|on|off|True|False|Yes|No)\b|~"#, litC, bold: true),
        r(#"'[^'\n]*'|"(?:\\.|[^"\\\n])*""#, strC),
        r(#"^(\s*(?:-\s+)?)([^\s#'"\-][^:#\n]*?)(?=:(?:\s|$))"#, keyC, bold: true, group: 2),
        r(#"^\s*(-)(?=\s|$)"#, numC, bold: true, group: 1),
        r(#"[&*][\w-]+"#, litC),
        r(#"^(?:---|\.\.\.)\s*$"#, numC, bold: true),
        r(#"(?:^|\s)(#.*)$"#, comC, group: 1),
    ]
    static let shell: [Rule] = [
        r(#"\b(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|function|return|export|alias|source|local|readonly|unset|in|select)\b"#, keyC, bold: true),
        r(#"^\s*(?:export\s+|local\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)(?==)"#, keyC, bold: true, group: 1),
        r(#"'[^'\n]*'|"(?:\\.|[^"\\\n])*""#, strC),
        r(#"\$\{[^}\n]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9@#?*!$-]|\$\("#, numC),
        r(#"(?:^|[ \t;])(#.*)$"#, comC, group: 1),
    ]
    static let ini: [Rule] = [
        r(#"(?<![\w.])-?\d+(?:\.\d+)?\b"#, numC),
        r(#"'[^'\n]*'|"(?:\\.|[^"\\\n])*""#, strC),
        r(#"^\s*([A-Za-z][\w.\-]*)(?=[ \t]+\S)"#, keyC, bold: true, group: 1),
        r(#"^\s*([^\s#;=:\[][^=\n]*?)\s*(?==)"#, keyC, bold: true, group: 1),
        r(#"^\s*(\[[^\]\n]*\])"#, numC, bold: true, group: 1),
        r(#"^\s*([#;].*)$"#, comC, group: 1),
    ]

    static func rules(_ k: FileKind) -> [Rule] {
        switch k {
        case .json: return json
        case .yaml: return yaml
        case .shell: return shell
        case .ini: return ini
        case .text: return []
        }
    }

    static func apply(_ storage: NSTextStorage, kind: FileKind, font: NSFont, bold: NSFont) {
        let full = NSRange(location: 0, length: storage.length)
        storage.beginEditing()
        storage.setAttributes([.font: font, .foregroundColor: inkC], range: full)
        let s = storage.string
        for rule in rules(kind) {
            rule.re.enumerateMatches(in: s, options: [], range: full) { m, _, _ in
                guard let m else { return }
                let range = m.range(at: rule.group)
                guard range.location != NSNotFound, range.length > 0 else { return }
                storage.addAttribute(.foregroundColor, value: rule.color, range: range)
                if rule.bold { storage.addAttribute(.font, value: bold, range: range) }
            }
        }
        storage.endEditing()
    }
}

// MARK: - Code editor (NSTextView with line numbers)

struct JumpRequest: Equatable {
    let line: Int
    let token: Int
}

final class LineNumberRuler: NSRulerView {
    weak var textView: NSTextView?

    init(textView: NSTextView) {
        self.textView = textView
        super.init(scrollView: textView.enclosingScrollView, orientation: .verticalRuler)
        clientView = textView
        ruleThickness = 46
        NotificationCenter.default.addObserver(self, selector: #selector(refresh), name: NSText.didChangeNotification, object: textView)
        if let clip = textView.enclosingScrollView?.contentView {
            clip.postsBoundsChangedNotifications = true
            NotificationCenter.default.addObserver(self, selector: #selector(refresh), name: NSView.boundsDidChangeNotification, object: clip)
        }
    }

    required init(coder: NSCoder) { fatalError("not used") }

    @objc private func refresh() { needsDisplay = true }

    override func drawHashMarksAndLabels(in rect: NSRect) {
        NSColor(Ink.shade).withAlphaComponent(0.45).setFill()
        bounds.fill()
        NSColor(Ink.pencil).setStroke()
        let edge = NSBezierPath()
        edge.move(to: NSPoint(x: bounds.maxX - 0.5, y: bounds.minY))
        edge.line(to: NSPoint(x: bounds.maxX - 0.5, y: bounds.maxY))
        edge.lineWidth = 1
        edge.stroke()

        guard let tv = textView, let lm = tv.layoutManager, let tc = tv.textContainer else { return }
        let ns = tv.string as NSString
        let visible = tv.visibleRect
        let glyphs = lm.glyphRange(forBoundingRect: visible, in: tc)
        let chars = lm.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)

        var line = 1
        var i = 0
        while i < chars.location {
            let r = ns.lineRange(for: NSRange(location: i, length: 0))
            if NSMaxRange(r) > chars.location { break }
            i = NSMaxRange(r)
            line += 1
        }
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .regular),
            .foregroundColor: NSColor(Ink.muted)
        ]
        var idx = i
        let end = min(ns.length, NSMaxRange(chars) + 1)
        repeat {
            let lr = ns.lineRange(for: NSRange(location: min(idx, ns.length), length: 0))
            let g = lm.glyphIndexForCharacter(at: min(lr.location, max(0, ns.length - 1)))
            var frag = ns.length == 0 ? NSRect(x: 0, y: 0, width: 10, height: 16) : lm.lineFragmentRect(forGlyphAt: g, effectiveRange: nil)
            frag.origin.y += tv.textContainerInset.height
            let p = convert(NSPoint(x: 0, y: frag.minY), from: tv)
            let label = "\(line)" as NSString
            let size = label.size(withAttributes: attrs)
            label.draw(at: NSPoint(x: ruleThickness - size.width - 8, y: p.y + (frag.height - size.height) / 2), withAttributes: attrs)
            line += 1
            if lr.length == 0 { break }
            idx = NSMaxRange(lr)
        } while idx < end
    }
}

struct CodeEditor: NSViewRepresentable {
    @Binding var text: String
    var kind: FileKind
    var editable: Bool
    var jump: JumpRequest?

    static var font: NSFont {
        NSFont(name: Fonts.monoRegular ?? "Menlo-Regular", size: 13) ?? .monospacedSystemFont(ofSize: 13, weight: .regular)
    }
    static var boldFont: NSFont {
        NSFont(name: Fonts.monoBold ?? "Menlo-Bold", size: 13) ?? .monospacedSystemFont(ofSize: 13, weight: .bold)
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSTextView.scrollableTextView()
        let tv = scroll.documentView as! NSTextView
        tv.isRichText = false
        tv.allowsUndo = true
        tv.usesFindBar = true
        tv.isIncrementalSearchingEnabled = true
        tv.isAutomaticQuoteSubstitutionEnabled = false
        tv.isAutomaticDashSubstitutionEnabled = false
        tv.isAutomaticTextReplacementEnabled = false
        tv.isAutomaticSpellingCorrectionEnabled = false
        tv.isContinuousSpellCheckingEnabled = false
        tv.isGrammarCheckingEnabled = false
        tv.smartInsertDeleteEnabled = false
        tv.font = Self.font
        tv.textColor = Highlighter.inkC
        tv.backgroundColor = NSColor(Ink.cream)
        tv.insertionPointColor = NSColor(Ink.red)
        tv.selectedTextAttributes = [.backgroundColor: NSColor(Ink.gold).withAlphaComponent(0.45)]
        tv.typingAttributes = [.font: Self.font, .foregroundColor: Highlighter.inkC]
        tv.textContainerInset = NSSize(width: 6, height: 8)
        tv.isHorizontallyResizable = true
        tv.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        tv.textContainer?.widthTracksTextView = false
        tv.textContainer?.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        scroll.hasHorizontalScroller = true
        scroll.drawsBackground = false
        tv.delegate = context.coordinator
        tv.string = text
        tv.isEditable = editable
        context.coordinator.textView = tv
        context.coordinator.highlight(now: true)

        let ruler = LineNumberRuler(textView: tv)
        scroll.verticalRulerView = ruler
        scroll.hasVerticalRuler = true
        scroll.rulersVisible = true
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        let c = context.coordinator
        c.parent = self
        guard let tv = c.textView else { return }
        tv.isEditable = editable
        if tv.string != text {
            tv.string = text
            c.highlight(now: true)
            scroll.verticalRulerView?.needsDisplay = true
        }
        if c.kind != kind {
            c.kind = kind
            c.highlight(now: true)
        }
        if let j = jump, j != c.lastJump {
            c.lastJump = j
            c.go(to: j.line)
        }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: CodeEditor
        var kind: FileKind
        weak var textView: NSTextView?
        var lastJump: JumpRequest?
        private var pending: DispatchWorkItem?

        init(_ p: CodeEditor) {
            parent = p
            kind = p.kind
            super.init()
        }

        func textDidChange(_ notification: Notification) {
            guard let tv = textView else { return }
            parent.text = tv.string
            highlight(now: false)
        }

        func highlight(now: Bool) {
            pending?.cancel()
            let work = DispatchWorkItem { [weak self] in
                guard let self, let tv = self.textView, let st = tv.textStorage else { return }
                let sel = tv.selectedRanges
                Highlighter.apply(st, kind: self.kind, font: CodeEditor.font, bold: CodeEditor.boldFont)
                tv.selectedRanges = sel
            }
            pending = work
            if now {
                work.perform()
            } else {
                let big = (textView?.string.utf16.count ?? 0) > 200_000
                DispatchQueue.main.asyncAfter(deadline: .now() + (big ? 0.9 : 0.25), execute: work)
            }
        }

        func go(to line: Int) {
            guard let tv = textView else { return }
            let ns = tv.string as NSString
            var idx = 0
            var ln = 1
            while ln < line && idx < ns.length {
                idx = NSMaxRange(ns.lineRange(for: NSRange(location: idx, length: 0)))
                ln += 1
            }
            let r = ns.lineRange(for: NSRange(location: min(idx, ns.length), length: 0))
            tv.window?.makeFirstResponder(tv)
            tv.setSelectedRange(NSRange(location: r.location, length: 0))
            tv.scrollRangeToVisible(r)
            if r.length > 0 { tv.showFindIndicator(for: r) }
        }
    }
}

// MARK: - Ordered JSON (keeps key order, reports line and column)

indirect enum JNode {
    case object([(key: String, value: JNode, line: Int)])
    case array([(value: JNode, line: Int)])
    case string(String)
    case number(String)
    case bool(Bool)
    case null
}

struct JSONProblem: Error {
    let line: Int
    let col: Int
    let msg: String
}

struct JParser {
    private let s: [UInt8]
    private var i = 0
    private var line = 1
    private var lineStart = 0

    init(_ text: String) { s = Array(text.utf8) }

    private func err(_ m: String) -> JSONProblem { JSONProblem(line: line, col: i - lineStart + 1, msg: m) }

    mutating func parse() throws -> JNode {
        skip()
        let v = try value()
        skip()
        if i < s.count { throw err("后面还有多余的内容") }
        return v
    }

    private mutating func skip() {
        while i < s.count {
            let c = s[i]
            if c == 0x0A { line += 1; i += 1; lineStart = i }
            else if c == 0x20 || c == 0x09 || c == 0x0D { i += 1 }
            else { break }
        }
    }

    private mutating func value() throws -> JNode {
        guard i < s.count else { throw err("文件意外结束") }
        let c = s[i]
        switch c {
        case UInt8(ascii: "{"): return try object()
        case UInt8(ascii: "["): return try array()
        case UInt8(ascii: "\""): return .string(try str())
        case UInt8(ascii: "t"): try lit("true"); return .bool(true)
        case UInt8(ascii: "f"): try lit("false"); return .bool(false)
        case UInt8(ascii: "n"): try lit("null"); return .null
        case UInt8(ascii: "-"), UInt8(ascii: "0")...UInt8(ascii: "9"): return try number()
        default:
            throw err("这里不该出现 “\(Character(UnicodeScalar(c)))”")
        }
    }

    private mutating func lit(_ w: String) throws {
        let b = Array(w.utf8)
        guard i + b.count <= s.count, Array(s[i..<(i + b.count)]) == b else { throw err("应该是 \(w)") }
        i += b.count
    }

    private mutating func number() throws -> JNode {
        let start = i
        while i < s.count, let ch = Optional(s[i]),
              (ch >= 0x30 && ch <= 0x39) || ch == UInt8(ascii: "-") || ch == UInt8(ascii: "+") || ch == UInt8(ascii: ".") || ch == UInt8(ascii: "e") || ch == UInt8(ascii: "E") {
            i += 1
        }
        let t = String(decoding: s[start..<i], as: UTF8.self)
        guard Double(t) != nil else { i = start; throw err("数字写法不对：\(t)") }
        return .number(t)
    }

    private mutating func str() throws -> String {
        i += 1
        var out: [UInt8] = []
        while i < s.count {
            let c = s[i]
            if c == UInt8(ascii: "\"") { i += 1; return String(decoding: out, as: UTF8.self) }
            if c == 0x0A { throw err("字符串里不能直接换行（少了右引号？）") }
            if c == UInt8(ascii: "\\") {
                i += 1
                guard i < s.count else { break }
                let e = s[i]
                switch e {
                case UInt8(ascii: "\""): out.append(0x22)
                case UInt8(ascii: "\\"): out.append(0x5C)
                case UInt8(ascii: "/"): out.append(0x2F)
                case UInt8(ascii: "b"): out.append(0x08)
                case UInt8(ascii: "f"): out.append(0x0C)
                case UInt8(ascii: "n"): out.append(0x0A)
                case UInt8(ascii: "r"): out.append(0x0D)
                case UInt8(ascii: "t"): out.append(0x09)
                case UInt8(ascii: "u"):
                    guard i + 4 < s.count, let v = UInt32(String(decoding: s[(i + 1)...(i + 4)], as: UTF8.self), radix: 16) else {
                        throw err("\\u 后面要跟 4 位十六进制")
                    }
                    i += 4
                    var scalar = v
                    if v >= 0xD800 && v < 0xDC00, i + 6 < s.count, s[i + 1] == UInt8(ascii: "\\"), s[i + 2] == UInt8(ascii: "u"),
                       let lo = UInt32(String(decoding: s[(i + 3)...(i + 6)], as: UTF8.self), radix: 16), lo >= 0xDC00 && lo < 0xE000 {
                        scalar = 0x10000 + ((v - 0xD800) << 10) + (lo - 0xDC00)
                        i += 6
                    }
                    out.append(contentsOf: Array(String(Character(UnicodeScalar(scalar) ?? "?")).utf8))
                default:
                    throw err("不认识的转义 \\\(Character(UnicodeScalar(e)))")
                }
                i += 1
                continue
            }
            out.append(c)
            i += 1
        }
        throw err("字符串没有结束（少了右引号）")
    }

    private mutating func object() throws -> JNode {
        i += 1
        var items: [(key: String, value: JNode, line: Int)] = []
        skip()
        if i < s.count && s[i] == UInt8(ascii: "}") { i += 1; return .object(items) }
        while true {
            skip()
            guard i < s.count, s[i] == UInt8(ascii: "\"") else { throw err("这里应该是带双引号的键") }
            let keyLine = line
            let k = try str()
            skip()
            guard i < s.count, s[i] == UInt8(ascii: ":") else { throw err("键 \"\(k)\" 后面少了冒号") }
            i += 1
            skip()
            let v = try value()
            items.append((key: k, value: v, line: keyLine))
            skip()
            guard i < s.count else { throw err("对象没有闭合（少了 }）") }
            if s[i] == UInt8(ascii: ",") {
                i += 1
                skip()
                if i < s.count && s[i] == UInt8(ascii: "}") { throw err("} 前面多了一个逗号") }
                continue
            }
            if s[i] == UInt8(ascii: "}") { i += 1; return .object(items) }
            throw err("少了逗号或 }")
        }
    }

    private mutating func array() throws -> JNode {
        i += 1
        var items: [(value: JNode, line: Int)] = []
        skip()
        if i < s.count && s[i] == UInt8(ascii: "]") { i += 1; return .array(items) }
        while true {
            skip()
            let l = line
            let v = try value()
            items.append((value: v, line: l))
            skip()
            guard i < s.count else { throw err("数组没有闭合（少了 ]）") }
            if s[i] == UInt8(ascii: ",") {
                i += 1
                skip()
                if i < s.count && s[i] == UInt8(ascii: "]") { throw err("] 前面多了一个逗号") }
                continue
            }
            if s[i] == UInt8(ascii: "]") { i += 1; return .array(items) }
            throw err("少了逗号或 ]")
        }
    }
}

enum JWriter {
    static func quote(_ s: String) -> String {
        var o = "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": o += "\\\""
            case "\\": o += "\\\\"
            case "\n": o += "\\n"
            case "\r": o += "\\r"
            case "\t": o += "\\t"
            default:
                if u.value < 0x20 { o += String(format: "\\u%04x", u.value) } else { o.unicodeScalars.append(u) }
            }
        }
        return o + "\""
    }

    static func render(_ n: JNode, pretty: Bool, indent: Int = 0) -> String {
        let pad = pretty ? String(repeating: "  ", count: indent + 1) : ""
        let close = pretty ? String(repeating: "  ", count: indent) : ""
        let nl = pretty ? "\n" : ""
        switch n {
        case .object(let items):
            if items.isEmpty { return "{}" }
            let body = items.map { pad + quote($0.key) + (pretty ? ": " : ":") + render($0.value, pretty: pretty, indent: indent + 1) }
            return "{" + nl + body.joined(separator: "," + nl) + nl + close + "}"
        case .array(let items):
            if items.isEmpty { return "[]" }
            let body = items.map { pad + render($0.value, pretty: pretty, indent: indent + 1) }
            return "[" + nl + body.joined(separator: "," + nl) + nl + close + "]"
        case .string(let s): return quote(s)
        case .number(let t): return t
        case .bool(let b): return b ? "true" : "false"
        case .null: return "null"
        }
    }
}

// MARK: - Outline (the visual structure beside the source)

struct ONode: Identifiable {
    var id: String
    var key: String
    var value: String
    var tag: String
    var line: Int
    var children: [ONode] = []
}

enum Outliner {
    private final class Box {
        var n: ONode
        var kids: [Box] = []
        init(_ n: ONode) { self.n = n }
    }

    /// Builds a tree from (depth, node) pairs in document order.
    static func tree(_ items: [(Int, ONode)]) -> [ONode] {
        var roots: [Box] = []
        var stack: [(Int, Box)] = []
        for (d, n) in items {
            let b = Box(n)
            while let last = stack.last, last.0 >= d { stack.removeLast() }
            if let parent = stack.last { parent.1.kids.append(b) } else { roots.append(b) }
            stack.append((d, b))
        }
        func conv(_ b: Box) -> ONode {
            var n = b.n
            n.children = b.kids.map(conv)
            if !n.children.isEmpty && n.tag.isEmpty { n.tag = "\(n.children.count) 项" }
            return n
        }
        return roots.map(conv)
    }

    static func preview(_ s: String) -> String {
        let t = s.trimmingCharacters(in: .whitespaces)
        return t.count > 70 ? String(t.prefix(70)) + "…" : t
    }

    // JSON
    static func json(_ n: JNode) -> [ONode] {
        func node(_ v: JNode, key: String, path: String, line: Int) -> ONode {
            switch v {
            case .object(let items):
                let kids = items.enumerated().map { (i, it) in node(it.value, key: it.key, path: path + "/\(i)", line: it.line) }
                return ONode(id: path, key: key, value: "{ … }", tag: "对象 · \(items.count) 键", line: line, children: kids)
            case .array(let items):
                let kids = items.enumerated().map { (i, it) in node(it.value, key: "[\(i)]", path: path + "/\(i)", line: it.line) }
                return ONode(id: path, key: key, value: "[ … ]", tag: "数组 · \(items.count) 项", line: line, children: kids)
            case .string(let s): return ONode(id: path, key: key, value: preview(JWriter.quote(s)), tag: "字符串", line: line)
            case .number(let t): return ONode(id: path, key: key, value: t, tag: "数字", line: line)
            case .bool(let b): return ONode(id: path, key: key, value: b ? "true" : "false", tag: "布尔", line: line)
            case .null: return ONode(id: path, key: key, value: "null", tag: "空", line: line)
            }
        }
        let root = node(n, key: "根", path: "r", line: 1)
        return root.children.isEmpty ? [root] : root.children
    }

    // YAML: by indentation
    static func yaml(_ text: String) -> ([ONode], [String]) {
        var items: [(Int, ONode)] = []
        var issues: [String] = []
        let keyRx = try! NSRegularExpression(pattern: #"^([^\s#'"][^:#]*?|'[^']*'|"[^"]*"):(?:\s+(.*))?$"#)
        var inBlock: Int? = nil
        for (i, raw) in text.components(separatedBy: "\n").enumerated() {
            let line = i + 1
            let lead = raw.prefix { $0 == " " || $0 == "\t" }
            if lead.contains("\t") { issues.append("第 \(line) 行：缩进里有 Tab，YAML 只允许空格") }
            let indent = lead.count
            let body = raw.dropFirst(lead.count).trimmingCharacters(in: .whitespaces)
            if body.isEmpty || body.hasPrefix("#") { continue }
            if let b = inBlock {
                if indent > b { continue }
                inBlock = nil
            }
            if body == "---" || body == "..." {
                items.append((0, ONode(id: "l\(line)", key: "— 文档 —", value: "", tag: "", line: line)))
                continue
            }
            var depth = indent
            var content = body
            var isItem = false
            if content == "-" || content.hasPrefix("- ") {
                isItem = true
                content = String(content.dropFirst(1)).trimmingCharacters(in: .whitespaces)
            }
            let ns = content as NSString
            if let m = keyRx.firstMatch(in: content, range: NSRange(location: 0, length: ns.length)) {
                let k = ns.substring(with: m.range(at: 1))
                let v = m.range(at: 2).location != NSNotFound ? ns.substring(with: m.range(at: 2)) : ""
                if isItem {
                    items.append((depth, ONode(id: "i\(line)", key: "•", value: "", tag: "列表项", line: line)))
                    depth += 2
                }
                items.append((depth, ONode(id: "l\(line)", key: k, value: preview(v), tag: v.isEmpty ? "" : "值", line: line)))
                if v == "|" || v == ">" || v.hasPrefix("|") || v.hasPrefix(">") { inBlock = depth }
            } else if isItem {
                items.append((depth, ONode(id: "l\(line)", key: "•", value: preview(content), tag: "列表项", line: line)))
            }
        }
        return (tree(items), issues)
    }

    // Shell rc files: what they set up
    static func shell(_ text: String) -> [ONode] {
        func rx(_ p: String) -> NSRegularExpression { try! NSRegularExpression(pattern: p) }
        let assign = rx(#"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$"#)
        let alias = rx(#"^\s*alias\s+([^=\s]+)=(.*)$"#)
        let fn1 = rx(#"^\s*function\s+([\w.:-]+)"#)
        let fn2 = rx(#"^\s*([\w.:-]+)\s*\(\s*\)"#)
        let src = rx(#"^\s*(?:source|\.)\s+(\S+)"#)
        var envs: [ONode] = [], paths: [ONode] = [], aliases: [ONode] = [], fns: [ONode] = [], srcs: [ONode] = []
        for (i, raw) in text.components(separatedBy: "\n").enumerated() {
            let line = i + 1
            let t = raw.trimmingCharacters(in: .whitespaces)
            if t.isEmpty || t.hasPrefix("#") { continue }
            let ns = raw as NSString
            let all = NSRange(location: 0, length: ns.length)
            func g(_ m: NSTextCheckingResult, _ k: Int) -> String {
                m.range(at: k).location == NSNotFound ? "" : ns.substring(with: m.range(at: k))
            }
            if let m = alias.firstMatch(in: raw, range: all) {
                aliases.append(ONode(id: "a\(line)", key: g(m, 1), value: preview(g(m, 2)), tag: "别名", line: line))
            } else if let m = assign.firstMatch(in: raw, range: all) {
                let k = g(m, 1), v = g(m, 2)
                let exported = t.hasPrefix("export")
                envs.append(ONode(id: "e\(line)", key: k, value: preview(v), tag: exported ? "export" : "变量", line: line))
                if k == "PATH" {
                    let clean = v.trimmingCharacters(in: CharacterSet(charactersIn: "\"' "))
                    for (j, part) in clean.split(separator: ":").enumerated() {
                        paths.append(ONode(id: "p\(line)-\(j)", key: String(part), value: "", tag: "第 \(line) 行", line: line))
                    }
                }
            } else if let m = fn1.firstMatch(in: raw, range: all) ?? fn2.firstMatch(in: raw, range: all) {
                fns.append(ONode(id: "f\(line)", key: g(m, 1) + "()", value: "", tag: "函数", line: line))
            } else if let m = src.firstMatch(in: raw, range: all) {
                srcs.append(ONode(id: "s\(line)", key: g(m, 1), value: "", tag: "引用", line: line))
            }
        }
        var roots: [ONode] = []
        func group(_ id: String, _ title: String, _ kids: [ONode]) {
            guard !kids.isEmpty else { return }
            roots.append(ONode(id: id, key: title, value: "", tag: "\(kids.count) 项", line: kids[0].line, children: kids))
        }
        group("g-env", "环境变量", envs)
        group("g-path", "PATH 搜索路径", paths)
        group("g-alias", "别名 alias", aliases)
        group("g-fn", "函数", fns)
        group("g-src", "引用的文件 source", srcs)
        return roots
    }

    // ini / conf / env / sshd_config / hosts
    static func ini(_ text: String) -> [ONode] {
        var items: [(Int, ONode)] = []
        var inSection = false
        for (i, raw) in text.components(separatedBy: "\n").enumerated() {
            let line = i + 1
            let t = raw.trimmingCharacters(in: .whitespaces)
            if t.isEmpty || t.hasPrefix("#") || t.hasPrefix(";") { continue }
            if t.hasPrefix("[") && t.hasSuffix("]") {
                items.append((0, ONode(id: "s\(line)", key: t, value: "", tag: "节", line: line)))
                inSection = true
                continue
            }
            let k: String, v: String
            if let eq = t.firstIndex(of: "=") {
                k = t[..<eq].trimmingCharacters(in: .whitespaces)
                v = t[t.index(after: eq)...].trimmingCharacters(in: .whitespaces)
            } else if let sp = t.firstIndex(where: { $0 == " " || $0 == "\t" }) {
                k = String(t[..<sp])
                v = t[sp...].trimmingCharacters(in: .whitespaces)
            } else {
                k = t
                v = ""
            }
            items.append((inSection ? 1 : 0, ONode(id: "k\(line)", key: k, value: preview(v), tag: "", line: line)))
        }
        return tree(items)
    }
}

struct OutlinePanel: View {
    let roots: [ONode]
    var onJump: (Int) -> Void
    @State private var collapsed: Set<String> = []

    struct Row: Identifiable {
        let id: String
        let node: ONode
        let depth: Int
    }

    private var rows: [Row] {
        var out: [Row] = []
        func walk(_ ns: [ONode], _ d: Int) {
            for n in ns {
                if out.count > 4000 { return }
                out.append(Row(id: n.id, node: n, depth: d))
                if !n.children.isEmpty && !collapsed.contains(n.id) { walk(n.children, d + 1) }
            }
        }
        walk(roots, 0)
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Text("点任意一项跳到源码").font(Fonts.hand(12)).foregroundStyle(Ink.muted)
                Spacer()
                Button("全部展开") { collapsed = [] }.buttonStyle(SketchButtonStyle(kind: .chip))
                Button("全部收起") {
                    var all = Set<String>()
                    func walk(_ ns: [ONode]) { for n in ns where !n.children.isEmpty { all.insert(n.id); walk(n.children) } }
                    walk(roots)
                    collapsed = all
                }
                .buttonStyle(SketchButtonStyle(kind: .chip))
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(rows) { r in
                        OutlineRowView(row: r, open: !collapsed.contains(r.id)) {
                            if collapsed.contains(r.id) { collapsed.remove(r.id) } else { collapsed.insert(r.id) }
                        } onJump: {
                            onJump(r.node.line)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }
}

struct OutlineRowView: View {
    let row: OutlinePanel.Row
    let open: Bool
    var onToggle: () -> Void
    var onJump: () -> Void
    @State private var hover = false

    var body: some View {
        let n = row.node
        HStack(spacing: 6) {
            Canvas { ctx, size in
                for d in 0..<row.depth {
                    let x = CGFloat(d) * 16 + 7
                    ctx.ink([CGPoint(x: x, y: 0), CGPoint(x: x, y: size.height)], width: 0.7, color: Ink.pencil, amp: 0, seed: 1)
                }
                if row.depth > 0 {
                    let x = CGFloat(row.depth - 1) * 16 + 7
                    ctx.ink([CGPoint(x: x, y: size.height / 2), CGPoint(x: x + 9, y: size.height / 2)], width: 0.7, color: Ink.pencil, amp: 0, seed: 2)
                }
            }
            .frame(width: CGFloat(row.depth) * 16, height: 22)
            if n.children.isEmpty {
                Text("·").font(Fonts.hand(14)).foregroundStyle(Ink.muted).frame(width: 12)
            } else {
                Text(open ? "▾" : "▸").font(Fonts.hand(14, bold: true)).foregroundStyle(Ink.red).frame(width: 12)
                    .onTapGesture { onToggle() }
            }
            Text(n.key).font(Fonts.hand(15, bold: true)).foregroundStyle(Ink.shadow).lineLimit(1)
            if !n.value.isEmpty {
                Text(n.value).font(Fonts.mono(11)).foregroundStyle(Ink.ink).lineLimit(1)
            }
            Spacer(minLength: 4)
            if !n.tag.isEmpty {
                Text(n.tag).font(Fonts.hand(11)).foregroundStyle(Ink.muted).lineLimit(1)
            }
            Text("\(n.line)").font(Fonts.mono(9)).foregroundStyle(Ink.pencil).frame(width: 34, alignment: .trailing)
        }
        .padding(.horizontal, 6)
        .background(hover ? Ink.gold.opacity(0.25) : Color.clear)
        .contentShape(Rectangle())
        .onHover { hover = $0 }
        .onTapGesture { onJump() }
        .help("跳到第 \(n.line) 行")
    }
}

// MARK: - Writing files, including as captain

extension FleetStore {
    func writeFile(_ id: UUID, path: String, content: String, elevated: Bool) async -> SSHResult {
        let p = shq(path)
        if !elevated { return await run(id, "cat > \(p)", stdin: content, timeout: 60) }
        guard let acct = server(id)?.active else { return SSHResult(out: "", err: "没有登舰账户", code: -2) }
        switch acct.privilege {
        case .root:
            return await run(id, "cat > \(p)", stdin: content, timeout: 60)
        case .nopasswd:
            return await run(id, "sudo -n tee -- \(p) >/dev/null", stdin: content, timeout: 60)
        case .password:
            guard let pw = acct.sudoPassword else { return SSHResult(out: "", err: "钥匙串里没有 sudo 密码", code: -2) }
            return await run(id, "sudo -S -p '' tee -- \(p) >/dev/null", stdin: pw + "\n" + content, timeout: 60)
        default:
            return SSHResult(out: "", err: "\(acct.title) 是\(acct.privilege.roleName)，没有 sudo，写不了这个文件", code: -2)
        }
    }
}

// MARK: - The editor page

struct EditTarget: Identifiable, Equatable {
    let id = UUID()
    var path: String
    var name: String
}

struct FileEditorView: View {
    @Environment(FleetStore.self) private var store
    let cfg: ServerConfig
    let target: EditTarget
    var onClose: () -> Void

    enum Mode: String { case source, split, visual }
    struct Check { var ok: Bool; var msg: String; var line: Int? }
    struct Confirm: Identifiable { let id = UUID(); let title: String; let msg: String }

    @State private var absPath = ""
    @State private var text = ""
    @State private var original = ""
    @State private var kind: FileKind = .text
    @State private var autoKind = true
    @State private var loading = true
    @State private var readOnly = false
    @State private var note = ""
    @State private var writable = true
    @State private var elevated = false
    @State private var exists = true
    @State private var mtime = ""
    @State private var owner = ""
    @State private var perms = ""
    @State private var size: Double = 0
    @State private var mode: Mode = .split
    @State private var outline: [ONode] = []
    @State private var check: Check?
    @State private var jump: JumpRequest?
    @State private var jumpToken = 0
    @State private var backup = true
    @State private var saving = false
    @State private var confirm: Confirm?
    @State private var askDiscard = false
    @State private var rebuildTask: Task<Void, Never>?

    private var dirty: Bool { text != original }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            HStack(alignment: .top, spacing: 14) {
                if mode != .visual {
                    editorCard
                }
                if mode != .source {
                    structureCard
                        .frame(width: mode == .visual ? nil : 380)
                        .frame(maxWidth: mode == .visual ? .infinity : 380)
                }
            }
            .frame(maxHeight: .infinity)
            footer
        }
        .task { await load() }
        .onChange(of: text) { _, _ in scheduleRebuild() }
        .onChange(of: kind) { _, _ in rebuild() }
        .confirmationDialog(confirm?.title ?? "",
                            isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
                            presenting: confirm) { _ in
            Button("仍然保存", role: .destructive) { Task { await doSave() } }
            Button("取消", role: .cancel) {}
        } message: { c in
            Text(c.msg)
        }
        .confirmationDialog("放弃未保存的修改？", isPresented: $askDiscard) {
            Button("放弃修改并返回", role: .destructive) { onClose() }
            Button("继续编辑", role: .cancel) {}
        }
    }

    // MARK: Pieces

    private var header: some View {
        HStack(alignment: .bottom, spacing: 10) {
            Button("← 返回目录") {
                if dirty { askDiscard = true } else { onClose() }
            }
            .buttonStyle(SketchButtonStyle(kind: .plain))
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text("EDITOR · \(kind.label)").font(Fonts.hand(12, bold: true)).tracking(1.3).foregroundStyle(Ink.red)
                    if elevated || !writable {
                        Text(store.privilege(cfg.id).canSudo ? "· 以舰长身份（sudo）" : "· 只读：没有写权限")
                            .font(Fonts.hand(12, bold: true)).foregroundStyle(Ink.wood)
                    }
                }
                HStack(spacing: 8) {
                    Text(target.name).font(Fonts.serif(22)).foregroundStyle(Ink.ink).lineLimit(1)
                    if dirty { Text("● 未保存").font(Fonts.hand(14, bold: true)).foregroundStyle(Ink.red) }
                }
                Text(absPath.isEmpty ? target.path : absPath).font(Fonts.mono(11)).foregroundStyle(Ink.muted).lineLimit(1).textSelection(.enabled)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                HStack(spacing: 4) {
                    Text("语法").font(Fonts.hand(13, bold: true)).foregroundStyle(Ink.ink)
                    ForEach(FileKind.allCases) { k in
                        Button(k.label) { autoKind = false; kind = k }
                            .buttonStyle(SketchButtonStyle(kind: .chip, active: kind == k))
                    }
                }
                HStack(spacing: 4) {
                    Button("源码") { mode = .source }.buttonStyle(SketchButtonStyle(kind: .chip, active: mode == .source))
                    Button("源码 + 结构") { mode = .split }.buttonStyle(SketchButtonStyle(kind: .chip, active: mode == .split))
                    Button("结构") { mode = .visual }.buttonStyle(SketchButtonStyle(kind: .chip, active: mode == .visual))
                    if kind == .json {
                        Button("格式化") { format(pretty: true) }.buttonStyle(SketchButtonStyle(kind: .chip)).disabled(readOnly)
                        Button("压缩") { format(pretty: false) }.buttonStyle(SketchButtonStyle(kind: .chip)).disabled(readOnly)
                    }
                    if kind == .shell || kind == .yaml {
                        Button("服务器校验") { Task { await remoteCheck(announce: true) } }.buttonStyle(SketchButtonStyle(kind: .chip))
                    }
                    Button("重新读取") {
                        if dirty { store.say("还不行：有未保存的修改。先保存，或者返回后再打开。", .refuse); return }
                        Task { await load() }
                    }
                    .buttonStyle(SketchButtonStyle(kind: .chip))
                    Button(saving ? "保存中…" : saveLabel) { Task { await save() } }
                        .buttonStyle(SketchButtonStyle(kind: .solid))
                        .disabled(saving || readOnly || loading || (!dirty && exists))
                        .keyboardShortcut("s", modifiers: [.command])
                }
            }
        }
    }

    private var saveLabel: String {
        (elevated || !writable) ? "以舰长身份保存 ⌘S" : "保存 ⌘S"
    }

    private var editorCard: some View {
        VStack(spacing: 0) {
            if loading {
                Text("正在从「\(cfg.title)」读取…").font(Fonts.hand(16)).foregroundStyle(Ink.muted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                CodeEditor(text: $text, kind: kind, editable: !readOnly, jump: jump)
            }
        }
        .padding(2)
        .background(Ink.cream)
        .overlay(SketchRect(seed: 301).stroke(Ink.ink, lineWidth: 1.3))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var structureCard: some View {
        SketchCard(kicker: "Structure", title: structureTitle, seed: 302) {
            if kind == .text {
                textStats
            } else if outline.isEmpty {
                Text(check?.ok == false ? "先修好上面的语法错误，结构才画得出来。" : "这个文件里没有可以列出的结构。")
                    .font(Fonts.hand(14)).foregroundStyle(Ink.muted)
                Spacer()
            } else {
                OutlinePanel(roots: outline) { goto($0) }
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private var structureTitle: String {
        switch kind {
        case .json: return "JSON 树"
        case .yaml: return "YAML 大纲"
        case .shell: return "这个脚本设置了什么"
        case .ini: return "配置项"
        case .text: return "文本概况"
        }
    }

    private var textStats: some View {
        let lines = text.isEmpty ? 0 : text.components(separatedBy: "\n").count
        let words = text.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).count
        let longest = text.components(separatedBy: "\n").map(\.count).max() ?? 0
        let crlf = text.contains("\r\n")
        let trailing = text.components(separatedBy: "\n").filter { $0.hasSuffix(" ") || $0.hasSuffix("\t") }.count
        return VStack(alignment: .leading, spacing: 6) {
            statLine("行数", "\(lines)")
            statLine("词数", "\(words)")
            statLine("字符", "\(text.count)")
            statLine("最长一行", "\(longest) 字符")
            statLine("换行符", crlf ? "Windows (CRLF)" : "Unix (LF)")
            statLine("行尾多余空白", "\(trailing) 行")
            statLine("结尾换行", text.hasSuffix("\n") ? "有" : "没有")
            Spacer()
        }
    }

    private func statLine(_ k: String, _ v: String) -> some View {
        HStack {
            Text(k).font(Fonts.hand(15, bold: true)).foregroundStyle(Ink.shadow)
            Spacer()
            Text(v).font(Fonts.mono(12)).foregroundStyle(Ink.ink)
        }
    }

    private var footer: some View {
        HStack(spacing: 12) {
            if let c = check {
                Text((c.ok ? "✓ " : "✗ ") + c.msg)
                    .font(Fonts.hand(15, bold: true))
                    .foregroundStyle(c.ok ? Ink.okInk : Ink.red)
                    .lineLimit(2)
                if let l = c.line {
                    Button("跳到第 \(l) 行") { goto(l) }.buttonStyle(SketchButtonStyle(kind: .chip))
                }
            }
            if !note.isEmpty {
                Text(note).font(Fonts.hand(13)).foregroundStyle(Ink.wood).lineLimit(1)
            }
            Spacer()
            Text([size > 0 ? Fmt.bytes(size) : nil, owner.isEmpty ? nil : owner, perms.isEmpty ? nil : perms]
                .compactMap { $0 }.joined(separator: " · "))
                .font(Fonts.mono(10)).foregroundStyle(Ink.muted)
            SketchCheck(title: "保存前备份为 .rackbook.bak", isOn: $backup)
                .fixedSize()
        }
    }

    // MARK: Logic

    static func remoteExpr(_ p: String) -> String {
        if p == "~" { return "\"$HOME\"" }
        if p.hasPrefix("~/") { return "\"$HOME\"/" + shq(String(p.dropFirst(2))) }
        return shq(p)
    }

    private func goto(_ line: Int) {
        if mode == .visual { mode = .split }
        jumpToken += 1
        jump = JumpRequest(line: line, token: jumpToken)
    }

    private func load() async {
        loading = true
        note = ""
        elevated = false
        let rp = Self.remoteExpr(target.path)
        let cmd = #"F=\#(rp); printf '%s\n' "$F"; if [ -e "$F" ]; then stat -c '%Y %s %U %a' -- "$F"; ([ -w "$F" ] && echo W) || echo RO; else echo NONE; ([ -w "$(dirname -- "$F")" ] && echo W) || echo RO; fi; echo @@BODY; if [ -e "$F" ]; then head -c 1048577 -- "$F"; fi"#
        var r = await store.run(cfg.id, cmd, timeout: 60)
        guard let marker = r.out.range(of: "@@BODY\n") else {
            loading = false
            readOnly = true
            note = "读不到：" + SSH.cleanErr(r.err, fallback: "退出码 \(r.code)")
            store.say("还不行：\(target.path) 读不出来。", .refuse)
            return
        }
        let head = r.out[..<marker.lowerBound].split(separator: "\n").map(String.init)
        var body = String(r.out[marker.upperBound...])
        absPath = head.first ?? target.path
        let statLine = head.count > 1 ? head[1] : "NONE"
        writable = (head.count > 2 ? head[2] : "RO") == "W"
        if statLine == "NONE" {
            exists = false
            mtime = ""; owner = ""; perms = ""; size = 0
            note = "文件还不存在，保存时会新建。"
        } else {
            exists = true
            let f = statLine.split(separator: " ").map(String.init)
            mtime = f.first ?? ""
            size = f.count > 1 ? Double(f[1]) ?? 0 : 0
            owner = f.count > 2 ? f[2] : ""
            perms = f.count > 3 ? f[3] : ""
        }

        // No read permission: captains can read it with sudo.
        if exists && r.code != 0 && r.err.contains("Permission denied") {
            if store.privilege(cfg.id).canSudo {
                r = await store.sudo(cfg.id, "head -c 1048577 -- \(shq(absPath))", timeout: 60)
                if r.ok { body = r.out; elevated = true; note = "以舰长身份（sudo）读取。" }
            }
            if !elevated {
                loading = false
                readOnly = true
                text = ""; original = ""
                note = "没有读权限" + (store.privilege(cfg.id).canSudo ? "（sudo 也失败了）" : "；需要舰长账户")
                store.say("还不行：\(absPath) 没有读权限。\(store.privilege(cfg.id).canSudo ? "" : "你是领航员，可以在右上角换成舰长账户。")", .refuse)
                return
            }
        }

        readOnly = false
        if body.utf8.count > 1_048_576 {
            readOnly = true
            note = "超过 1 MB：只读，显示前 1 MB。"
        }
        if body.contains("\u{0}") {
            readOnly = true
            body = "（这是一个二进制文件，不能在这里编辑。可以回到目录里下载到 Mac。）"
            note = "二进制文件"
        } else if body.contains("\u{FFFD}") {
            readOnly = true
            note = "不是 UTF-8 编码：只读，避免保存时损坏内容。"
        }
        if !writable && !elevated && !store.privilege(cfg.id).canSudo {
            readOnly = true
            note = (note.isEmpty ? "" : note + " ") + "没有写权限：领航员只能查看。"
        }
        if autoKind { kind = FileKind.detect(name: target.name, content: body) }
        text = body
        original = body
        loading = false
        rebuild()
        store.say("打开 \(absPath)（\(kind.label)\(readOnly ? "，只读" : "")）。")
    }

    private func scheduleRebuild() {
        rebuildTask?.cancel()
        rebuildTask = Task {
            try? await Task.sleep(for: .milliseconds(text.utf8.count > 200_000 ? 900 : 300))
            if Task.isCancelled { return }
            rebuild()
        }
    }

    private func rebuild() {
        switch kind {
        case .json:
            var p = JParser(text)
            do {
                let n = try p.parse()
                outline = Outliner.json(n)
                check = Check(ok: true, msg: "JSON 结构正确", line: nil)
            } catch let e as JSONProblem {
                check = Check(ok: false, msg: "第 \(e.line) 行第 \(e.col) 列：\(e.msg)", line: e.line)
            } catch {
                check = Check(ok: false, msg: error.localizedDescription, line: nil)
            }
        case .yaml:
            let (o, issues) = Outliner.yaml(text)
            outline = o
            if let first = issues.first {
                let l = Int(first.components(separatedBy: " ").dropFirst().first ?? "")
                check = Check(ok: false, msg: first + (issues.count > 1 ? "（另有 \(issues.count - 1) 处）" : ""), line: l)
            } else {
                check = Check(ok: true, msg: "缩进没发现问题（点「服务器校验」做完整检查）", line: nil)
            }
        case .shell:
            outline = Outliner.shell(text)
            if check?.msg.hasPrefix("bash") != true { check = nil }
        case .ini:
            outline = Outliner.ini(text)
            check = nil
        case .text:
            outline = []
            check = nil
        }
    }

    private func format(pretty: Bool) {
        var p = JParser(text)
        guard let n = try? p.parse() else {
            store.say("还不行：JSON 里有错误，先修好再格式化。", .refuse)
            return
        }
        text = JWriter.render(n, pretty: pretty) + (pretty ? "\n" : "")
        store.say(pretty ? "已格式化（两个空格缩进，键的顺序不变）。" : "已压缩成一行。")
    }

    /// bash -n / zsh -n for shell scripts, PyYAML for YAML, run on the server against the text in the editor.
    @discardableResult
    private func remoteCheck(announce: Bool) async -> Check? {
        let cmd: String
        switch kind {
        case .shell:
            let sh = target.name.contains("zsh") ? "zsh" : "bash"
            cmd = "\(sh) -n 2>&1"
        case .yaml:
            cmd = #"python3 -c 'import sys,yaml; list(yaml.safe_load_all(sys.stdin))' 2>&1 || echo '@@FAIL'"#
        default:
            return nil
        }
        let r = await store.run(cfg.id, cmd, stdin: text, timeout: 30)
        let out = r.out.replacingOccurrences(of: "@@FAIL", with: "").trimmed
        var c: Check
        if kind == .yaml && out.contains("No module named") {
            c = Check(ok: true, msg: "服务器上没有 PyYAML，只做了本地缩进检查", line: nil)
        } else if r.ok && !r.out.contains("@@FAIL") && out.isEmpty {
            c = Check(ok: true, msg: kind == .shell ? "bash 语法检查通过" : "YAML 校验通过（PyYAML）", line: nil)
        } else {
            let msg = out.isEmpty ? SSH.cleanErr(r.err, fallback: "退出码 \(r.code)") : out
            let lineRx = try! NSRegularExpression(pattern: #"line (\d+)"#)
            let ns = msg as NSString
            let line = lineRx.firstMatch(in: msg, range: NSRange(location: 0, length: ns.length))
                .flatMap { Int(ns.substring(with: $0.range(at: 1))) }
            c = Check(ok: false, msg: String(msg.split(separator: "\n").first ?? Substring(msg)), line: line)
        }
        check = c
        if announce { store.say(c.ok ? c.msg + "。" : "校验没通过：" + c.msg, c.ok ? .ok : .refuse) }
        return c
    }

    private func save() async {
        guard !readOnly else { store.say("还不行：这个文件是只读的（\(note)）。", .refuse); return }
        // Someone else changed it meanwhile?
        if exists {
            let r = await store.run(cfg.id, "stat -c %Y -- \(shq(absPath))", timeout: 15)
            let now = r.out.trimmed
            if r.ok && !now.isEmpty && now != mtime {
                confirm = Confirm(title: "服务器上的文件被改过了", msg: "你打开以后，\(absPath) 在服务器上被修改过。保存会覆盖那些改动。")
                return
            }
        }
        // Syntax gate
        if kind == .json {
            var p = JParser(text)
            do { _ = try p.parse() } catch let e as JSONProblem {
                confirm = Confirm(title: "JSON 有错误", msg: "第 \(e.line) 行第 \(e.col) 列：\(e.msg)。保存后，读取这个文件的程序可能会出错。")
                return
            } catch {}
        }
        if kind == .shell, let c = await remoteCheck(announce: false), !c.ok {
            confirm = Confirm(title: "bash 语法检查没通过", msg: c.msg + "。保存后，新开的终端可能会报错。")
            return
        }
        await doSave()
    }

    private func doSave() async {
        saving = true
        defer { saving = false }
        let useSudo = elevated || !writable
        if useSudo && !store.privilege(cfg.id).canSudo {
            store.say("还不行：没有写权限，而你是\(store.privilege(cfg.id).roleName)。在右上角换成舰长账户再保存。", .refuse)
            return
        }
        var backedUp = false
        if backup && exists {
            let cmd = "cp -p -- \(shq(absPath)) \(shq(absPath + ".rackbook.bak"))"
            let r: SSHResult
            if useSudo { r = await store.sudo(cfg.id, cmd) } else { r = await store.run(cfg.id, cmd) }
            backedUp = r.ok
        }
        let content = text
        let r = await store.writeFile(cfg.id, path: absPath, content: content, elevated: useSudo)
        if r.ok {
            original = content
            exists = true
            let st = await store.run(cfg.id, "stat -c '%Y %s %U %a' -- \(shq(absPath))", timeout: 15)
            let f = st.out.trimmed.split(separator: " ").map(String.init)
            if f.count >= 4 { mtime = f[0]; size = Double(f[1]) ?? 0; owner = f[2]; perms = f[3] }
            note = ""
            store.say("已保存 \(absPath)" + (backedUp ? "，旧版本备份在 \(target.name).rackbook.bak" : "") + (useSudo ? "（以舰长身份）" : "") + "。", .ok)
        } else if !useSudo && r.err.contains("Permission denied") {
            writable = false
            store.say(store.privilege(cfg.id).canSudo ? "没有写权限。按钮已变成「以舰长身份保存」，再按一次即可。"
                                                      : "没有写权限，而你是领航员。换成舰长账户再保存。", .refuse)
        } else {
            store.say("没保存成功：" + SSH.cleanErr(r.err, fallback: "退出码 \(r.code)"), .refuse)
        }
    }
}
