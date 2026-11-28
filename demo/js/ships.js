// Starships drawn with the pen, and the star chart that holds the fleet in formation.
import { C, ink, marker, hatch, dot, circlePts, darker, text, polyPath, wash, rng, fitCanvas } from './kit.js';
import { S, liveOf, health, shipClass, title, active, roleName, memFrac, gpuUtil, phaseText } from './state.js';
import * as F from './fmt.js';

export function drawShip(ctx, c, unit, cls, hull, hl, load, time, seed, flagship) {
  const L = unit * cls.size;
  const dead = hl === 'down' || hl === 'parked';
  const tilt = hl === 'down' ? 0.35 : 0;
  const P = (u, v) => [c[0] + (u * Math.cos(tilt) - v * Math.sin(tilt)) * L, c[1] + (u * Math.sin(tilt) + v * Math.cos(tilt)) * L];
  const body = dead ? (hl === 'parked' ? C.steel : C.shade) : hull;
  const l = Math.max(0, Math.min(1, load || 0));
  const vs = cls.engines === 1 ? [0] : cls.engines === 2 ? [-0.1, 0.1] : [-0.14, 0, 0.14];
  if (!dead) {
    const outer = l < 0.6 ? C.sky : l < 0.85 ? C.gold : C.rose;
    vs.forEach((v, k) => {
      const flick = 1 + 0.14 * Math.sin(time * 22 + k * 1.7 + (seed % 7));
      const len = (0.2 + l * 0.85) * flick;
      marker(ctx, [P(-0.66, v - 0.06), P(-0.66 - len, v), P(-0.66, v + 0.06)], outer, { opacity: 0.95, seed: seed + k, off: [0, 0], streaks: false });
      marker(ctx, [P(-0.66, v - 0.025), P(-0.66 - len * 0.5, v), P(-0.66, v + 0.025)], C.cream, { opacity: 1, seed: seed + 20, off: [0, 0], streaks: false });
    });
  }
  if (!dead && (hl === 'hot' || hl === 'warn')) {
    const pulse = hl === 'hot' ? 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(time * 5)) : 0.6;
    ctx.save(); ctx.globalAlpha = pulse;
    ink(ctx, circlePts(c, L * 1.0, 22, L * 0.8), { closed: true, width: 1.6, color: hl === 'hot' ? C.red : C.gold, amp: 0.8, seed: seed + 30, dash: [5, 4] });
    ctx.restore();
  }
  const wingTop = [P(0.15, -0.16), P(-0.28, -0.58), P(-0.52, -0.58), P(-0.42, -0.18)];
  const wingBot = [P(0.15, 0.16), P(-0.28, 0.58), P(-0.52, 0.58), P(-0.42, 0.18)];
  [[wingTop, 1], [wingBot, 2]].forEach(([w, s]) => { marker(ctx, w, darker(body, 0.15), { seed: seed + s }); ink(ctx, w, { closed: true, width: 1.2, seed: seed + s + 40 }); });
  const hullPts = [P(1, 0), P(0.45, -0.19), P(-0.55, -0.23), P(-0.68, -0.13), P(-0.68, 0.13), P(-0.55, 0.23), P(0.45, 0.19)];
  marker(ctx, hullPts, body, { seed: seed + 3 });
  ink(ctx, hullPts, { closed: true, width: 1.5, seed: seed + 4 });
  ink(ctx, [P(0.22, -0.18), P(0.22, 0.18)], { width: 0.8, amp: 0.2, seed: seed + 5 });
  ink(ctx, [P(-0.25, -0.21), P(-0.25, 0.21)], { width: 0.8, amp: 0.2, seed: seed + 6 });
  if (cls.key === 'cruiser' || cls.key === 'carrier') {
    const tower = [P(-0.18, -0.09), P(0.06, -0.09), P(0.06, 0.09), P(-0.18, 0.09)];
    marker(ctx, tower, C.shade, { seed: seed + 7 }); ink(ctx, tower, { closed: true, width: 1, seed: seed + 8 });
  }
  if (cls.key === 'carrier') ink(ctx, [P(-0.5, 0), P(0.15, 0)], { width: 1.6, color: C.red, amp: 0.2, seed: seed + 9 });
  vs.forEach((v) => { polyPath(ctx, [P(-0.68, v - 0.045), P(-0.74, v - 0.05), P(-0.74, v + 0.05), P(-0.68, v + 0.045)]); ctx.fillStyle = C.ink; ctx.fill(); });
  const cock = circlePts(P(0.52, 0), 0.075 * L, 10);
  marker(ctx, cock, dead ? C.shade : C.sky, { opacity: 1, seed: seed + 10, off: [0, 0], streaks: false });
  ink(ctx, cock, { closed: true, width: 1, amp: 0.2, seed: seed + 11 });
  if (flagship && !dead) {
    const mast = P(-0.42, -0.58), top = [mast[0], mast[1] - 0.32 * L];
    ink(ctx, [mast, top], { width: 1.2, amp: 0, seed: seed + 12 });
    const wv = Math.sin(time * 4) * 0.03 * L;
    polyPath(ctx, [top, [top[0] + 0.28 * L, top[1] + 0.07 * L + wv], [top[0], top[1] + 0.14 * L]]); ctx.fillStyle = C.red; ctx.fill();
  }
  if (hl === 'down') text(ctx, 'z z', ...P(0.3, -0.7), { size: 15, bold: true, color: C.pencil, align: 'center' });
}

export function miniShip(cv, sCfg, live, time = 0) {
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  const cls = shipClass(live?.snap);
  const unit = Math.min(w / 2.2, h / 1.6) / cls.size * Math.min(1, cls.size + 0.15);
  drawShip(ctx, [w * 0.56, h * 0.5], unit, cls, wash(sCfg.wash), health(live), (live?.snap?.cpu || 0) / 100, time, 77, false);
}

// ---------- star chart ----------

function flagshipId() {
  const act = S.servers.filter((s) => !s.paused);
  let best = null;
  for (const s of act) if (!best || (liveOf(s.id).snap?.cores || 0) > (liveOf(best.id).snap?.cores || 0)) best = s;
  return best?.id;
}

export function chartLayout(w, h) {
  const flag = flagshipId();
  const act = S.servers.filter((s) => !s.paused);
  const fi = act.findIndex((s) => s.id === flag);
  if (fi > 0) act.unshift(act.splice(fi, 1)[0]);
  const parked = S.servers.filter((s) => s.paused);
  const dockH = parked.length ? 90 : 0;
  const field = { x: 40, y: 70, w: w - 80, h: h - 90 - dockH };
  const unit = Math.max(26, Math.min(44, field.h / 7));
  const out = [];
  const maxRow = Math.max(1, Math.floor(act.length / 2));
  const fx = field.x + field.w * 0.72, fy = field.y + field.h / 2;
  const dx = Math.min(190, (fx - field.x - 60) / maxRow), dy = Math.max(70, Math.min(120, (field.h / 2 - 20) / maxRow));
  act.forEach((s, k) => {
    const cls = shipClass(liveOf(s.id).snap);
    if (k === 0) out.push({ id: s.id, p: [fx, fy], unit, cls, parked: false, side: 1 });
    else { const row = Math.floor((k + 1) / 2), side = k % 2 === 1 ? -1 : 1; out.push({ id: s.id, p: [fx - row * dx, fy + side * row * dy], unit, cls, parked: false, side }); }
  });
  parked.forEach((s, k) => out.push({ id: s.id, p: [120 + k * 120, h - 48], unit: unit * 0.7, cls: shipClass(liveOf(s.id).snap), parked: true, side: 1 }));
  return out;
}

const bob = (p, k, t) => [p[0] + Math.sin(t * 0.5 + k * 2.1) * 2, p[1] + Math.sin(t * 0.9 + k * 1.3) * 3.5];

export function drawChart(cv, time) {
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  marker(ctx, [[0, 0], [w, 0], [w, h], [0, h]], C.sky, { opacity: 0.22, seed: 800, off: [0, 0] });
  ctx.save(); ctx.strokeStyle = 'rgba(127,157,179,.25)'; ctx.lineWidth = 0.5; ctx.beginPath();
  for (let x = 0; x < w; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = 0; y < h; y += 80) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke(); ctx.restore();
  let i = 1;
  for (let x = 80; x < w; x += 160) text(ctx, `Σ-${i++}`, x + 4, 14, { size: 9, font: 'mono', color: C.pencil });

  const r = rng(2026);
  [[3, 5000], [7, 9000], [14, 16000]].forEach(([speed, density], layer) => {
    const n = Math.floor(w * h / density);
    for (let k = 0; k < n; k++) {
      const x0 = r() * w, y = r() * h;
      let x = (x0 - time * speed) % w; if (x < 0) x += w;
      if (layer === 2) { ink(ctx, [[x - 3, y], [x + 3, y]], { width: 0.9, amp: 0, seed: 1, over: 0 }); ink(ctx, [[x, y - 3], [x, y + 3]], { width: 0.9, amp: 0, seed: 2, over: 0 }); }
      else dot(ctx, [x, y], layer === 0 ? 0.7 : 1.1, 'rgba(35,30,22,.55)', null);
    }
  });
  const sun = [w * 0.12, h * 0.2];
  marker(ctx, circlePts(sun, 26, 16), C.gold, { opacity: 0.85, seed: 810 }); ink(ctx, circlePts(sun, 26, 16), { closed: true, width: 1.2, seed: 811 });
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 + time * 0.05; ink(ctx, [[sun[0] + Math.cos(a) * 32, sun[1] + Math.sin(a) * 32], [sun[0] + Math.cos(a) * 42, sun[1] + Math.sin(a) * 42]], { width: 1, color: C.wood, amp: 0, seed: 812, over: 0 }); }
  const pl = [w * 0.9, h * 0.78];
  marker(ctx, circlePts(pl, 18, 14), C.sage, { opacity: 0.9, seed: 820 }); ink(ctx, circlePts(pl, 18, 14), { closed: true, width: 1.1, seed: 821 });
  ink(ctx, Array.from({ length: 20 }, (_, k) => { const t = k / 20 * Math.PI * 2; return [pl[0] + Math.cos(t) * 32, pl[1] + Math.sin(t) * 8 - Math.cos(t) * 4]; }), { closed: true, width: 1, color: 'rgba(35,30,22,.8)', amp: 0.4, seed: 822 });
  const cr = [w - 46, 46];
  ink(ctx, [[cr[0], cr[1] - 24], [cr[0], cr[1] + 24]], { width: 1, amp: 0.2, seed: 830 });
  ink(ctx, [[cr[0] - 24, cr[1]], [cr[0] + 24, cr[1]]], { width: 1, amp: 0.2, seed: 831 });
  polyPath(ctx, [[cr[0] + 30, cr[1]], [cr[0] + 18, cr[1] - 5], [cr[0] + 18, cr[1] + 5]]); ctx.fillStyle = C.red; ctx.fill();
  text(ctx, '航向', cr[0], cr[1] + 38, { size: 12, color: C.red, align: 'center' });

  const berths = chartLayout(w, h);
  if (!berths.length) {
    text(ctx, '星图上还没有舰船。点「＋ 新舰船」让第一艘入列。', w / 2, h / 2, { size: 22, bold: true, align: 'center' });
    return;
  }
  if (berths.some((b) => b.parked)) {
    const dock = [[30, h - 22], [w - 30, h - 22], [w - 30, h - 12], [30, h - 12]];
    marker(ctx, dock, C.tan, { opacity: 0.8, seed: 840 }); hatch(ctx, dock, { color: 'rgba(192,127,63,.6)', gap: 5 }); ink(ctx, dock, { closed: true, width: 1.1, seed: 841 });
    text(ctx, '空港 · 停泊区（已断开）', w - 36, h - 30, { size: 14, bold: true, color: C.wood, align: 'right' });
  }
  const flag = berths.find((b) => !b.parked);
  berths.forEach((b, k) => {
    if (b.parked || b === flag) return;
    const l = liveOf(b.id);
    if (l.phase !== 'online' || !l.snap) return;
    const p0 = bob(b.p, k, time), p1 = bob(flag.p, 0, time);
    ink(ctx, [p0, p1], { width: 0.9, color: 'rgba(127,157,179,.6)', amp: 0.6, seed: 900 + k, over: 0, dash: [3, 5] });
    const rate = l.snap.rxRate + l.snap.txRate;
    if (rate <= 64) return;
    const mag = Math.log10(rate / 1024 + 1), n = Math.min(5, 1 + Math.floor(mag * 1.5));
    for (let j = 0; j < n; j++) {
      const f = ((time * (0.08 + Math.min(0.6, mag * 0.12)) + j / n) % 1);
      dot(ctx, [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f], 2.4, C.blue, C.ink, 0.6);
    }
  });
  berths.forEach((b, k) => {
    const cfg = S.servers.find((s) => s.id === b.id); if (!cfg) return;
    const l = liveOf(b.id), hl = health(l);
    const p = b.parked ? b.p : bob(b.p, k, time);
    drawShip(ctx, p, b.unit, b.cls, wash(cfg.wash), hl, (l.snap?.cpu || 0) / 100, time, 1000 + k * 97, b === flag);
    const reach = b.unit * b.cls.size * 0.62;
    // upper-wing ships carry their labels above, everyone else below, so neighbours never collide
    const above = b.side === -1 && !b.parked;
    const y = above ? p[1] - reach - 44 : p[1] + reach + 20;
    text(ctx, title(cfg), p[0], y, { size: b.parked ? 13 : 17, bold: true, color: hl === 'hot' ? C.red : C.ink, align: 'center', raw: true });
    if (b.parked) return;
    const a = active(cfg);
    text(ctx, `${b === flag ? '旗舰 · ' : ''}${b.cls.name} · ${roleName(a?.privilege || 'unknown')} ${a?.user || ''}`, p[0], y + 16, { size: 13, color: C.muted, align: 'center' });
    const s = l.snap;
    const stats = s && l.phase === 'online'
      ? `CPU ${F.pct(s.cpu)} · MEM ${F.pct(memFrac(s) * 100)}${s.gpus.length ? ' · GPU ' + F.pct(gpuUtil(s)) : ''}`
      : l.phase === 'offline' ? '失联' : '呼叫中…';
    text(ctx, stats, p[0], y + 31, { size: 11, font: 'mono', bold: true, color: l.phase === 'offline' ? C.red : C.ink, align: 'center' });
  });
}

export function chartHit(cv, x, y) {
  const r = cv.getBoundingClientRect();
  let best = null, bd = Infinity;
  for (const b of chartLayout(r.width, r.height)) {
    const d = Math.hypot(b.p[0] - x, b.p[1] - y);
    if (d < bd) { bd = d; best = b; }
  }
  return best && bd < best.unit * best.cls.size * 1.1 ? best.id : null;
}

export { phaseText };
