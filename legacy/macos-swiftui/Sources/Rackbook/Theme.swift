import SwiftUI
import AppKit

// MARK: - Palette (marker-and-pencil, after the Tinycharts kit)

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255,
                  opacity: opacity)
    }
}

enum Ink {
    static let ink    = Color(hex: 0x231e16)
    static let red    = Color(hex: 0xc8372f)
    static let pencil = Color(hex: 0x7f9db3)
    static let shadow = Color(hex: 0x5d6c9c)
    static let paper  = Color(hex: 0xf8f3e6)
    static let cream  = Color(hex: 0xfffdf6)
    static let tan    = Color(hex: 0xecc98e)
    static let wood   = Color(hex: 0xc07f3f)
    static let pink   = Color(hex: 0xf3a6bb)
    static let rose   = Color(hex: 0xef6a4c)
    static let sage   = Color(hex: 0x93d3b0)
    static let sky    = Color(hex: 0xa9c8ee)
    static let blue   = Color(hex: 0x76a0e2)
    static let gold   = Color(hex: 0xf4b829)
    static let steel  = Color(hex: 0xc6ccce)
    static let shade  = Color(hex: 0xe3e0d2)
    static let muted  = Color(hex: 0x6f665a)
    static let okInk  = Color(hex: 0x2f7a54)

    static let washes: [(String, Color)] = [
        ("sky", sky), ("sage", sage), ("gold", gold), ("pink", pink),
        ("rose", rose), ("tan", tan), ("blue", blue), ("steel", steel)
    ]

    static func wash(_ name: String) -> Color {
        washes.first { $0.0 == name }?.1 ?? sky
    }

    /// Load colour: calm sage → busy gold → tight rose.
    static func load(_ pct: Double) -> Color {
        pct < 60 ? sage : (pct < 85 ? gold : rose)
    }

    static func darker(_ c: Color, _ f: CGFloat) -> Color {
        let ns = NSColor(c).usingColorSpace(.sRGB) ?? NSColor(c)
        return Color(nsColor: ns.blended(withFraction: f, of: .black) ?? ns)
    }

    static func lighter(_ c: Color, _ f: CGFloat) -> Color {
        let ns = NSColor(c).usingColorSpace(.sRGB) ?? NSColor(c)
        return Color(nsColor: ns.blended(withFraction: f, of: .white) ?? ns)
    }
}

// MARK: - Type: hand lettering, typewriter numbers, a chunky serif for titles

enum Fonts {
    private static func first(_ names: [String]) -> String? {
        names.first { NSFont(name: $0, size: 12) != nil }
    }
    static let handRegular = first(["Gaegu-Regular", "Noteworthy-Light", "ChalkboardSE-Light", "ChalkboardSE-Regular"])
    static let handBold    = first(["Gaegu-Bold", "Noteworthy-Bold", "ChalkboardSE-Bold"])
    static let monoRegular = first(["CourierPrime-Regular", "CutiveMono-Regular", "CourierNewPSMT", "Menlo-Regular"])
    static let monoBold    = first(["CourierPrime-Bold", "CourierNewPS-BoldMT", "Menlo-Bold"])
    static let serifName   = first(["YoungSerif-Regular", "Baskerville-SemiBold", "Georgia-Bold"])

    static func hand(_ size: CGFloat, bold: Bool = false) -> Font {
        if let n = bold ? handBold : handRegular { return .custom(n, size: size) }
        return .system(size: size, weight: bold ? .semibold : .regular, design: .rounded)
    }
    static func mono(_ size: CGFloat, bold: Bool = false) -> Font {
        if let n = bold ? monoBold : monoRegular { return .custom(n, size: size) }
        return .system(size: size, design: .monospaced)
    }
    static func serif(_ size: CGFloat) -> Font {
        if let n = serifName { return .custom(n, size: size) }
        return .system(size: size, weight: .bold, design: .serif)
    }
}

// MARK: - The pen: deterministic wobbly lines

struct SeededRNG {
    var state: UInt64
    init(_ seed: UInt64) { state = seed &+ 0x9E37_79B9_7F4A_7C15 }
    mutating func next() -> Double {
        state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        return Double((state >> 11) & ((1 << 53) - 1)) / Double(1 << 53)
    }
}

enum Sketch {
    private static func q(_ v: CGFloat) -> UInt64 {
        guard v.isFinite else { return 0 }
        let c = max(-1e12, min(1e12, (v * 4).rounded()))
        return UInt64(bitPattern: Int64(c))
    }

    static func seed(_ pts: [CGPoint], salt: UInt64 = 0) -> UInt64 {
        var h: UInt64 = 1_469_598_103_934_665_603 ^ salt
        for p in pts {
            h = (h ^ q(p.x)) &* 1_099_511_628_211
            h = (h ^ q(p.y)) &* 1_099_511_628_211
        }
        return h
    }

    /// A hand-drawn polyline: small smooth perpendicular wander, a little overshoot at the ends.
    static func path(_ pts: [CGPoint], closed: Bool = false, amp: CGFloat = 0.8,
                     seed: UInt64? = nil, over: CGFloat = 1.6) -> Path {
        var out = Path()
        guard pts.count >= 2 else { return out }
        var rng = SeededRNG(seed ?? Self.seed(pts))
        var poly = pts
        if closed { poly.append(pts[0]) }

        if over > 0 {
            let n = poly.count
            let a = poly[0], b = poly[1]
            let la = max(0.001, hypot(b.x - a.x, b.y - a.y))
            if !closed {
                poly[0] = CGPoint(x: a.x - (b.x - a.x) / la * over, y: a.y - (b.y - a.y) / la * over)
            }
            let y0 = poly[n - 2], z0 = poly[n - 1]
            let lz = max(0.001, hypot(z0.x - y0.x, z0.y - y0.y))
            let extra: CGFloat = closed ? over * 1.8 : over
            poly[n - 1] = CGPoint(x: z0.x + (z0.x - y0.x) / lz * extra, y: z0.y + (z0.y - y0.y) / lz * extra)
        }

        let f1: CGFloat = 0.035 + CGFloat(rng.next()) * 0.03
        let f2: CGFloat = 0.09 + CGFloat(rng.next()) * 0.05
        let p1: CGFloat = CGFloat(rng.next()) * 6.283
        let p2: CGFloat = CGFloat(rng.next()) * 6.283

        var samples: [CGPoint] = []
        var dist: CGFloat = 0
        for i in 0..<(poly.count - 1) {
            let a = poly[i], b = poly[i + 1]
            let dx = b.x - a.x, dy = b.y - a.y
            let len = max(0.001, hypot(dx, dy))
            let nx = -dy / len, ny = dx / len
            let steps = max(1, Int(len / 12))
            for s in 0..<steps {
                let t = CGFloat(s) / CGFloat(steps)
                let d = dist + len * t
                let off = amp * (0.65 * sin(d * f1 + p1) + 0.35 * sin(d * f2 + p2))
                samples.append(CGPoint(x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off))
            }
            dist += len
        }
        samples.append(poly[poly.count - 1])

        out.move(to: samples[0])
        if samples.count == 2 {
            out.addLine(to: samples[1])
            return out
        }
        for i in 1..<(samples.count - 1) {
            let mid = CGPoint(x: (samples[i].x + samples[i + 1].x) / 2, y: (samples[i].y + samples[i + 1].y) / 2)
            out.addQuadCurve(to: mid, control: samples[i])
        }
        out.addLine(to: samples[samples.count - 1])
        return out
    }

    static func poly(_ pts: [CGPoint]) -> Path {
        var p = Path()
        guard let f = pts.first else { return p }
        p.move(to: f)
        for q in pts.dropFirst() { p.addLine(to: q) }
        p.closeSubpath()
        return p
    }

    static func bounds(_ pts: [CGPoint]) -> CGRect {
        guard let f = pts.first else { return .zero }
        var r = CGRect(origin: f, size: .zero)
        for p in pts.dropFirst() { r = r.union(CGRect(origin: p, size: .zero)) }
        return r
    }

    static func circle(_ c: CGPoint, _ r: CGFloat, n: Int = 18) -> [CGPoint] {
        (0..<n).map { i in
            let t = CGFloat(i) / CGFloat(n) * 2 * .pi
            return CGPoint(x: c.x + r * cos(t), y: c.y + r * sin(t))
        }
    }
}

// MARK: - Drawing on a Canvas: ink, marker, pencil hatch

extension GraphicsContext {
    func ink(_ pts: [CGPoint], closed: Bool = false, width: CGFloat = 1.5, color: Color = Ink.ink,
             amp: CGFloat = 0.7, seed: UInt64? = nil) {
        let path = Sketch.path(pts, closed: closed, amp: amp, seed: seed)
        stroke(path, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
    }

    /// A marker wash: flat colour slightly off-register, with darker overlap streaks.
    func marker(_ pts: [CGPoint], _ color: Color, opacity: Double = 0.92, seed: UInt64? = nil,
                offset: CGSize = CGSize(width: 1.4, height: 1.1), streaks: Bool = true) {
        guard pts.count >= 3 else { return }
        let poly = Sketch.poly(pts.map { CGPoint(x: $0.x + offset.width, y: $0.y + offset.height) })
        fill(poly, with: .color(color.opacity(opacity)))
        guard streaks else { return }
        var c = self
        c.clip(to: poly)
        let b = poly.boundingRect
        guard b.width > 6, b.height > 6 else { return }
        var rng = SeededRNG(seed ?? Sketch.seed(pts, salt: 7))
        let dark = Ink.darker(color, 0.12).opacity(0.28 * opacity)
        var x = b.minX - b.height
        while x < b.maxX {
            let w = CGFloat(5 + rng.next() * 9)
            var s = Path()
            s.move(to: CGPoint(x: x, y: b.maxY))
            s.addLine(to: CGPoint(x: x + b.height * 0.6, y: b.minY))
            c.stroke(s, with: .color(dark), lineWidth: w * 0.45)
            x += w + 6 + CGFloat(rng.next() * 14)
        }
    }

    func hatch(_ pts: [CGPoint], color: Color = Ink.pencil, gap: CGFloat = 5, width: CGFloat = 0.7) {
        guard pts.count >= 3 else { return }
        let poly = Sketch.poly(pts)
        var c = self
        c.clip(to: poly)
        let b = poly.boundingRect
        var p = Path()
        var x = b.minX - b.height
        while x < b.maxX {
            p.move(to: CGPoint(x: x, y: b.maxY))
            p.addLine(to: CGPoint(x: x + b.height, y: b.minY))
            x += gap
        }
        c.stroke(p, with: .color(color), lineWidth: width)
    }

    func dot(_ c: CGPoint, _ r: CGFloat, _ color: Color, ring: Color? = Ink.ink, ringWidth: CGFloat = 1) {
        let rect = CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)
        fill(Path(ellipseIn: rect), with: .color(color))
        if let ring { stroke(Path(ellipseIn: rect), with: .color(ring), lineWidth: ringWidth) }
    }
}

// MARK: - Isometric projection (view along (1,1,1))

struct Box3 {
    var x: CGFloat, y: CGFloat, z: CGFloat, w: CGFloat, d: CGFloat, h: CGFloat
    func moved(_ dx: CGFloat, _ dy: CGFloat, _ dz: CGFloat) -> Box3 {
        Box3(x: x + dx, y: y + dy, z: z + dz, w: w, d: d, h: h)
    }
}

struct Iso {
    var origin: CGPoint
    var scale: CGFloat

    func p(_ x: CGFloat, _ y: CGFloat, _ z: CGFloat) -> CGPoint {
        CGPoint(x: origin.x + (x - y) * 0.866 * scale,
                y: origin.y + ((x + y) * 0.5 - z) * scale)
    }
    func top(_ b: Box3) -> [CGPoint] {
        [p(b.x, b.y, b.z + b.h), p(b.x + b.w, b.y, b.z + b.h), p(b.x + b.w, b.y + b.d, b.z + b.h), p(b.x, b.y + b.d, b.z + b.h)]
    }
    /// Face looking toward +y (shows on the left).
    func left(_ b: Box3) -> [CGPoint] {
        [p(b.x, b.y + b.d, b.z), p(b.x + b.w, b.y + b.d, b.z), p(b.x + b.w, b.y + b.d, b.z + b.h), p(b.x, b.y + b.d, b.z + b.h)]
    }
    /// Face looking toward +x (shows on the right).
    func right(_ b: Box3) -> [CGPoint] {
        [p(b.x + b.w, b.y, b.z), p(b.x + b.w, b.y + b.d, b.z), p(b.x + b.w, b.y + b.d, b.z + b.h), p(b.x + b.w, b.y, b.z + b.h)]
    }
    func outline(_ b: Box3) -> [CGPoint] {
        [p(b.x, b.y, b.z + b.h), p(b.x + b.w, b.y, b.z + b.h), p(b.x + b.w, b.y, b.z),
         p(b.x + b.w, b.y + b.d, b.z), p(b.x, b.y + b.d, b.z), p(b.x, b.y + b.d, b.z + b.h)]
    }
}

extension GraphicsContext {
    func box(_ iso: Iso, _ b: Box3, _ color: Color, seed: UInt64, stroke: Color = Ink.ink,
             width: CGFloat = 1.3, lit: Bool = false, topColor: Color? = nil, opacity: Double = 0.95) {
        let top = topColor ?? Ink.lighter(color, 0.2)
        marker(iso.left(b), Ink.darker(color, 0.14), opacity: opacity, seed: seed &+ 1)
        marker(iso.right(b), color, opacity: opacity, seed: seed &+ 2)
        marker(iso.top(b), top, opacity: opacity, seed: seed &+ 3)
        let c = iso.p(b.x + b.w, b.y + b.d, b.z + b.h)
        ink(iso.outline(b), closed: true, width: width, color: stroke, seed: seed)
        ink([iso.p(b.x, b.y + b.d, b.z + b.h), c, iso.p(b.x + b.w, b.y, b.z + b.h)],
            width: width * 0.8, color: stroke, amp: 0.5, seed: seed &+ 5)
        ink([c, iso.p(b.x + b.w, b.y + b.d, b.z)], width: width * 0.8, color: stroke, amp: 0.4, seed: seed &+ 6)
        if lit {
            ink(iso.outline(b), closed: true, width: 2.6, color: Ink.red, amp: 1.3, seed: seed &+ 9)
        }
    }
}

// MARK: - SwiftUI shapes & pieces

struct SketchRect: Shape {
    var seed: UInt64? = nil
    var amp: CGFloat = 0.9
    var inset: CGFloat = 1.5
    func path(in rect: CGRect) -> Path {
        let r = rect.insetBy(dx: inset, dy: inset)
        let pts = [CGPoint(x: r.minX, y: r.minY), CGPoint(x: r.maxX, y: r.minY),
                   CGPoint(x: r.maxX, y: r.maxY), CGPoint(x: r.minX, y: r.maxY)]
        return Sketch.path(pts, closed: true, amp: amp, seed: seed ?? Sketch.seed([CGPoint(x: r.width, y: r.height)]))
    }
}

struct SketchRule: Shape {
    var vertical = false
    var seed: UInt64 = 21
    func path(in r: CGRect) -> Path {
        if vertical {
            return Sketch.path([CGPoint(x: r.midX, y: r.minY), CGPoint(x: r.midX + 1, y: r.maxY)], amp: 1.0, seed: seed, over: 0)
        }
        return Sketch.path([CGPoint(x: r.minX, y: r.midY), CGPoint(x: r.maxX, y: r.midY + 1)], amp: 1.1, seed: seed, over: 0)
    }
}

struct PaperBackground: View {
    var grid: Bool = true
    var body: some View {
        Canvas { ctx, size in
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Ink.paper))
            if grid {
                var g = Path()
                var x: CGFloat = 0
                while x < size.width { g.move(to: CGPoint(x: x, y: 0)); g.addLine(to: CGPoint(x: x, y: size.height)); x += 24 }
                var y: CGFloat = 0
                while y < size.height { g.move(to: CGPoint(x: 0, y: y)); g.addLine(to: CGPoint(x: size.width, y: y)); y += 24 }
                ctx.stroke(g, with: .color(Ink.pencil.opacity(0.10)), lineWidth: 0.5)
            }
            var rng = SeededRNG(42)
            let n = Int(size.width * size.height / 700)
            var dots = Path()
            for _ in 0..<n {
                let x = CGFloat(rng.next()) * size.width
                let y = CGFloat(rng.next()) * size.height
                let r = CGFloat(0.4 + rng.next() * 0.7)
                dots.addEllipse(in: CGRect(x: x, y: y, width: r, height: r))
            }
            ctx.fill(dots, with: .color(Ink.ink.opacity(0.07)))
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

struct SketchCard<Content: View>: View {
    var kicker: String? = nil
    var title: String? = nil
    var wash: Color = Ink.cream
    var lit: Bool = false
    var seed: UInt64? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if kicker != nil || title != nil {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if let k = kicker {
                        Text(k.uppercased())
                            .font(Fonts.hand(13, bold: true))
                            .tracking(1.3)
                            .foregroundStyle(Ink.red)
                    }
                    if let t = title {
                        Text(t)
                            .font(Fonts.hand(19, bold: true))
                            .foregroundStyle(Ink.ink)
                            .lineLimit(1)
                    }
                }
            }
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            ZStack {
                Rectangle().fill(Ink.shadow.opacity(0.10)).offset(x: 5, y: 5)
                Rectangle().fill(wash.opacity(0.94)).padding(1)
                SketchRect(seed: seed)
                    .stroke(lit ? Ink.red : Ink.ink,
                            style: StrokeStyle(lineWidth: lit ? 2.2 : 1.4, lineCap: .round, lineJoin: .round))
            }
        )
    }
}

struct SketchButtonStyle: ButtonStyle {
    enum Kind { case plain, solid, danger, chip }
    var kind: Kind = .plain
    var active: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        SketchButtonBody(configuration: configuration, kind: kind, active: active)
    }
}

private struct SketchButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let kind: SketchButtonStyle.Kind
    let active: Bool
    @State private var hover = false
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        let small = kind == .chip
        let fg: Color
        let bg: Color
        let border: Color
        switch kind {
        case .solid:
            fg = hover ? Ink.gold : Ink.cream
            bg = Ink.ink
            border = Ink.ink
        case .danger:
            fg = Ink.red
            bg = hover ? Ink.rose.opacity(0.28) : Ink.cream
            border = Ink.red
        case .plain, .chip:
            fg = Ink.ink
            bg = active ? Ink.gold.opacity(0.8) : (hover ? Ink.gold.opacity(0.35) : Ink.cream)
            border = active ? Ink.red : Ink.ink
        }
        return configuration.label
            .font(Fonts.hand(small ? 14 : 16, bold: true))
            .foregroundStyle(fg)
            .lineLimit(1)
            .padding(.horizontal, small ? 9 : 14)
            .padding(.vertical, small ? 2 : 5)
            .background(
                ZStack {
                    Rectangle().fill(bg).offset(x: 1.5, y: 1.5)
                    SketchRect(amp: 0.6, inset: 1)
                        .stroke(border, style: StrokeStyle(lineWidth: active ? 2 : 1.3, lineCap: .round, lineJoin: .round))
                }
            )
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(enabled ? 1 : 0.45)
            .onHover { hover = $0 }
    }
}

struct SketchField: View {
    var placeholder: String
    @Binding var text: String
    var mono: Bool = false
    var onSubmit: () -> Void = {}

    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .font(mono ? Fonts.mono(13) : Fonts.hand(16))
            .foregroundStyle(Ink.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                ZStack {
                    Rectangle().fill(Ink.cream)
                    SketchRect(amp: 0.6, inset: 1).stroke(Ink.ink.opacity(0.8), lineWidth: 1.1)
                }
            )
            .onSubmit(onSubmit)
    }
}

struct MarkerBar: View {
    var value: Double
    var color: Color
    var height: CGFloat = 10

    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            let v = CGFloat(max(0, min(1, value.isFinite ? value : 0)))
            if v > 0.003 {
                let fw = max(4, w * v)
                ctx.marker([CGPoint(x: 1, y: 1.5), CGPoint(x: fw, y: 0.5), CGPoint(x: fw - 1.5, y: h - 0.5), CGPoint(x: 0, y: h - 1)],
                           color, seed: 77, offset: .zero, streaks: false)
            }
            ctx.ink([CGPoint(x: 0, y: 0), CGPoint(x: w, y: 0), CGPoint(x: w, y: h), CGPoint(x: 0, y: h)],
                    closed: true, width: 1, color: Ink.ink.opacity(0.85), amp: 0.45, seed: 99)
        }
        .frame(height: height)
    }
}

struct MiniMeter: View {
    var label: String
    var value: Double
    var text: String
    var body: some View {
        HStack(spacing: 6) {
            Text(label).font(Fonts.mono(10, bold: true)).foregroundStyle(Ink.ink).frame(width: 34, alignment: .leading)
            MarkerBar(value: value, color: Ink.load(value * 100), height: 8)
            Text(text).font(Fonts.mono(10)).foregroundStyle(Ink.ink).frame(width: 40, alignment: .trailing)
        }
    }
}

struct Sparkline: View {
    var values: [Double]
    var color: Color
    var maxY: Double? = nil
    var body: some View {
        Canvas { ctx, size in
            guard values.count >= 2 else {
                ctx.ink([CGPoint(x: 0, y: size.height - 1), CGPoint(x: size.width, y: size.height - 1)],
                        width: 0.8, color: Ink.pencil, amp: 0.4, seed: 3)
                return
            }
            let m = maxY ?? max(1, (values.max() ?? 1) * 1.15)
            let step = size.width / CGFloat(max(1, values.count - 1))
            let pts = values.enumerated().map { (i, v) -> CGPoint in
                CGPoint(x: CGFloat(i) * step, y: size.height - 2 - (size.height - 4) * CGFloat(min(1, max(0, v / m))))
            }
            var area = Path()
            area.move(to: CGPoint(x: 0, y: size.height))
            for p in pts { area.addLine(to: p) }
            area.addLine(to: CGPoint(x: pts[pts.count - 1].x, y: size.height))
            area.closeSubpath()
            ctx.fill(area, with: .color(color.opacity(0.45)))
            var line = Path()
            line.addLines(pts)
            ctx.stroke(line, with: .color(Ink.ink.opacity(0.85)), style: StrokeStyle(lineWidth: 1.2, lineCap: .round, lineJoin: .round))
            ctx.dot(pts[pts.count - 1], 2.6, Ink.red, ring: nil)
        }
    }
}

struct TitleBlock: View {
    var kicker: String
    var title: String
    var subtitle: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(kicker.uppercased())
                .font(Fonts.hand(13, bold: true))
                .tracking(1.5)
                .foregroundStyle(Ink.red)
                .lineLimit(1)
            Text(title)
                .font(Fonts.serif(30))
                .foregroundStyle(Ink.ink)
                .lineLimit(1)
            SketchRule().stroke(Ink.red, style: StrokeStyle(lineWidth: 2, lineCap: .round)).frame(width: 130, height: 6)
            if let s = subtitle {
                Text(s).font(Fonts.hand(15)).foregroundStyle(Ink.muted).lineLimit(1)
            }
        }
    }
}

struct HealthDot: View {
    var health: Health
    var body: some View {
        Canvas { ctx, size in
            let r = min(size.width, size.height) / 2 - 1
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let pts = Sketch.circle(c, r, n: 12)
            ctx.marker(pts, health.color, opacity: 1, seed: 5, offset: .zero, streaks: false)
            ctx.ink(pts, closed: true, width: 1.1, amp: 0.3, seed: 6)
            if health == .down {
                ctx.ink([CGPoint(x: c.x - r * 0.6, y: c.y - r * 0.6), CGPoint(x: c.x + r * 0.6, y: c.y + r * 0.6)], width: 1.4, color: Ink.red, amp: 0.2, seed: 8)
                ctx.ink([CGPoint(x: c.x + r * 0.6, y: c.y - r * 0.6), CGPoint(x: c.x - r * 0.6, y: c.y + r * 0.6)], width: 1.4, color: Ink.red, amp: 0.2, seed: 9)
            }
        }
    }
}

struct Footnote: View {
    var text: String
    var body: some View {
        Text(text).font(Fonts.hand(13)).foregroundStyle(Ink.muted)
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
