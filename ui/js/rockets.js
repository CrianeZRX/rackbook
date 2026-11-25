// The server is the ship; its GPUs are its engines, and its users are the little craft in orbit round it.
// Same pen as the rest of the app (kit.js).
//
// An engine reads at a glance: the plume's length is utilisation, the nozzle's colour is temperature
// (cool → gold → rose), the tank's sight glass shows memory in use, the turbopump spins with the fan.
import { C, ink, marker, hatch, dot, circlePts, text, darker, alpha, mix, rng, fitCanvas } from './kit.js';

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

/** An astronaut in an open rocket, drawn with the same ink and washes as the fleet. */
function astronaut(ctx, x, y, size, { colour, captain = false, plume = 0, angle = 0, standing = false }) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(size / 72, size / 72);
  const paint = (points, fill, seed) => {
    marker(ctx, points, fill, { seed, off: [0.7, 0.7] });
    ink(ctx, points, { closed: true, amp: 0.55, width: 1.6, seed, over: 0 });
  };
  if (standing) {
    // Boots, gloves and the rounded life-support pack are kept readable at the smallest zoom.
    paint([[-17, -6], [17, -6], [19, 15], [11, 20], [-11, 20], [-19, 15]], C.steel, 18);
    paint([[-11, 14], [-2, 15], [-3, 30], [-15, 30], [-14, 24]], colour, 31);
    paint([[2, 15], [11, 14], [14, 24], [15, 30], [3, 30]], colour, 32);
    paint([[-14, -3], [-21, 4], [-23, 17], [-18, 20], [-12, 11]], C.cream, 33);
    paint([[14, -3], [21, 3], [23, 14], [19, 18], [13, 12]], C.cream, 34);
    paint([[-13, -5], [13, -5], [14, 11], [9, 20], [-9, 20], [-14, 11]], colour, 35);
    ink(ctx, [[-10, 15], [10, 15]], { width: 1.1, seed: 36, over: 0 });
  } else {
    if (plume > 0) {
      marker(ctx, [[-9, 22], [-6, 29], [0, 28 + plume], [7, 29], [9, 21]], C.gold, { seed: 17, off: [0, 0] });
      ink(ctx, [[-6, 25], [0, 24 + plume * 0.65], [4, 25]], { color: C.rose, width: 1.5, seed: 18, over: 0 });
    }
    paint([[-14, 4], [-25, 19], [-24, 25], [-11, 19], [11, 19], [24, 25], [25, 19], [14, 4]], colour, 19);
    paint([[-9, 15], [9, 15], [11, 23], [-11, 23]], C.steel, 20);
    paint([[-18, 0], [-13, -9], [13, -9], [18, 0], [15, 11], [9, 18], [-9, 18], [-15, 11]], colour, 21);
    ink(ctx, [[-16, 3], [-8, 6], [8, 6], [16, 3]], { seed: 22, width: 1.1, over: 0 });
  }
  paint(circlePts([0, -15], 15, 23), C.cream, 23);
  paint(circlePts([1, -15], 10.5, 20, 8.5), captain ? C.tan : C.sky, 24);
  ink(ctx, [[-5, -14], [-3, -18], [1, -20]], { color: C.cream, width: 1.7, seed: 15, over: 0 });
  dot(ctx, [-1, -14], 1, C.ink, null);
  dot(ctx, [6, -14], 1, C.ink, null);
  ink(ctx, [[1, -10], [3, -8.5], [6, -10]], { width: 1, seed: 27, over: 0 });
  if (captain) {
    paint(Array.from({ length: 10 }, (_, i) => {
      const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 3 : 6;
      return [Math.cos(a) * r, 12 + Math.sin(a) * r];
    }), C.gold, 25);
  } else {
    ink(ctx, [[-4, 12], [4, 12]], { color: C.cream, width: 1.6, seed: 26, over: 0 });
  }
  ctx.restore();
}

const portraits = new Map();
export function crewPortrait(status, captain) {
  const key = `${status}:${captain}`;
  if (!portraits.has(key)) {
    const cv = document.createElement('canvas');
    cv.width = 224; cv.height = 196;
    const ctx = cv.getContext('2d');
    ctx.scale(2, 2);
    const ground = circlePts([56, 89], 34, 22, 6);
    marker(ctx, ground, C.steel, { opacity: 0.35, seed: 70, streaks: false });
    const colour = ({ online: C.sage, offline: C.sky, inactive: C.steel, unknown: C.shade })[status];
    astronaut(ctx, 56, 47, 94, {
      colour: captain && status !== 'inactive' ? C.rose : colour, captain, standing: true,
    });
    portraits.set(key, cv.toDataURL());
  }
  return portraits.get(key);
}

/** The cockpit and crew quarters share the same hull, with instruments or portholes in the bulkhead. */
export function drawCrewCabin(cv, command) {
  const { ctx, w, h } = fitCanvas(cv);
  if (w < 24 || !h) return;
  ctx.clearRect(0, 0, w, h);
  const floor = h - 8;
  const beam = [[1, floor - 3], [14, 22], [27, 9], [w - 27, 9], [w - 14, 22], [w - 1, floor - 3]];
  ink(ctx, beam, { width: 1.25, color: C.pencil, seed: 90, over: 0 });
  ink(ctx, [[1, floor], [w - 1, floor]], { width: 1.4, color: C.shadow, seed: 91, over: 0 });
  const centres = w > 420 ? [w * 0.19, w * 0.5, w * 0.81] : [w * 0.27, w * 0.73];
  centres.forEach((x, i) => {
    const y = (floor + 9) / 2, r = Math.min(34, w / 9);
    const window = circlePts([x, y], r, 30, 17);
    marker(ctx, window, C.sky, { seed: i + 15, opacity: 0.6 });
    ctx.save();
    ctx.translate(x - r, y - 17);
    ctx.beginPath(); ctx.ellipse(r, 17, r - 1, 16, 0, 0, Math.PI * 2); ctx.clip();
    stars(ctx, r * 2, 34, 2 + i, 9, C.shadow);
    if (i % 2 === 0) dot(ctx, [r * 1.22, 23], 8, C.tan, C.wood, 0.8);
    ctx.restore();
    ink(ctx, window, { closed: true, width: 1.3, seed: i + 18, over: 0 });
  });
  if (command && w > 240) {
    const x = w / 2, y = floor;
    const panel = [[x - 52, y + 3], [x - 40, y - 16], [x + 40, y - 16], [x + 52, y + 3]];
    marker(ctx, panel, C.tan, { seed: 27 });
    ink(ctx, panel, { width: 1.5, closed: true, over: 0, seed: 28 });
    [C.sage, C.gold, C.rose].forEach((fill, i) => dot(ctx, [x + 12 * (i - 1), y - 7], 2.4, fill));
  }
}

/** The busiest users' astronaut rockets orbit the server. Size is memory, thrust and speed are CPU. */
export function orbitScene(cv, users, colours, time, { center = 'SERVER', current = '', captains = new Set() } = {}) {
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  stars(ctx, w, h, 404, 60);
  const c = [w * 0.5, h * 0.5];
  const RX = w * 0.39, RY = h * 0.34;
  // the planet: the server itself
  const pr = Math.max(16, Math.min(RY * 0.28, 30));
  marker(ctx, circlePts(c, pr, 30), C.tan, { seed: 7, streaks: false });
  hatch(ctx, circlePts(c, pr, 30), { color: alpha(C.wood, 0.5), gap: 6 });
  ink(ctx, circlePts(c, pr, 30), { closed: true, width: 1.6, seed: 8 });
  ink(ctx, circlePts(c, pr * 1.5, 34, pr * 0.42), { closed: true, width: 1, color: C.wood, seed: 9, amp: 0.4 });
  text(ctx, center, c[0], c[1] + pr + 16, { size: 12, bold: true, align: 'center', font: 'mono', raw: true });
  const maxRss = Math.max(1, ...users.map((u) => u.rss));
  users.forEach((u, i) => {
    // rings spread over the whole canvas: wide ellipses, so labels have room
    const f = (i + 0.6) / users.length;
    const ring = pr * 2.2 + (RX - pr * 2.2) * f;
    const ry = pr * 1.5 + (RY - pr * 1.5) * f;
    ink(ctx, circlePts(c, ring, 48, ry), { closed: true, width: 0.7, color: alpha(C.pencil, 0.7), seed: 30 + i, amp: 0.3, dash: [3, 5] });
    // angular speed: a gentle drift at idle, faster with CPU
    const speed = 0.08 + 0.9 * clamp(u.cpu / 50);
    const a = (time * speed + i * 2.399) % (Math.PI * 2);
    const p = [c[0] + Math.cos(a) * ring, c[1] + Math.sin(a) * ry];
    const size = 27 + 34 * Math.sqrt(u.rss / maxRss);
    const col = colours[u.user] || C.sky;
    const dir = Math.atan2(Math.cos(a) * ry, -Math.sin(a) * ring);
    const load = clamp(u.cpu / 40);
    if (u.user === current) {
      ink(ctx, circlePts(p, size / 2 + 2), { closed: true, color: C.wood, width: 1.5, dash: [4, 3], seed: 19 });
    }
    astronaut(ctx, ...p, size, {
      colour: col, captain: captains.has(u.user), angle: dir + Math.PI / 2,
      plume: load > 0.02 ? 28 * load * (1 + 0.15 * Math.sin(time * 20 + i)) : 0,
    });
    const label = u.user.length > 14 ? u.user.slice(0, 13) + '…' : u.user;
    const lx = clamp(p[0], 44, w - 44);
    text(ctx, label, lx, p[1] - size / 2 - 5, { size: 13, bold: true, align: 'center', raw: true });
  });
  if (!users.length) text(ctx, '正在清点乘员…', c[0], c[1] + pr + 34, { size: 16, align: 'center', color: C.muted });
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
