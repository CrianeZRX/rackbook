// The server is the ship; its GPUs are its engines, and its users are the little craft in orbit round it.
// Same pen as the rest of the app (kit.js).
//
// An engine reads at a glance: the plume's length is utilisation, the nozzle's colour is temperature
// (cool → gold → rose), the tank's sight glass shows memory in use, the turbopump spins with the fan.
import { C, ink, marker, hatch, dot, circlePts, text, polyPath, darker, lighter, alpha, mix, rng, fitCanvas } from './kit.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const heatColor = (t) => (t == null ? C.sky : t < 60 ? C.sky : t < 75 ? mix(C.sky, C.gold, (t - 60) / 15) : t < 85 ? mix(C.gold, C.rose, (t - 75) / 10) : C.rose);

// a fixed starfield per canvas size and seed
export function stars(ctx, w, h, seed = 7, n = 40, color = C.pencil) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, s = r();
    ctx.globalAlpha = 0.35 + 0.5 * s;
    if (s > 0.86) {
      ink(ctx, [[x - 3, y], [x + 3, y]], { width: 0.9, color, amp: 0.2, seed: i });
      ink(ctx, [[x, y - 3], [x, y + 3]], { width: 0.9, color, amp: 0.2, seed: i + 50 });
    } else {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, 0.6 + s, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * One GPU as one of the ship's engines (the server is the ship). (cx, top) is the top of the propellant tank,
 * h the height down to the nozzle exit. The plume's length is utilisation, the tank's level is memory in use,
 * the nozzle glows with temperature, and the turbopump spins with the fan (or with load when there's no fan reading).
 * g: { util, memUsed, memTotal, temp, fan, index }
 */
export function engine(ctx, cx, top, h, g, time = 0, seed = 3, { label = true } = {}) {
  const u = clamp((g.util || 0) / 100);
  const fuel = g.memTotal > 0 ? clamp(g.memUsed / g.memTotal) : 0;
  const heat = heatColor(g.temp);
  const W = h * 0.6;
  const tankB = top + h * 0.36, pumpY = top + h * 0.47, chamT = top + h * 0.56, throat = top + h * 0.68, exit = top + h;
  // plume
  if (u > 0.01) {
    const flick = 1 + 0.12 * Math.sin(time * 19 + seed) + 0.06 * Math.sin(time * 41 + seed * 2);
    const len = h * (0.1 + 0.75 * u) * flick, fw = W * 0.42;
    marker(ctx, [[cx - fw, exit - 1], [cx - fw * 0.75, exit + len * 0.5], [cx, exit + len], [cx + fw * 0.75, exit + len * 0.5], [cx + fw, exit - 1]], heat, { opacity: 0.9, seed, off: [0, 0], streaks: false });
    marker(ctx, [[cx - fw * 0.45, exit], [cx, exit + len * 0.6], [cx + fw * 0.45, exit]], C.cream, { opacity: 1, seed: seed + 1, off: [0, 0], streaks: false });
    // shock diamonds in a hard-burning plume
    if (u > 0.55) for (let k = 1; k <= 3; k++) { const y = exit + (len * k) / 4.2; ctx.globalAlpha = 0.6; ink(ctx, [[cx - 4, y], [cx, y - 4], [cx + 4, y], [cx, y + 4]], { closed: true, width: 1, color: C.wood, amp: 0.2, seed: seed + k }); ctx.globalAlpha = 1; }
  }
  // propellant tank: a capsule with a sight glass showing memory in use
  const tL = cx - W * 0.42, tR = cx + W * 0.42, cap = W * 0.2;
  const tank = [[tL, top + cap], [cx - W * 0.3, top + cap * 0.15], [cx, top], [cx + W * 0.3, top + cap * 0.15], [tR, top + cap], [tR, tankB - cap], [cx + W * 0.3, tankB - cap * 0.15], [cx, tankB], [cx - W * 0.3, tankB - cap * 0.15], [tL, tankB - cap]];
  marker(ctx, tank, C.cream, { seed: seed + 2 });
  const gx0 = cx - W * 0.12, gx1 = cx + W * 0.12, gy0 = top + cap * 0.9, gy1 = tankB - cap * 0.9;
  const lvl = gy1 - (gy1 - gy0) * fuel;
  if (fuel > 0) marker(ctx, [[gx0, lvl], [gx1, lvl], [gx1, gy1], [gx0, gy1]], fuel > 0.9 ? C.rose : C.blue, { opacity: 0.85, seed: seed + 3, off: [0, 0] });
  ink(ctx, [[gx0, gy0], [gx1, gy0], [gx1, gy1], [gx0, gy1]], { closed: true, width: 1, amp: 0.3, seed: seed + 4 });
  for (let k = 1; k < 4; k++) { const y = gy0 + ((gy1 - gy0) * k) / 4; ink(ctx, [[gx1, y], [gx1 + 4, y]], { width: 0.8, amp: 0.1, seed: seed + 20 + k }); }
  ink(ctx, tank, { closed: true, width: 1.5, seed: seed + 5 });
  ink(ctx, [[tL, top + (tankB - top) * 0.5], [gx0, top + (tankB - top) * 0.5]], { width: 0.7, color: C.muted, amp: 0.2, seed: seed + 6 });
  // feed lines down to the turbopump
  ink(ctx, [[cx - W * 0.2, tankB - 2], [cx - W * 0.2, pumpY], [cx - W * 0.1, pumpY]], { width: 2, color: C.wood, seed: seed + 7 });
  ink(ctx, [[cx + W * 0.2, tankB - 2], [cx + W * 0.2, chamT], [cx + W * 0.13, chamT + 3]], { width: 2, color: C.blue, seed: seed + 8 });
  // turbopump: spins with the fan reading, or with load
  const pr = W * 0.13, spin = (g.fan != null ? g.fan / 100 : u) * 9 + 0.4;
  dot(ctx, [cx - W * 0.02, pumpY], pr, C.steel, C.ink, 1.2);
  for (let k = 0; k < 4; k++) {
    const a = time * spin + (k * Math.PI) / 2;
    ink(ctx, [[cx - W * 0.02, pumpY], [cx - W * 0.02 + Math.cos(a) * pr * 0.85, pumpY + Math.sin(a) * pr * 0.85]], { width: 1.1, amp: 0, seed: seed + 30 + k });
  }
  // combustion chamber
  const ch = [[cx - W * 0.17, chamT], [cx + W * 0.17, chamT], [cx + W * 0.17, throat - h * 0.04], [cx + W * 0.08, throat], [cx - W * 0.08, throat], [cx - W * 0.17, throat - h * 0.04]];
  marker(ctx, ch, C.steel, { seed: seed + 9 }); ink(ctx, ch, { closed: true, width: 1.4, seed: seed + 10 });
  // nozzle bell, glowing with heat; regenerative cooling tubes drawn as ribs
  const bell = [[cx - W * 0.08, throat], [cx + W * 0.08, throat], [cx + W * 0.26, throat + (exit - throat) * 0.45], [cx + W * 0.42, exit], [cx - W * 0.42, exit], [cx - W * 0.26, throat + (exit - throat) * 0.45]];
  marker(ctx, bell, g.temp != null && g.temp >= 60 ? mix(C.steel, heat, clamp((g.temp - 55) / 35) * 0.85) : C.steel, { seed: seed + 11 });
  for (let k = -2; k <= 2; k++) ink(ctx, [[cx + k * W * 0.03, throat + 2], [cx + k * W * 0.15, exit - 2]], { width: 0.6, color: alpha(C.ink, 0.5), amp: 0.2, seed: seed + 40 + k });
  ink(ctx, bell, { closed: true, width: 1.5, seed: seed + 12 });
  // heat haze off a hot nozzle
  if (g.temp != null && g.temp >= 80) {
    ctx.globalAlpha = 0.55;
    for (let k = 0; k < 2; k++) { const x = cx + (k ? 1 : -1) * W * 0.5, y0 = exit - ((time * 16 + k * 7) % 14); ink(ctx, [[x, y0], [x + 3, y0 - 5], [x - 2, y0 - 10], [x + 2, y0 - 15]], { width: 1.1, color: C.rose, amp: 0.4, seed: seed + 60 + k }); }
    ctx.globalAlpha = 1;
  }
  if (label) text(ctx, String(g.index ?? ''), tL + 4, top + cap + 12, { size: Math.max(10, W * 0.2), bold: true, font: 'mono', color: C.red, raw: true });
}

/** A small card scene: a few stars and the engine (numbers are in HTML under it). */
export function gpuCardScene(cv, g, time) {
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  stars(ctx, w, h, 11 + (g.index || 0) * 7, 18);
  engine(ctx, w / 2, h * 0.04, h * 0.52, g, time, 5 + (g.index || 0) * 13);
}

/** The detail scene: the engine hung in a test stand, firing; a starfield and a planet's rim beyond. */
export function gpuDetailScene(cv, g, time) {
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  stars(ctx, w, h, 101 + (g.index || 0), 60);
  const pc = [w * 0.97, h * 1.42];
  marker(ctx, circlePts(pc, h * 0.6, 40), C.sage, { opacity: 0.45, seed: 81, streaks: false });
  hatch(ctx, circlePts(pc, h * 0.6, 40), { color: alpha(C.ok, 0.22), gap: 7 });
  ink(ctx, circlePts(pc, h * 0.6, 40), { closed: true, width: 1.3, seed: 82 });
  // the test stand: two legs and a cross beam holding the engine by its tank
  const top = h * 0.07, eh = h * 0.47, cx = w / 2, half = eh * 0.42;
  const beamY = top + eh * 0.18;
  for (const s of [-1, 1]) {
    ink(ctx, [[cx + s * half, beamY], [cx + s * half * 1.25, h * 0.93]], { width: 2, seed: 90 + s });
    for (let y = beamY + 18; y < h * 0.9; y += 18) { const f = (y - beamY) / (h * 0.93 - beamY); ink(ctx, [[cx + s * half * (1 + 0.25 * f), y], [cx + s * half * (1 + 0.25 * f) + s * 10, y + 9]], { width: 0.8, color: C.muted, seed: 95 + y + s }); }
  }
  ink(ctx, [[cx - half - 6, beamY], [cx + half + 6, beamY]], { width: 2.4, seed: 99 });
  ink(ctx, [[w * 0.12, h * 0.93], [w * 0.88, h * 0.93]], { width: 2, seed: 97 });
  hatch(ctx, [[w * 0.12, h * 0.93], [w * 0.88, h * 0.93], [w * 0.88, h], [w * 0.12, h]], { color: C.muted, gap: 6 });
  engine(ctx, cx, top, eh, g, time, 31 + (g.index || 0));
}

/**
 * Users in orbit round the server. Each user is a little ship: its size follows memory, its exhaust and speed follow
 * CPU. users: [{ user, cpu (0-100 of machine), cores, rss, procs }], colours: user -> colour.
 * Returns hit areas [{ user, x, y, r }] for tooltips.
 */
export function orbitScene(cv, users, colours, time, { center = 'SERVER', memTotal = 0 } = {}) {
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  stars(ctx, w, h, 404, 60);
  const c = [w * 0.5, h * 0.5];
  const RX = w * 0.46, RY = h * 0.42;
  const R0 = Math.min(RX, RY / 0.62);
  // the planet: the server itself
  const pr = Math.max(16, Math.min(RY * 0.28, 30));
  marker(ctx, circlePts(c, pr, 30), C.tan, { seed: 7, streaks: false });
  hatch(ctx, circlePts(c, pr, 30), { color: alpha(C.wood, 0.5), gap: 6 });
  ink(ctx, circlePts(c, pr, 30), { closed: true, width: 1.6, seed: 8 });
  ink(ctx, circlePts(c, pr * 1.5, 34, pr * 0.42), { closed: true, width: 1, color: C.wood, seed: 9, amp: 0.4 });
  text(ctx, center, c[0], c[1] + pr + 16, { size: 12, bold: true, align: 'center', font: 'mono', raw: true });
  const shown = users.slice(0, 10);
  const hits = [];
  const maxRss = Math.max(1, ...shown.map((u) => u.rss));
  shown.forEach((u, i) => {
    // rings spread over the whole canvas: wide ellipses, so labels have room
    const f = (i + 0.6) / Math.max(1, shown.length);
    const ring = pr * 2.2 + (RX - pr * 2.2) * f;
    const ry = pr * 1.5 + (RY - pr * 1.5) * f;
    void R0;
    ink(ctx, circlePts(c, ring, 48, ry), { closed: true, width: 0.7, color: alpha(C.pencil, 0.7), seed: 30 + i, amp: 0.3, dash: [3, 5] });
    // angular speed: a gentle drift at idle, faster with CPU
    const speed = 0.08 + 0.9 * clamp(u.cpu / 50);
    const a = (time * speed + i * 2.399) % (Math.PI * 2);
    const p = [c[0] + Math.cos(a) * ring, c[1] + Math.sin(a) * ry];
    const size = 9 + 17 * Math.sqrt(u.rss / maxRss);
    const col = colours[u.user] || C.sky;
    // heading along the orbit
    const dir = Math.atan2(Math.cos(a) * ry, -Math.sin(a) * ring);
    const P = (x, y) => [p[0] + (x * Math.cos(dir) - y * Math.sin(dir)) * size, p[1] + (x * Math.sin(dir) + y * Math.cos(dir)) * size];
    const load = clamp(u.cpu / 40);
    if (load > 0.02) {
      const len = 0.4 + 2.2 * load * (1 + 0.15 * Math.sin(time * 20 + i));
      marker(ctx, [P(-0.8, -0.28), P(-0.8 - len, 0), P(-0.8, 0.28)], load > 0.7 ? C.rose : load > 0.35 ? C.gold : C.sky, { opacity: 0.95, seed: 50 + i, off: [0, 0], streaks: false });
    }
    const hull = [P(1, 0), P(0.2, -0.45), P(-0.8, -0.5), P(-0.8, 0.5), P(0.2, 0.45)];
    marker(ctx, hull, col, { seed: 60 + i });
    ink(ctx, hull, { closed: true, width: 1.3, seed: 70 + i });
    dot(ctx, P(0.35, 0), size * 0.16, C.cream, C.ink, 0.8);
    text(ctx, u.user, p[0], p[1] - size - 6, { size: 13, bold: true, align: 'center', raw: true });
    text(ctx, `${u.cores >= 0.995 ? u.cores.toFixed(1) + ' 核' : Math.round(u.cpu * 10) / 10 + '%'}`, p[0], p[1] + size + 14, { size: 11, align: 'center', font: 'mono', color: C.muted });
    hits.push({ user: u.user, x: p[0], y: p[1], r: size + 8 });
  });
  if (!shown.length) text(ctx, '正在清点乘员…', c[0], c[1] + pr + 34, { size: 16, align: 'center', color: C.muted });
  void memTotal; void darker; void lighter; void polyPath;
  return hits;
}

/** Stacked CPU per user over time (cores), newest on the right. hist: [{ user: cores }], order: users bottom→top. */
export function userStream(cv, hist, order, colours, cores) {
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  const plot = { x: 40, y: 6, w: w - 46, h: h - 24 };
  // scale to the busiest moment on screen (not the whole machine), capped at the core count
  const peak = Math.max(0, ...hist.map((m) => Object.values(m).reduce((a, b) => a + b, 0)));
  const nice = (v) => { const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; };
  const ymax = Math.min(Math.max(1, cores || 1), Math.max(1, nice(peak * 1.25 || 1)));
  for (let k = 0; k <= 2; k++) {
    const y = plot.y + plot.h - (plot.h * k) / 2;
    ink(ctx, [[plot.x, y], [plot.x + plot.w, y]], { width: 0.6, color: alpha(C.pencil, 0.6), amp: 0.3, seed: k + 3, over: 0 });
    text(ctx, `${Math.round((ymax * k) / 2)}`, plot.x - 6, y + 3, { size: 9, font: 'mono', color: C.muted, align: 'right' });
  }
  text(ctx, '核', plot.x - 30, plot.y + 10, { size: 10, color: C.muted });
  ink(ctx, [[plot.x, plot.y], [plot.x, plot.y + plot.h], [plot.x + plot.w, plot.y + plot.h]], { width: 1.2, seed: 2 });
  if (hist.length < 2) { text(ctx, '正在攒数据…', plot.x + plot.w / 2, plot.y + plot.h / 2, { size: 14, align: 'center', color: C.muted }); return; }
  const step = plot.w / 149;
  const x0 = plot.x + plot.w - step * (hist.length - 1);
  const base = hist.map(() => 0);
  for (const user of order) {
    const top = hist.map((m, i) => base[i] + (m[user] || 0));
    const pts = top.map((v, i) => [x0 + step * i, plot.y + plot.h - plot.h * clamp(v / ymax)]);
    const bot = base.map((v, i) => [x0 + step * i, plot.y + plot.h - plot.h * clamp(v / ymax)]).reverse();
    ctx.beginPath(); [...pts, ...bot].forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
    ctx.fillStyle = alpha(colours[user] || C.sky, 0.75); ctx.fill();
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.strokeStyle = darker(colours[user] || C.sky, 0.45); ctx.lineWidth = 1.2; ctx.stroke();
    top.forEach((v, i) => (base[i] = v));
  }
}
