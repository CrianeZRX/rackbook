import SwiftUI

enum Subsystem: String, CaseIterable, Identifiable {
    case cpu, mem, gpu, net, disk
    var id: String { rawValue }

    var title: String {
        switch self {
        case .cpu: return "处理器"
        case .mem: return "内存"
        case .gpu: return "显卡"
        case .net: return "网络"
        case .disk: return "磁盘"
        }
    }
    var tag: String {
        switch self {
        case .cpu: return "CPU"
        case .mem: return "Memory"
        case .gpu: return "GPU"
        case .net: return "Network"
        case .disk: return "Storage"
        }
    }

    func sentence(_ s: Snapshot?) -> String {
        guard let s else { return "还没有数据：等这台服务器接通再看\(title)。" }
        switch self {
        case .cpu:
            return "处理器：\(s.cores) 核，此刻占用 \(Fmt.pct(s.cpu))，1 分钟负载 \(Fmt.num(s.load1))。"
        case .mem:
            return "内存：用了 \(Fmt.bytes(s.memUsed)) / \(Fmt.bytes(s.memTotal))，另有 \(Fmt.bytes(s.memCache)) 是可回收的缓存。"
        case .gpu:
            if s.gpus.isEmpty { return "显卡：这艘船上没检测到显卡（没有 nvidia-smi，也没有 amdgpu）。" }
            let g = s.gpus
            let mem = g.reduce(0) { $0 + $1.memUsed }, tot = g.reduce(0) { $0 + $1.memTotal }
            return "显卡：\(g.count) 块，平均占用 \(Fmt.pct(s.gpuUtil))，显存 \(Fmt.bytes(mem)) / \(Fmt.bytes(tot))。"
        case .net:
            return "网络：下行 \(Fmt.rate(s.rxRate))，上行 \(Fmt.rate(s.txRate))，\(s.tcp) 个已建立的 TCP 连接。"
        case .disk:
            let w = s.worstDisk
            return "磁盘：读 \(Fmt.rate(s.ioRead))，写 \(Fmt.rate(s.ioWrite))" +
                (w.map { "；最满的是 \($0.mount)，已用 \(Fmt.pct($0.frac * 100))。" } ?? "。")
        }
    }
}

struct ExplodeAnim {
    var from: Double = 1
    var to: Double = 1
    var start: Date = .distantPast
    func value(at t: Date) -> Double {
        let k = min(1, max(0, t.timeIntervalSince(start) / 0.9))
        let e = k < 0.5 ? 4 * k * k * k : 1 - pow(-2 * k + 2, 3) / 2
        return from + (to - from) * e
    }
}

/// The hero: an isometric server, drawn in ink and marker, that comes apart.
/// Every number on it, the fans' spin and the packets on the cable come from the same snapshot.
struct TeardownView: View {
    let snap: Snapshot?
    let health: Health
    @Binding var focus: Subsystem
    var exploded: Bool
    var onPick: (Subsystem) -> Void = { _ in }
    @State private var anim = ExplodeAnim()

    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
                let e = anim.value(at: tl.date)
                Canvas { ctx, size in
                    TeardownPainter(snap: snap, health: health, focus: focus, e: CGFloat(e),
                                    time: tl.date.timeIntervalSinceReferenceDate, size: size).draw(ctx)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture(coordinateSpace: .local) { loc in
                let e = anim.value(at: Date())
                let painter = TeardownPainter(snap: snap, health: health, focus: focus, e: CGFloat(e), time: 0, size: geo.size)
                if let s = painter.hit(loc) { focus = s; onPick(s) }
            }
        }
        .onAppear {
            let v: Double = exploded ? 1 : 0
            anim = ExplodeAnim(from: v, to: v, start: .distantPast)
        }
        .onChange(of: exploded) { _, now in
            anim = ExplodeAnim(from: anim.value(at: Date()), to: now ? 1 : 0, start: Date())
        }
    }
}

struct TeardownPainter {
    let snap: Snapshot?
    let health: Health
    let focus: Subsystem
    let e: CGFloat
    let time: Double
    let size: CGSize

    enum Kind: Equatable { case floor, wall, frontWall, mobo, cooler, ram, fans, disk(Int), nic, psu, gpu }

    struct Part {
        let kind: Kind
        let box: Box3
        let sub: Subsystem?
        let seed: UInt64
    }

    struct Callout {
        let sub: Subsystem?
        let anchor: CGPoint
        let left: Bool
        let title: String
        let value: String
        let note: String
    }

    var down: Bool { health == .down || health == .parked }
    var cpuPct: Double { down ? 0 : (snap?.cpu ?? 0) }

    var iso: Iso {
        let s = max(0.35, min((size.width - 340) / 540, (size.height - 30) / 470))
        return Iso(origin: CGPoint(x: size.width / 2 - 52 * s, y: size.height / 2 - 38 * s), scale: s)
    }

    var mountsForBays: [Mount] {
        Array((snap?.mounts ?? []).sorted { $0.size > $1.size }.prefix(4))
    }

    var parts: [Part] {
        let H: CGFloat = 52
        let nearH = H * (1 - e) + 12 * e
        var p: [Part] = []
        p.append(Part(kind: .floor, box: Box3(x: 0, y: 0, z: 0, w: 300, d: 180, h: 4), sub: nil, seed: 101))
        p.append(Part(kind: .wall, box: Box3(x: 0, y: 0, z: 4, w: 4, d: 180, h: H - 4), sub: nil, seed: 102))
        p.append(Part(kind: .wall, box: Box3(x: 4, y: 0, z: 4, w: 296, d: 4, h: H - 4), sub: nil, seed: 103))
        p.append(Part(kind: .frontWall, box: Box3(x: 296, y: 4, z: 4, w: 4, d: 176, h: nearH - 4), sub: nil, seed: 104))
        p.append(Part(kind: .wall, box: Box3(x: 4, y: 176, z: 4, w: 292, d: 4, h: nearH - 4), sub: nil, seed: 105))
        p.append(Part(kind: .mobo, box: Box3(x: 78, y: 14, z: 4, w: 106, d: 152, h: 3).moved(0, 0, 14 * e), sub: nil, seed: 106))
        p.append(Part(kind: .cooler, box: Box3(x: 95, y: 62, z: 7, w: 56, d: 56, h: 30).moved(0, 0, 76 * e), sub: .cpu, seed: 107))
        p.append(Part(kind: .ram, box: Box3(x: 80, y: 30, z: 7, w: 90, d: 24, h: 24).moved(0, 0, 46 * e), sub: .mem, seed: 108))
        p.append(Part(kind: .ram, box: Box3(x: 80, y: 126, z: 7, w: 90, d: 24, h: 24).moved(0, 0, 46 * e), sub: .mem, seed: 109))
        p.append(Part(kind: .fans, box: Box3(x: 192, y: 14, z: 4, w: 16, d: 152, h: 40).moved(0, 0, 26 * e), sub: .cpu, seed: 110))
        for i in 0..<4 {
            let b = Box3(x: 238, y: 12 + CGFloat(i) * 40, z: 5, w: 56, d: 36, h: 34)
                .moved((62 + CGFloat(i) * 10) * e, 0, 6 * e)
            p.append(Part(kind: .disk(i), box: b, sub: .disk, seed: 120 + UInt64(i)))
        }
        p.append(Part(kind: .gpu, box: Box3(x: 44, y: 16, z: 6, w: 28, d: 86, h: 22).moved(0, 0, 64 * e), sub: .gpu, seed: 113))
        p.append(Part(kind: .nic, box: Box3(x: 6, y: 20, z: 8, w: 34, d: 64, h: 16).moved(-78 * e, 0, 24 * e), sub: .net, seed: 111))
        p.append(Part(kind: .psu, box: Box3(x: 6, y: 108, z: 5, w: 66, d: 58, h: 36).moved(-70 * e, 0, 8 * e), sub: nil, seed: 112))
        return p
    }

    // MARK: Painter's order for boxes seen along (1,1,1)

    func behind(_ a: Box3, _ b: Box3) -> Bool {
        let eps: CGFloat = 0.01
        return a.x + a.w <= b.x + eps || a.y + a.d <= b.y + eps || a.z + a.h <= b.z + eps
    }

    func order(_ ps: [Part], _ iso: Iso) -> [Int] {
        let n = ps.count
        let rects = ps.map { Sketch.bounds(iso.outline($0.box)) }
        var before = Array(repeating: Set<Int>(), count: n)
        for i in 0..<n {
            for j in 0..<n where i != j {
                guard rects[i].intersects(rects[j]) else { continue }
                if behind(ps[i].box, ps[j].box) && !behind(ps[j].box, ps[i].box) { before[j].insert(i) }
            }
        }
        let key = ps.map { $0.box.x + $0.box.w / 2 + $0.box.y + $0.box.d / 2 + $0.box.z }
        var done = Set<Int>()
        var out: [Int] = []
        while out.count < n {
            let open = (0..<n).filter { !done.contains($0) }
            let ready = open.filter { before[$0].isSubset(of: done) }
            let pool = ready.isEmpty ? open : ready
            guard let pick = pool.min(by: { key[$0] < key[$1] }) else { break }
            done.insert(pick)
            out.append(pick)
        }
        return out
    }

    // MARK: Draw

    func draw(_ ctx: GraphicsContext) {
        let iso = self.iso
        let shadow = [iso.p(0, 0, 0), iso.p(300, 0, 0), iso.p(300, 180, 0), iso.p(0, 180, 0)]
            .map { CGPoint(x: $0.x + 12, y: $0.y + 14) }
        ctx.fill(Sketch.poly(shadow), with: .color(Ink.shadow.opacity(0.12)))
        ctx.hatch(shadow, color: Ink.shadow.opacity(0.30), gap: 6)

        let ps = parts
        for i in order(ps, iso) { drawPart(ctx, iso, ps[i]) }
        if let nic = ps.first(where: { $0.kind == .nic }) { drawCable(ctx, iso, nic.box) }
        drawLid(ctx, iso)
        drawCallouts(ctx, iso, ps)

        if down {
            let c = iso.p(150, 90, 120)
            ctx.draw(Text(health == .parked ? "停泊 · 已主动断开连接" : "失联 · 这台机器此刻联系不上").font(Fonts.hand(22, bold: true)).foregroundStyle(Ink.red),
                     at: c, anchor: .center)
        }
    }

    func color(_ c: Color) -> Color { down ? Ink.shade : c }

    func drawPart(_ ctx: GraphicsContext, _ iso: Iso, _ part: Part) {
        let b = part.box
        let lit = part.sub != nil && part.sub == focus && !down
        let topZ = b.z + b.h
        switch part.kind {
        case .floor:
            ctx.box(iso, b, color(Ink.steel), seed: part.seed)
        case .wall:
            guard b.h > 0.5 else { return }
            ctx.box(iso, b, color(Ink.steel), seed: part.seed, width: 1.1)
        case .frontWall:
            guard b.h > 0.5 else { return }
            ctx.box(iso, b, color(Ink.steel), seed: part.seed, width: 1.1)
            if e < 0.5 {
                let X = b.x + b.w
                for i in 0..<4 {
                    let y0 = 12 + CGFloat(i) * 40
                    let bay = [iso.p(X, y0, 10), iso.p(X, y0 + 34, 10), iso.p(X, y0 + 34, 40), iso.p(X, y0, 40)]
                    ctx.marker(bay, color(Ink.tan), opacity: 0.8, seed: 400 + UInt64(i))
                    ctx.ink(bay, closed: true, width: 0.9, seed: 410 + UInt64(i))
                }
                ctx.dot(iso.p(X, 170, 30), 3, health.color)
            }
        case .mobo:
            ctx.box(iso, b, color(Ink.sage), seed: part.seed, width: 1.1)
            for k in 0..<5 {
                let y = b.y + 14 + CGFloat(k) * 30
                ctx.ink([iso.p(b.x + 6, y, topZ), iso.p(b.x + b.w - 6, y + 6, topZ)], width: 0.6,
                        color: Ink.darker(Ink.sage, 0.45), amp: 0.3, seed: 200 + UInt64(k))
            }
        case .cooler:
            let heat = color(Ink.load(cpuPct))
            ctx.box(iso, b, color(Ink.steel), seed: part.seed, lit: lit, topColor: heat)
            for k in 1..<7 {
                let y = b.y + b.d * CGFloat(k) / 7
                ctx.ink([iso.p(b.x + 4, y, topZ), iso.p(b.x + b.w - 4, y, topZ)], width: 0.8, amp: 0.25, seed: 220 + UInt64(k))
                ctx.ink([iso.p(b.x + b.w, y, b.z + 3), iso.p(b.x + b.w, y, topZ - 3)], width: 0.7, amp: 0.2, seed: 230 + UInt64(k))
            }
        case .ram:
            let bank = b.y < 100 ? 0 : 1
            let lights = Int(((snap?.memFrac ?? 0) * 8).rounded())
            for k in 0..<4 {
                let stick = Box3(x: b.x, y: b.y + CGFloat(k) * 6 + 1, z: b.z, w: b.w, d: 3.6, h: b.h)
                let on = !down && (bank * 4 + k) < lights
                ctx.box(iso, stick, on ? Ink.blue : Ink.shade, seed: part.seed &+ UInt64(k * 17), width: 1)
                ctx.ink([iso.p(stick.x + 40, stick.y + stick.d, stick.z + 3), iso.p(stick.x + 40, stick.y + stick.d, stick.z + 8)],
                        width: 0.8, color: Ink.ink, amp: 0, seed: 240)
            }
            if lit { ctx.ink(iso.outline(b), closed: true, width: 2.4, color: Ink.red, amp: 1.3, seed: part.seed &+ 9) }
        case .fans:
            let speed = down ? 0 : (0.35 + cpuPct / 100 * 2.6)
            for k in 0..<5 {
                let fb = Box3(x: b.x, y: b.y + CGFloat(k) * 30.4 + 1, z: b.z, w: b.w, d: 28, h: b.h)
                ctx.box(iso, fb, color(Ink.steel), seed: part.seed &+ UInt64(k * 13), width: 1.1)
                let X = fb.x + fb.w, yc = fb.y + fb.d / 2, zc = fb.z + fb.h / 2, r: CGFloat = 12
                let ring = (0..<16).map { i -> CGPoint in
                    let t = CGFloat(i) / 16 * 2 * .pi
                    return iso.p(X, yc + r * cos(t), zc + r * sin(t))
                }
                ctx.ink(ring, closed: true, width: 0.9, amp: 0.3, seed: 250 + UInt64(k))
                let a0 = CGFloat(time * speed * 2 * .pi) + CGFloat(k)
                for bl in 0..<4 {
                    let a = a0 + CGFloat(bl) * .pi / 2
                    let blade = [iso.p(X, yc, zc),
                                 iso.p(X, yc + r * 0.9 * cos(a), zc + r * 0.9 * sin(a)),
                                 iso.p(X, yc + r * 0.9 * cos(a + 0.5), zc + r * 0.9 * sin(a + 0.5))]
                    ctx.fill(Sketch.poly(blade), with: .color(Ink.ink.opacity(0.55)))
                }
            }
            if lit { ctx.ink(iso.outline(b), closed: true, width: 2.0, color: Ink.red.opacity(0.7), amp: 1.2, seed: part.seed &+ 9) }
        case .disk(let i):
            ctx.box(iso, b, color(Ink.tan), seed: part.seed, lit: lit)
            let ms = mountsForBays
            if i < ms.count && !down {
                let f = CGFloat(max(0.02, min(1, ms[i].frac)))
                let y0 = b.y + b.d * 0.32, y1 = b.y + b.d * 0.68
                let strip = [iso.p(b.x + 4, y0, topZ), iso.p(b.x + 4 + (b.w - 8) * f, y0, topZ),
                             iso.p(b.x + 4 + (b.w - 8) * f, y1, topZ), iso.p(b.x + 4, y1, topZ)]
                ctx.marker(strip, Ink.load(ms[i].frac * 100), opacity: 1, seed: 260 + UInt64(i), offset: .zero, streaks: false)
                let frame = [iso.p(b.x + 4, y0, topZ), iso.p(b.x + b.w - 4, y0, topZ),
                             iso.p(b.x + b.w - 4, y1, topZ), iso.p(b.x + 4, y1, topZ)]
                ctx.ink(frame, closed: true, width: 0.8, amp: 0.3, seed: 270 + UInt64(i))
                let busy = ((snap?.ioRead ?? 0) + (snap?.ioWrite ?? 0)) > 8192
                let blink = busy && sin(time * 18 + Double(i) * 1.7) > 0
                ctx.dot(iso.p(b.x + b.w, b.y + 6, b.z + 8), 2.6, blink ? Ink.gold : Ink.sage)
            } else {
                ctx.hatch(iso.top(b), color: Ink.pencil.opacity(0.8), gap: 4)
            }
            ctx.ink([iso.p(b.x + b.w, b.y + 12, b.z + 20), iso.p(b.x + b.w, b.y + b.d - 6, b.z + 20)],
                    width: 1.4, amp: 0.2, seed: 280 + UInt64(i))
        case .nic:
            ctx.box(iso, b, color(Ink.sky), seed: part.seed, lit: lit)
            let Y = b.y + b.d
            for k in 0..<2 {
                let x0 = b.x + 6 + CGFloat(k) * 12
                let port = [iso.p(x0, Y, b.z + 4), iso.p(x0 + 8, Y, b.z + 4), iso.p(x0 + 8, Y, b.z + 11), iso.p(x0, Y, b.z + 11)]
                ctx.fill(Sketch.poly(port), with: .color(Ink.ink.opacity(0.75)))
            }
        case .gpu:
            drawGPU(ctx, iso, part)
        case .psu:
            ctx.box(iso, b, color(Ink.shade), seed: part.seed)
            let c = (cx: b.x + b.w / 2, cy: b.y + b.d / 2)
            let ring = (0..<16).map { i -> CGPoint in
                let t = CGFloat(i) / 16 * 2 * .pi
                return iso.p(c.cx + 18 * cos(t), c.cy + 18 * sin(t), topZ)
            }
            ctx.ink(ring, closed: true, width: 0.9, amp: 0.3, seed: 290)
            ctx.ink([iso.p(c.cx - 18, c.cy, topZ), iso.p(c.cx + 18, c.cy, topZ)], width: 0.7, amp: 0.2, seed: 291)
            ctx.ink([iso.p(c.cx, c.cy - 18, topZ), iso.p(c.cx, c.cy + 18, topZ)], width: 0.7, amp: 0.2, seed: 292)
        }
    }

    func drawGPU(_ ctx: GraphicsContext, _ iso: Iso, _ part: Part) {
        let b = part.box
        let gpus = down ? [] : (snap?.gpus ?? [])
        let lit = focus == .gpu && !down
        let topZ = b.z + b.h
        if gpus.isEmpty {
            let dash = StrokeStyle(lineWidth: 1.1, lineCap: .round, dash: [4, 4])
            ctx.stroke(Sketch.path(iso.outline(b), closed: true, amp: 0.5, seed: part.seed), with: .color(Ink.pencil), style: dash)
            ctx.stroke(Sketch.path([iso.p(b.x, b.y + b.d, topZ), iso.p(b.x + b.w, b.y + b.d, topZ), iso.p(b.x + b.w, b.y, topZ)], amp: 0.4, seed: part.seed &+ 1),
                       with: .color(Ink.pencil), style: dash)
            ctx.draw(Text("空槽").font(Fonts.hand(12)).foregroundStyle(Ink.pencil), at: iso.p(b.x + b.w / 2, b.y + b.d / 2, topZ + 6), anchor: .center)
            if lit { ctx.ink(iso.outline(b), closed: true, width: 2.2, color: Ink.red, amp: 1.2, seed: part.seed &+ 9) }
            return
        }
        let util = gpus.reduce(0) { $0 + $1.util } / Double(gpus.count)
        ctx.box(iso, b, Ink.pink, seed: part.seed, lit: lit, topColor: Ink.lighter(Ink.pink, 0.35))
        // heatsink fins on the long visible face
        for k in 1..<9 {
            let x = b.x + b.w * CGFloat(k) / 9
            ctx.ink([iso.p(x, b.y + b.d, b.z + 3), iso.p(x, b.y + b.d, topZ - 3)], width: 0.7, amp: 0.2, seed: 600 + UInt64(k))
        }
        // two fans on the shroud, spinning with utilisation
        let speed = 0.3 + util / 100 * 3.2
        for f in 0..<2 {
            let cx = b.x + b.w / 2, cy = b.y + b.d * (f == 0 ? 0.28 : 0.72), r: CGFloat = 11
            let ring = (0..<16).map { i -> CGPoint in
                let t = CGFloat(i) / 16 * 2 * .pi
                return iso.p(cx + r * cos(t), cy + r * sin(t), topZ)
            }
            ctx.marker(ring, Ink.steel, opacity: 0.9, seed: 610 + UInt64(f), offset: .zero, streaks: false)
            ctx.ink(ring, closed: true, width: 0.9, amp: 0.3, seed: 620 + UInt64(f))
            let a0 = CGFloat(time * speed * 2 * .pi) + CGFloat(f) * 0.7
            for bl in 0..<5 {
                let a = a0 + CGFloat(bl) * 2 * .pi / 5
                let blade = [iso.p(cx, cy, topZ),
                             iso.p(cx + r * 0.9 * cos(a), cy + r * 0.9 * sin(a), topZ),
                             iso.p(cx + r * 0.9 * cos(a + 0.45), cy + r * 0.9 * sin(a + 0.45), topZ)]
                ctx.fill(Sketch.poly(blade), with: .color(Ink.ink.opacity(0.5)))
            }
        }
        // PCIe bracket on the back and a load strip on the edge
        ctx.ink([iso.p(b.x, b.y + b.d, b.z - 4), iso.p(b.x, b.y + b.d, topZ + 2)], width: 2.2, color: Ink.ink, amp: 0.2, seed: 630)
        let f = CGFloat(max(0.02, min(1, util / 100)))
        let strip = [iso.p(b.x + b.w, b.y + 6, b.z + 4), iso.p(b.x + b.w, b.y + 6 + (b.d - 12) * f, b.z + 4),
                     iso.p(b.x + b.w, b.y + 6 + (b.d - 12) * f, b.z + 9), iso.p(b.x + b.w, b.y + 6, b.z + 9)]
        ctx.marker(strip, Ink.load(util), opacity: 1, seed: 640, offset: .zero, streaks: false)
        if gpus.count > 1 {
            ctx.draw(Text("×\(gpus.count)").font(Fonts.mono(12, bold: true)).foregroundStyle(Ink.red),
                     at: iso.p(b.x + b.w, b.y, topZ + 10), anchor: .center)
        }
    }

    func drawCable(_ ctx: GraphicsContext, _ iso: Iso, _ nic: Box3) {
        let Y = nic.y + nic.d
        let model: [(CGFloat, CGFloat, CGFloat)] = [
            (nic.x + 10, Y, nic.z + 7), (nic.x + 10, Y + 26, nic.z + 7),
            (nic.x - 14, Y + 52, nic.z - 2), (nic.x - 52, Y + 66, nic.z - 6)
        ]
        let pts = model.map { iso.p($0.0, $0.1, $0.2) }
        ctx.ink(pts, width: 2.4, color: Ink.ink, amp: 0.4, seed: 300)

        var lens: [CGFloat] = [0]
        for i in 1..<pts.count { lens.append(lens[i - 1] + hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)) }
        let total = max(1, lens[lens.count - 1])
        func at(_ u: CGFloat) -> CGPoint {
            let d = u * total
            for i in 1..<pts.count where lens[i] >= d {
                let t = (d - lens[i - 1]) / max(0.001, lens[i] - lens[i - 1])
                return CGPoint(x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t)
            }
            return pts[pts.count - 1]
        }
        guard !down, let s = snap else { return }
        func flow(_ rate: Double, inbound: Bool, color: Color, shift: CGFloat) {
            guard rate > 64 else { return }
            let mag = log10(rate / 1024 + 1)
            let count = min(8, 1 + Int(mag * 2))
            let speed = 0.12 + min(1.0, mag * 0.22)
            for k in 0..<count {
                var f = (time * speed + Double(k) / Double(count)).truncatingRemainder(dividingBy: 1)
                if inbound { f = 1 - f }
                let p = at(CGFloat(f))
                ctx.dot(CGPoint(x: p.x + shift, y: p.y - shift), 3.2, color, ring: Ink.ink, ringWidth: 0.8)
            }
        }
        flow(s.rxRate, inbound: true, color: Ink.blue, shift: -3)
        flow(s.txRate, inbound: false, color: Ink.rose, shift: 3)
    }

    func drawLid(_ ctx: GraphicsContext, _ iso: Iso) {
        let b = Box3(x: 0, y: 0, z: 52, w: 300, d: 180, h: 4).moved(-24 * e, 0, 150 * e)
        let solid = max(0, 1 - Double(e) * 1.8)
        if solid > 0.02 {
            ctx.box(iso, b, color(Ink.cream), seed: 130, opacity: 0.97 * solid)
            if e < 0.05 {
                for k in 0..<6 {
                    let x = 150 + CGFloat(k) * 18
                    ctx.ink([iso.p(x, 40, b.z + b.h), iso.p(x, 140, b.z + b.h)], width: 0.9, color: Ink.pencil, amp: 0.3, seed: 310 + UInt64(k))
                }
                ctx.draw(Text("RACKBOOK").font(Fonts.mono(11, bold: true)).foregroundStyle(Ink.red),
                         at: iso.p(70, 90, b.z + b.h), anchor: .center)
            }
        }
        if e > 0.05 {
            let dash = StrokeStyle(lineWidth: 1, lineCap: .round, dash: [5, 4])
            ctx.stroke(Sketch.path(iso.outline(b), closed: true, amp: 0.5, seed: 131), with: .color(Ink.pencil), style: dash)
            let c = iso.p(b.x + b.w, b.y + b.d, b.z + b.h)
            ctx.stroke(Sketch.path([iso.p(b.x, b.y + b.d, b.z + b.h), c, iso.p(b.x + b.w, b.y, b.z + b.h)], amp: 0.4, seed: 132),
                       with: .color(Ink.pencil), style: dash)
            ctx.draw(Text("盖板 · 已掀开").font(Fonts.hand(13)).foregroundStyle(Ink.pencil),
                     at: iso.p(20, 20, b.z + b.h + 8), anchor: .bottomLeading)
        }
    }

    // MARK: Callouts in the margins

    func callouts(_ iso: Iso, _ ps: [Part]) -> [Callout] {
        func top(_ k: Kind) -> CGPoint? {
            guard let b = ps.first(where: { $0.kind == k })?.box else { return nil }
            return iso.p(b.x + b.w / 2, b.y + b.d / 2, b.z + b.h)
        }
        let s = down ? nil : snap
        func v(_ f: (Snapshot) -> String) -> String { s.map(f) ?? "—" }
        let rpm = Int(900 + cpuPct * 48)
        var out: [Callout] = []
        if let a = top(.cooler) {
            out.append(Callout(sub: .cpu, anchor: a, left: false, title: "CPU · 处理器",
                               value: v { "\($0.cores) 核 · \(Fmt.pct($0.cpu))" },
                               note: v { "负载 " + $0.loadText }))
        }
        if let a = top(.fans) {
            out.append(Callout(sub: .cpu, anchor: a, left: false, title: "FANS · 风扇",
                               value: down ? "停转" : "≈ \(rpm) rpm",
                               note: "示意：随 CPU 占用加速"))
        }
        if let a = top(.disk(0)) {
            out.append(Callout(sub: .disk, anchor: a, left: false, title: "DISKS · 磁盘",
                               value: v { m in m.worstDisk.map { "\($0.mount) \(Fmt.pct($0.frac * 100))" } ?? "无挂载" },
                               note: v { "读 \(Fmt.rate($0.ioRead)) · 写 \(Fmt.rate($0.ioWrite))" }))
        }
        if let a = top(.ram) {
            out.append(Callout(sub: .mem, anchor: a, left: true, title: "MEMORY · 内存",
                               value: v { "\(Fmt.bytes($0.memUsed)) / \(Fmt.bytes($0.memTotal))" },
                               note: v { "缓存 \(Fmt.bytes($0.memCache)) · swap \(Fmt.bytes($0.swapUsed))" }))
        }
        if let a = top(.gpu) {
            let g = s?.gpus ?? []
            if g.isEmpty {
                out.append(Callout(sub: .gpu, anchor: a, left: true, title: "GPU · 显卡",
                                   value: s == nil ? "—" : "未检测到",
                                   note: "空的 PCIe 槽（虚线）"))
            } else {
                let mem = g.reduce(0) { $0 + $1.memUsed }, tot = g.reduce(0) { $0 + $1.memTotal }
                let temp = g.compactMap(\.temp).max()
                out.append(Callout(sub: .gpu, anchor: a, left: true, title: "GPU · 显卡",
                                   value: "\(g.count) 块 · \(Fmt.pct(s?.gpuUtil ?? 0))",
                                   note: "显存 \(Fmt.bytes(mem)) / \(Fmt.bytes(tot))" + (temp.map { " · \(Int($0))°C" } ?? "")))
            }
        }
        if let a = top(.nic) {
            out.append(Callout(sub: .net, anchor: a, left: true, title: "NETWORK · 网卡",
                               value: v { "↓ \(Fmt.rate($0.rxRate))  ↑ \(Fmt.rate($0.txRate))" },
                               note: v { "\($0.tcp) 个 TCP 连接" }))
        }
        if let a = top(.psu) {
            out.append(Callout(sub: nil, anchor: a, left: true, title: "SYSTEM · 电源",
                               value: v { "已运行 \(Fmt.uptime($0.uptime))" },
                               note: v { $0.os.isEmpty ? $0.kernel : $0.os }))
        }
        return out
    }

    func drawCallouts(_ ctx: GraphicsContext, _ iso: Iso, _ ps: [Part]) {
        let all = callouts(iso, ps)
        for side in [true, false] {
            let items = all.filter { $0.left == side }.sorted { $0.anchor.y < $1.anchor.y }
            guard !items.isEmpty else { continue }
            let topY: CGFloat = 40, bottomY = size.height - 30
            let gap = (bottomY - topY) / CGFloat(items.count)
            for (i, c) in items.enumerated() {
                let y = topY + gap * (CGFloat(i) + 0.5)
                let lit = c.sub != nil && c.sub == focus && !down
                let x: CGFloat = side ? 14 : size.width - 14
                let anchor: UnitPoint = side ? .leading : .trailing
                let t1 = ctx.resolve(Text(c.title).font(Fonts.hand(16, bold: true)).foregroundStyle(lit ? Ink.red : Ink.ink))
                let t2 = ctx.resolve(Text(c.value).font(Fonts.mono(12, bold: true)).foregroundStyle(Ink.ink))
                let t3 = ctx.resolve(Text(c.note).font(Fonts.hand(13)).foregroundStyle(Ink.muted))
                let box = CGSize(width: 220, height: 40)
                let w = min(200, max(t1.measure(in: box).width, t2.measure(in: box).width, t3.measure(in: box).width))
                ctx.draw(t1, at: CGPoint(x: x, y: y - 18), anchor: anchor)
                ctx.draw(t2, at: CGPoint(x: x, y: y), anchor: anchor)
                ctx.draw(t3, at: CGPoint(x: x, y: y + 17), anchor: anchor)
                if lit {
                    let ux0 = side ? x : x - w
                    ctx.ink([CGPoint(x: ux0, y: y - 8), CGPoint(x: ux0 + min(w, 90), y: y - 7)], width: 1.6, color: Ink.red, amp: 0.6, seed: 500 + UInt64(i))
                }
                let sx = side ? x + w + 10 : x - w - 10
                let elbow = CGPoint(x: sx + (side ? 18 : -18), y: y - 2)
                ctx.ink([CGPoint(x: sx, y: y - 2), elbow, c.anchor], width: lit ? 1.6 : 1.0,
                        color: lit ? Ink.red : Ink.ink.opacity(0.7), amp: 0.6, seed: 520 + UInt64(i) + (side ? 0 : 50))
                ctx.dot(c.anchor, lit ? 3.6 : 2.6, lit ? Ink.red : Ink.ink, ring: nil)
                if lit {
                    let ring = Sketch.circle(c.anchor, 8, n: 12)
                    ctx.ink(ring, closed: true, width: 1.4, color: Ink.red, amp: 0.5, seed: 540)
                }
            }
        }
    }

    // MARK: Hit test

    func hit(_ pt: CGPoint) -> Subsystem? {
        let iso = self.iso
        let ps = parts
        for i in order(ps, iso).reversed() {
            let part = ps[i]
            if Sketch.poly(iso.outline(part.box)).contains(pt) {
                if let sub = part.sub { return sub }
                if part.kind == .mobo || part.kind == .floor || part.kind == .psu { continue }
            }
        }
        return nil
    }
}
