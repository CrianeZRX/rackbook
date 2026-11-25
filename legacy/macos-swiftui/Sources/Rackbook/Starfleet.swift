import SwiftUI

// MARK: - A starship, drawn with the pen

enum ShipPainter {
    /// Draws one ship pointing right, centred on `c`.
    static func draw(_ ctx: GraphicsContext, at c: CGPoint, unit: CGFloat, cls: ShipClass, hull: Color,
                     health: Health, load: Double, time: Double, seed: UInt64, flagship: Bool) {
        let L = unit * cls.size
        let dead = health == .down || health == .parked
        let tilt: CGFloat = health == .down ? 0.35 : 0
        func P(_ u: CGFloat, _ v: CGFloat) -> CGPoint {
            let x = u * cos(tilt) - v * sin(tilt), y = u * sin(tilt) + v * cos(tilt)
            return CGPoint(x: c.x + x * L, y: c.y + y * L)
        }
        let body = dead ? (health == .parked ? Ink.steel : Ink.shade) : hull
        let l = CGFloat(max(0, min(1, load)))

        // Engine plume: cool ion blue when calm, gold when busy, rose when the ship is working hard.
        let vs: [CGFloat] = cls.engines == 1 ? [0] : (cls.engines == 2 ? [-0.1, 0.1] : [-0.14, 0, 0.14])
        if !dead {
            let outer = l < 0.6 ? Ink.sky : (l < 0.85 ? Ink.gold : Ink.rose)
            for (k, v) in vs.enumerated() {
                let flick = 1 + 0.14 * CGFloat(sin(time * 22 + Double(k) * 1.7 + Double(seed % 7)))
                let len = (0.2 + l * 0.85) * flick
                ctx.marker([P(-0.66, v - 0.06), P(-0.66 - len, v), P(-0.66, v + 0.06)], outer, opacity: 0.95,
                           seed: seed &+ UInt64(k), offset: .zero, streaks: false)
                ctx.marker([P(-0.66, v - 0.025), P(-0.66 - len * 0.5, v), P(-0.66, v + 0.025)], Ink.cream, opacity: 1,
                           seed: seed &+ 20, offset: .zero, streaks: false)
            }
        }
        // Shield
        if !dead && (health == .hot || health == .warn) {
            let pulse = health == .hot ? 0.45 + 0.4 * (0.5 + 0.5 * sin(time * 5)) : 0.6
            let ring = (0..<22).map { i -> CGPoint in
                let t = CGFloat(i) / 22 * 2 * .pi
                return CGPoint(x: c.x + cos(t) * L * 1.0, y: c.y + sin(t) * L * 0.8)
            }
            ctx.stroke(Sketch.path(ring, closed: true, amp: 0.8, seed: seed &+ 30),
                       with: .color((health == .hot ? Ink.red : Ink.gold).opacity(pulse)),
                       style: StrokeStyle(lineWidth: 1.6, lineCap: .round, dash: [5, 4]))
        }
        // Wings
        let wingTop = [P(0.15, -0.16), P(-0.28, -0.58), P(-0.52, -0.58), P(-0.42, -0.18)]
        let wingBot = [P(0.15, 0.16), P(-0.28, 0.58), P(-0.52, 0.58), P(-0.42, 0.18)]
        for (w, s) in [(wingTop, UInt64(1)), (wingBot, UInt64(2))] {
            ctx.marker(w, Ink.darker(body, 0.15), seed: seed &+ s)
            ctx.ink(w, closed: true, width: 1.2, seed: seed &+ s &+ 40)
        }
        // Hull
        let hullPts = [P(1.0, 0), P(0.45, -0.19), P(-0.55, -0.23), P(-0.68, -0.13),
                       P(-0.68, 0.13), P(-0.55, 0.23), P(0.45, 0.19)]
        ctx.marker(hullPts, body, seed: seed &+ 3)
        ctx.ink(hullPts, closed: true, width: 1.5, seed: seed &+ 4)
        ctx.ink([P(0.22, -0.18), P(0.22, 0.18)], width: 0.8, amp: 0.2, seed: seed &+ 5)
        ctx.ink([P(-0.25, -0.21), P(-0.25, 0.21)], width: 0.8, amp: 0.2, seed: seed &+ 6)
        if cls == .cruiser || cls == .carrier {
            let tower = [P(-0.18, -0.09), P(0.06, -0.09), P(0.06, 0.09), P(-0.18, 0.09)]
            ctx.marker(tower, Ink.shade, seed: seed &+ 7)
            ctx.ink(tower, closed: true, width: 1, seed: seed &+ 8)
        }
        if cls == .carrier {
            ctx.ink([P(-0.5, 0.0), P(0.15, 0.0)], width: 1.6, color: Ink.red, amp: 0.2, seed: seed &+ 9)
        }
        for v in vs {
            let n = [P(-0.68, v - 0.045), P(-0.74, v - 0.05), P(-0.74, v + 0.05), P(-0.68, v + 0.045)]
            ctx.fill(Sketch.poly(n), with: .color(Ink.ink))
        }
        // Cockpit
        let cock = Sketch.circle(P(0.52, 0), 0.075 * L, n: 10)
        ctx.marker(cock, dead ? Ink.shade : Ink.sky, opacity: 1, seed: seed &+ 10, offset: .zero, streaks: false)
        ctx.ink(cock, closed: true, width: 1, amp: 0.2, seed: seed &+ 11)
        // Flagship pennant
        if flagship && !dead {
            let mast = P(-0.42, -0.58)
            let top = CGPoint(x: mast.x, y: mast.y - 0.32 * L)
            ctx.ink([mast, top], width: 1.2, amp: 0, seed: seed &+ 12)
            let wave = CGFloat(sin(time * 4)) * 0.03 * L
            ctx.fill(Sketch.poly([top, CGPoint(x: top.x + 0.28 * L, y: top.y + 0.07 * L + wave), CGPoint(x: top.x, y: top.y + 0.14 * L)]),
                     with: .color(Ink.red))
        }
        if health == .down {
            ctx.draw(Text("z z").font(Fonts.hand(15, bold: true)).foregroundStyle(Ink.pencil), at: P(0.3, -0.7), anchor: .center)
        }
    }
}

struct MiniShip: View {
    var cls: ShipClass
    var hull: Color
    var health: Health
    var load: Double
    var body: some View {
        Canvas { ctx, size in
            let unit = min(size.width / 2.2, size.height / 1.6) / cls.size * min(1, cls.size + 0.15)
            ShipPainter.draw(ctx, at: CGPoint(x: size.width * 0.55, y: size.height * 0.5), unit: unit, cls: cls,
                             hull: hull, health: health, load: load, time: 0, seed: 77, flagship: false)
        }
    }
}

// MARK: - The star chart: the fleet in formation

struct StarfleetChart: View {
    @Environment(FleetStore.self) private var store

    struct Berth {
        let id: UUID
        let point: CGPoint
        let unit: CGFloat
        let cls: ShipClass
        let parked: Bool
    }

    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation(minimumInterval: 1.0 / 24)) { tl in
                Canvas { ctx, size in
                    draw(ctx, size: size, time: tl.date.timeIntervalSinceReferenceDate)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture(coordinateSpace: .local) { loc in
                let hit = layout(geo.size).min { a, b in hypot(a.point.x - loc.x, a.point.y - loc.y) < hypot(b.point.x - loc.x, b.point.y - loc.y) }
                if let h = hit, hypot(h.point.x - loc.x, h.point.y - loc.y) < h.unit * h.cls.size * 1.1 {
                    store.pane = .server(h.id)
                    if let s = store.server(h.id) { store.say("登上「\(s.title)」。") }
                } else {
                    store.say("星图：点任意一艘舰船登舰查看。")
                }
            }
        }
    }

    private func flagshipID() -> UUID? {
        let active = store.servers.filter { !$0.paused }
        let best = active.max { a, b in
            (store.live[a.id]?.snap?.cores ?? 0) < (store.live[b.id]?.snap?.cores ?? 0)
        }
        return best?.id ?? active.first?.id
    }

    func layout(_ size: CGSize) -> [Berth] {
        let flag = flagshipID()
        var active = store.servers.filter { !$0.paused }
        if let f = flag, let i = active.firstIndex(where: { $0.id == f }) { active.insert(active.remove(at: i), at: 0) }
        let parked = store.servers.filter { $0.paused }
        let dockH: CGFloat = parked.isEmpty ? 0 : 90
        let field = CGRect(x: 40, y: 50, width: size.width - 80, height: size.height - 70 - dockH)
        let unit: CGFloat = max(26, min(44, field.height / 7))
        var out: [Berth] = []
        let maxRow = CGFloat(max(1, active.count / 2))
        let fx = field.minX + field.width * 0.72, fy = field.midY
        let dx = min(170, (fx - field.minX - 60) / maxRow)
        let dy = min(110, (field.height / 2 - 40) / maxRow)
        for (k, s) in active.enumerated() {
            let cls = store.live[s.id]?.snap?.shipClass ?? .frigate
            if k == 0 {
                out.append(Berth(id: s.id, point: CGPoint(x: fx, y: fy), unit: unit, cls: cls, parked: false))
            } else {
                let row = CGFloat((k + 1) / 2)
                let side: CGFloat = k % 2 == 1 ? -1 : 1
                out.append(Berth(id: s.id, point: CGPoint(x: fx - row * dx, y: fy + side * row * dy), unit: unit, cls: cls, parked: false))
            }
        }
        for (k, s) in parked.enumerated() {
            let cls = store.live[s.id]?.snap?.shipClass ?? .frigate
            out.append(Berth(id: s.id, point: CGPoint(x: 120 + CGFloat(k) * 120, y: size.height - 48), unit: unit * 0.7, cls: cls, parked: true))
        }
        return out
    }

    private func draw(_ ctx: GraphicsContext, size: CGSize, time: Double) {
        // the chart: a faint marker wash of night sky, pencil grid, ink stars drifting past
        let r = CGRect(origin: .zero, size: size)
        ctx.marker([CGPoint(x: 0, y: 0), CGPoint(x: size.width, y: 0), CGPoint(x: size.width, y: size.height), CGPoint(x: 0, y: size.height)],
                   Ink.sky, opacity: 0.22, seed: 800, offset: .zero)
        var grid = Path()
        var gx: CGFloat = 0
        while gx < size.width { grid.move(to: CGPoint(x: gx, y: 0)); grid.addLine(to: CGPoint(x: gx, y: size.height)); gx += 80 }
        var gy: CGFloat = 0
        while gy < size.height { grid.move(to: CGPoint(x: 0, y: gy)); grid.addLine(to: CGPoint(x: size.width, y: gy)); gy += 80 }
        ctx.stroke(grid, with: .color(Ink.pencil.opacity(0.25)), lineWidth: 0.5)
        for (i, x) in stride(from: CGFloat(80), to: size.width, by: 160).enumerated() {
            ctx.draw(Text("Σ-\(i + 1)").font(Fonts.mono(9)).foregroundStyle(Ink.pencil), at: CGPoint(x: x + 4, y: 10), anchor: .leading)
        }

        var rng = SeededRNG(2026)
        for layer in 0..<3 {
            let speed = [3.0, 7.0, 14.0][layer]
            let density: CGFloat = [5000, 9000, 16000][layer]
            let count = Int(r.width * r.height / density)
            for _ in 0..<count {
                let x0 = CGFloat(rng.next()) * size.width, y = CGFloat(rng.next()) * size.height
                var x = (x0 - CGFloat(time * speed)).truncatingRemainder(dividingBy: size.width)
                if x < 0 { x += size.width }
                if layer == 2 {
                    let s: CGFloat = 3
                    ctx.ink([CGPoint(x: x - s, y: y), CGPoint(x: x + s, y: y)], width: 0.9, amp: 0, seed: 1)
                    ctx.ink([CGPoint(x: x, y: y - s), CGPoint(x: x, y: y + s)], width: 0.9, amp: 0, seed: 2)
                } else {
                    ctx.dot(CGPoint(x: x, y: y), layer == 0 ? 0.7 : 1.1, Ink.ink.opacity(0.55), ring: nil)
                }
            }
        }
        // a sun and a ringed planet, far behind
        let sun = CGPoint(x: size.width * 0.12, y: size.height * 0.2)
        ctx.marker(Sketch.circle(sun, 26, n: 16), Ink.gold, opacity: 0.85, seed: 810)
        ctx.ink(Sketch.circle(sun, 26, n: 16), closed: true, width: 1.2, seed: 811)
        for k in 0..<10 {
            let a = CGFloat(k) / 10 * 2 * .pi + CGFloat(time * 0.05)
            ctx.ink([CGPoint(x: sun.x + cos(a) * 32, y: sun.y + sin(a) * 32), CGPoint(x: sun.x + cos(a) * 42, y: sun.y + sin(a) * 42)],
                    width: 1, color: Ink.wood, amp: 0, seed: 812)
        }
        let planet = CGPoint(x: size.width * 0.9, y: size.height * 0.78)
        ctx.marker(Sketch.circle(planet, 18, n: 14), Ink.sage, opacity: 0.9, seed: 820)
        ctx.ink(Sketch.circle(planet, 18, n: 14), closed: true, width: 1.1, seed: 821)
        let ring = (0..<20).map { i -> CGPoint in
            let t = CGFloat(i) / 20 * 2 * .pi
            return CGPoint(x: planet.x + cos(t) * 32, y: planet.y + sin(t) * 8 - cos(t) * 4)
        }
        ctx.ink(ring, closed: true, width: 1, color: Ink.ink.opacity(0.8), amp: 0.4, seed: 822)
        // compass rose
        let cr = CGPoint(x: size.width - 46, y: 46)
        ctx.ink([CGPoint(x: cr.x, y: cr.y - 24), CGPoint(x: cr.x, y: cr.y + 24)], width: 1, amp: 0.2, seed: 830)
        ctx.ink([CGPoint(x: cr.x - 24, y: cr.y), CGPoint(x: cr.x + 24, y: cr.y)], width: 1, amp: 0.2, seed: 831)
        ctx.fill(Sketch.poly([CGPoint(x: cr.x + 30, y: cr.y), CGPoint(x: cr.x + 18, y: cr.y - 5), CGPoint(x: cr.x + 18, y: cr.y + 5)]), with: .color(Ink.red))
        ctx.draw(Text("航向").font(Fonts.hand(11)).foregroundStyle(Ink.red), at: CGPoint(x: cr.x, y: cr.y + 34), anchor: .center)

        let berths = layout(size)
        guard !berths.isEmpty else {
            ctx.draw(Text("星图上还没有舰船。点「＋ 新舰船」让第一艘入列。").font(Fonts.hand(20, bold: true)).foregroundStyle(Ink.ink),
                     at: CGPoint(x: size.width / 2, y: size.height / 2), anchor: .center)
            return
        }

        // dock for parked ships
        if berths.contains(where: \.parked) {
            let dock = [CGPoint(x: 30, y: size.height - 22), CGPoint(x: size.width - 30, y: size.height - 22),
                        CGPoint(x: size.width - 30, y: size.height - 12), CGPoint(x: 30, y: size.height - 12)]
            ctx.marker(dock, Ink.tan, opacity: 0.8, seed: 840)
            ctx.hatch(dock, color: Ink.wood.opacity(0.6), gap: 5)
            ctx.ink(dock, closed: true, width: 1.1, seed: 841)
            ctx.draw(Text("空港 · 停泊区（已断开）").font(Fonts.hand(13, bold: true)).foregroundStyle(Ink.wood),
                     at: CGPoint(x: size.width - 36, y: size.height - 32), anchor: .trailing)
        }

        let flagID = berths.first(where: { !$0.parked })?.id
        let flagPt = berths.first(where: { !$0.parked })?.point

        // comms beams to the flagship, with packets moving at a speed set by traffic
        for (k, b) in berths.enumerated() where !b.parked && b.id != flagID {
            guard let f = flagPt, let l = store.live[b.id], l.phase == .online, let s = l.snap else { continue }
            let p0 = bob(b.point, k, time), p1 = bob(f, 0, time)
            ctx.stroke(Sketch.path([p0, p1], amp: 0.6, seed: 900 + UInt64(k), over: 0),
                       with: .color(Ink.pencil.opacity(0.6)), style: StrokeStyle(lineWidth: 0.9, dash: [3, 5]))
            let rate = s.rxRate + s.txRate
            guard rate > 64 else { continue }
            let mag = log10(rate / 1024 + 1)
            let n = min(5, 1 + Int(mag * 1.5))
            for j in 0..<n {
                let frac = CGFloat((time * (0.08 + min(0.6, mag * 0.12)) + Double(j) / Double(n)).truncatingRemainder(dividingBy: 1))
                ctx.dot(CGPoint(x: p0.x + (p1.x - p0.x) * frac, y: p0.y + (p1.y - p0.y) * frac), 2.4, Ink.blue, ring: Ink.ink, ringWidth: 0.6)
            }
        }

        for (k, b) in berths.enumerated() {
            guard let cfg = store.server(b.id) else { continue }
            let l = store.live[b.id] ?? ServerLive()
            let p = b.parked ? b.point : bob(b.point, k, time)
            let load = (l.snap?.cpu ?? 0) / 100
            ShipPainter.draw(ctx, at: p, unit: b.unit, cls: b.cls, hull: Ink.wash(cfg.wash), health: l.health,
                             load: load, time: time, seed: 1000 + UInt64(k) * 97, flagship: b.id == flagID)
            // label below the ship
            let y = p.y + b.unit * b.cls.size * 0.62 + 8
            let role = cfg.active?.privilege.roleName ?? ""
            let cls = (b.id == flagID ? "旗舰 · " : "") + b.cls.name
            ctx.draw(Text(cfg.title).font(Fonts.hand(b.parked ? 13 : 16, bold: true)).foregroundStyle(l.health == .hot ? Ink.red : Ink.ink),
                     at: CGPoint(x: p.x, y: y), anchor: .top)
            if !b.parked {
                ctx.draw(Text("\(cls) · \(role) \(cfg.active?.title ?? "")").font(Fonts.hand(12)).foregroundStyle(Ink.muted),
                         at: CGPoint(x: p.x, y: y + 18), anchor: .top)
                let stats: String
                if let s = l.snap, l.phase == .online {
                    stats = "CPU \(Fmt.pct(s.cpu)) · MEM \(Fmt.pct(s.memFrac * 100))" + (s.gpus.isEmpty ? "" : " · GPU \(Fmt.pct(s.gpuUtil))")
                } else {
                    stats = l.isOffline ? "失联" : "呼叫中…"
                }
                ctx.draw(Text(stats).font(Fonts.mono(10, bold: true)).foregroundStyle(l.isOffline ? Ink.red : Ink.ink),
                         at: CGPoint(x: p.x, y: y + 33), anchor: .top)
            }
        }
    }

    private func bob(_ p: CGPoint, _ k: Int, _ time: Double) -> CGPoint {
        CGPoint(x: p.x + CGFloat(sin(time * 0.5 + Double(k) * 2.1)) * 2,
                y: p.y + CGFloat(sin(time * 0.9 + Double(k) * 1.3)) * 3.5)
    }
}
