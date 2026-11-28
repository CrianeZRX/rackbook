// The hero: an isometric server, drawn in ink and marker, that comes apart.
// Every number on it, the fans' spin and the packets on the cable come from the same snapshot.
import { C, Iso, box3, moved, isoBox, ink, marker, hatch, dot, circlePts, polyPath, text, measure, loadColor, lighter, darker, pointInPoly, fitCanvas, alpha } from './kit.js';
import { memFrac, worstDisk, mountFrac, gpuUtil, loadText } from './state.js';
import * as F from './fmt.js';

export const SUBS = [
  ['cpu', '处理器', 'CPU'], ['mem', '内存', 'Memory'], ['gpu', '显卡', 'GPU'], ['net', '网络', 'Network'], ['disk', '磁盘', 'Storage'],
];

export function sentence(sub, s) {
  if (!s) return '还没有数据：等这艘船接通再看。';
  switch (sub) {
    case 'cpu': return `处理器：${s.cores} 核，此刻占用 ${F.pct(s.cpu)}，1 分钟负载 ${F.num(s.load[0] || 0)}。`;
    case 'mem': return `内存：用了 ${F.bytes(s.memUsed)} / ${F.bytes(s.memTotal)}，另有 ${F.bytes(s.memCache)} 是可回收的缓存。`;
    case 'gpu': return s.gpus.length ? `显卡：${s.gpus.length} 块，平均占用 ${F.pct(gpuUtil(s))}。` : '显卡：这艘船上没检测到显卡（没有 nvidia-smi，也没有 amdgpu）。';
    case 'net': return `网络：下行 ${F.rate(s.rxRate)}，上行 ${F.rate(s.txRate)}，${s.tcp} 个已建立的 TCP 连接。`;
    case 'disk': { const w = worstDisk(s); return `磁盘：读 ${F.rate(s.ioRead)}，写 ${F.rate(s.ioWrite)}` + (w ? `；最满的是 ${w.mount}，已用 ${F.pct(mountFrac(w) * 100)}。` : '。'); }
  }
  return '';
}

function parts(e) {
  const H = 52, nearH = H * (1 - e) + 12 * e;
  const p = [
    { k: 'floor', b: box3(0, 0, 0, 300, 180, 4), seed: 101 },
    { k: 'wall', b: box3(0, 0, 4, 4, 180, H - 4), seed: 102 },
    { k: 'wall', b: box3(4, 0, 4, 296, 4, H - 4), seed: 103 },
    { k: 'front', b: box3(296, 4, 4, 4, 176, nearH - 4), seed: 104 },
    { k: 'wall', b: box3(4, 176, 4, 292, 4, nearH - 4), seed: 105 },
    { k: 'mobo', b: moved(box3(78, 14, 4, 106, 152, 3), 0, 0, 14 * e), seed: 106 },
    { k: 'cooler', b: moved(box3(95, 62, 7, 56, 56, 30), 0, 0, 76 * e), sub: 'cpu', seed: 107 },
    { k: 'ram', b: moved(box3(80, 30, 7, 90, 24, 24), 0, 0, 46 * e), sub: 'mem', seed: 108 },
    { k: 'ram', b: moved(box3(80, 126, 7, 90, 24, 24), 0, 0, 46 * e), sub: 'mem', seed: 109 },
    { k: 'fans', b: moved(box3(192, 14, 4, 16, 152, 40), 0, 0, 26 * e), sub: 'cpu', seed: 110 },
    { k: 'gpu', b: moved(box3(44, 16, 6, 28, 86, 22), 0, 0, 64 * e), sub: 'gpu', seed: 113 },
    { k: 'nic', b: moved(box3(6, 20, 8, 34, 64, 16), -78 * e, 0, 24 * e), sub: 'net', seed: 111 },
    { k: 'psu', b: moved(box3(6, 108, 5, 66, 58, 36), -70 * e, 0, 8 * e), seed: 112 },
  ];
  for (let i = 0; i < 4; i++) p.push({ k: 'disk', i, b: moved(box3(238, 12 + i * 40, 5, 56, 36, 34), (62 + i * 10) * e, 0, 6 * e), sub: 'disk', seed: 120 + i });
  return p;
}

function bounds(pts) { let a = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of pts) { a = [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])]; } return a; }
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const behind = (a, b) => a.x + a.w <= b.x + 0.01 || a.y + a.d <= b.y + 0.01 || a.z + a.h <= b.z + 0.01;

function order(ps, iso) {
  const n = ps.length, rects = ps.map((p) => bounds(iso.outline(p.b)));
  const before = ps.map(() => new Set());
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j || !overlap(rects[i], rects[j])) continue;
    if (behind(ps[i].b, ps[j].b) && !behind(ps[j].b, ps[i].b)) before[j].add(i);
  }
  const key = ps.map((p) => p.b.x + p.b.w / 2 + p.b.y + p.b.d / 2 + p.b.z);
  const done = new Set(), out = [];
  while (out.length < n) {
    const open = [...Array(n).keys()].filter((i) => !done.has(i));
    const ready = open.filter((i) => [...before[i]].every((x) => done.has(x)));
    const pool = ready.length ? ready : open;
    const pick = pool.reduce((a, b) => (key[b] < key[a] ? b : a));
    done.add(pick); out.push(pick);
  }
  return out;
}

export class Teardown {
  constructor(cv) { this.cv = cv; this.from = 1; this.to = 1; this.start = 0; this.focus = 'cpu'; this.snap = null; this.hl = 'unknown'; }
  setExploded(on) { const now = performance.now(); this.from = this.e(now); this.to = on ? 1 : 0; this.start = now; }
  e(now) {
    const k = Math.min(1, Math.max(0, (now - this.start) / 900));
    const ease = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    return this.from + (this.to - this.from) * ease;
  }
  iso(w, h) { const s = Math.max(0.35, Math.min((w - 340) / 540, (h - 30) / 470)); return new Iso(w / 2 - 52 * s, h / 2 - 38 * s, s); }

  draw(now) {
    const { ctx, w, h } = fitCanvas(this.cv);
    ctx.clearRect(0, 0, w, h);
    const e = this.e(now), time = now / 1000, iso = this.iso(w, h);
    const down = this.hl === 'down' || this.hl === 'parked';
    const s = down ? null : this.snap;
    const color = (c) => (down ? C.shade : c);
    const cpu = s?.cpu || 0;

    const sh = [iso.p(0, 0, 0), iso.p(300, 0, 0), iso.p(300, 180, 0), iso.p(0, 180, 0)].map((p) => [p[0] + 12, p[1] + 14]);
    polyPath(ctx, sh); ctx.fillStyle = alpha(C.shadow, 0.12); ctx.fill();
    hatch(ctx, sh, { color: alpha(C.shadow, 0.3), gap: 6 });

    const ps = parts(e);
    for (const i of order(ps, iso)) this.part(ctx, iso, ps[i], { e, time, s, down, color, cpu });
    const nic = ps.find((p) => p.k === 'nic');
    this.cable(ctx, iso, nic.b, time, s, down);
    this.lid(ctx, iso, e, color);
    this.callouts(ctx, iso, ps, w, h, s, down, cpu);
    if (down) text(ctx, this.hl === 'parked' ? '停泊 · 已主动断开连接' : '失联 · 这艘船此刻联系不上', ...iso.p(150, 90, 120), { size: 22, bold: true, color: C.red, align: 'center' });
  }

  part(ctx, iso, p, { e, time, s, down, color, cpu }) {
    const b = p.b, lit = p.sub && p.sub === this.focus && !down, topZ = b.z + b.h;
    switch (p.k) {
      case 'floor': isoBox(ctx, iso, b, color(C.steel), { seed: p.seed }); break;
      case 'wall': if (b.h > 0.5) isoBox(ctx, iso, b, color(C.steel), { seed: p.seed, width: 1.1 }); break;
      case 'front':
        if (b.h <= 0.5) break;
        isoBox(ctx, iso, b, color(C.steel), { seed: p.seed, width: 1.1 });
        if (e < 0.5) {
          const X = b.x + b.w;
          for (let i = 0; i < 4; i++) { const y0 = 12 + i * 40; const bay = [iso.p(X, y0, 10), iso.p(X, y0 + 34, 10), iso.p(X, y0 + 34, 40), iso.p(X, y0, 40)]; marker(ctx, bay, color(C.tan), { opacity: 0.8, seed: 400 + i }); ink(ctx, bay, { closed: true, width: 0.9, seed: 410 + i }); }
          dot(ctx, iso.p(X, 170, 30), 3, { ok: C.sage, warn: C.gold, hot: C.rose }[this.hl] || C.steel);
        }
        break;
      case 'mobo':
        isoBox(ctx, iso, b, color(C.sage), { seed: p.seed, width: 1.1 });
        for (let k = 0; k < 5; k++) { const y = b.y + 14 + k * 30; ink(ctx, [iso.p(b.x + 6, y, topZ), iso.p(b.x + b.w - 6, y + 6, topZ)], { width: 0.6, color: darker(C.sage, 0.45), amp: 0.3, seed: 200 + k }); }
        break;
      case 'cooler':
        isoBox(ctx, iso, b, color(C.steel), { seed: p.seed, lit, top: color(loadColor(cpu)) });
        for (let k = 1; k < 7; k++) { const y = b.y + b.d * k / 7; ink(ctx, [iso.p(b.x + 4, y, topZ), iso.p(b.x + b.w - 4, y, topZ)], { width: 0.8, amp: 0.25, seed: 220 + k }); ink(ctx, [iso.p(b.x + b.w, y, b.z + 3), iso.p(b.x + b.w, y, topZ - 3)], { width: 0.7, amp: 0.2, seed: 230 + k }); }
        break;
      case 'ram': {
        const bank = b.y < 100 ? 0 : 1, lights = Math.round(memFrac(s) * 8);
        for (let k = 0; k < 4; k++) {
          const st = box3(b.x, b.y + k * 6 + 1, b.z, b.w, 3.6, b.h);
          isoBox(ctx, iso, st, !down && bank * 4 + k < lights ? C.blue : C.shade, { seed: p.seed + k * 17, width: 1 });
        }
        if (lit) ink(ctx, iso.outline(b), { closed: true, width: 2.4, color: C.red, amp: 1.3, seed: p.seed + 9 });
        break;
      }
      case 'fans': {
        const speed = down ? 0 : 0.35 + cpu / 100 * 2.6;
        for (let k = 0; k < 5; k++) {
          const fb = box3(b.x, b.y + k * 30.4 + 1, b.z, b.w, 28, b.h);
          isoBox(ctx, iso, fb, color(C.steel), { seed: p.seed + k * 13, width: 1.1 });
          const X = fb.x + fb.w, yc = fb.y + fb.d / 2, zc = fb.z + fb.h / 2, r = 12;
          ink(ctx, Array.from({ length: 16 }, (_, i) => { const t = i / 16 * Math.PI * 2; return iso.p(X, yc + r * Math.cos(t), zc + r * Math.sin(t)); }), { closed: true, width: 0.9, amp: 0.3, seed: 250 + k });
          const a0 = time * speed * Math.PI * 2 + k;
          for (let bl = 0; bl < 4; bl++) { const a = a0 + bl * Math.PI / 2; polyPath(ctx, [iso.p(X, yc, zc), iso.p(X, yc + r * 0.9 * Math.cos(a), zc + r * 0.9 * Math.sin(a)), iso.p(X, yc + r * 0.9 * Math.cos(a + 0.5), zc + r * 0.9 * Math.sin(a + 0.5))]); ctx.fillStyle = 'rgba(35,30,22,.55)'; ctx.fill(); }
        }
        if (lit) ink(ctx, iso.outline(b), { closed: true, width: 2, color: 'rgba(200,55,47,.7)', amp: 1.2, seed: p.seed + 9 });
        break;
      }
      case 'gpu': this.gpu(ctx, iso, p, time, s, down); break;
      case 'disk': {
        isoBox(ctx, iso, b, color(C.tan), { seed: p.seed, lit });
        const ms = (s?.mounts || []).slice().sort((a, c) => c.size - a.size).slice(0, 4);
        if (p.i < ms.length && !down) {
          const f = Math.max(0.02, Math.min(1, mountFrac(ms[p.i]))), y0 = b.y + b.d * 0.32, y1 = b.y + b.d * 0.68;
          marker(ctx, [iso.p(b.x + 4, y0, topZ), iso.p(b.x + 4 + (b.w - 8) * f, y0, topZ), iso.p(b.x + 4 + (b.w - 8) * f, y1, topZ), iso.p(b.x + 4, y1, topZ)], loadColor(f * 100), { opacity: 1, seed: 260 + p.i, off: [0, 0], streaks: false });
          ink(ctx, [iso.p(b.x + 4, y0, topZ), iso.p(b.x + b.w - 4, y0, topZ), iso.p(b.x + b.w - 4, y1, topZ), iso.p(b.x + 4, y1, topZ)], { closed: true, width: 0.8, amp: 0.3, seed: 270 + p.i });
          const busy = (s.ioRead + s.ioWrite) > 8192 && Math.sin(time * 18 + p.i * 1.7) > 0;
          dot(ctx, iso.p(b.x + b.w, b.y + 6, b.z + 8), 2.6, busy ? C.gold : C.sage);
        } else hatch(ctx, iso.top(b), { color: alpha(C.pencil, 0.8), gap: 4 });
        ink(ctx, [iso.p(b.x + b.w, b.y + 12, b.z + 20), iso.p(b.x + b.w, b.y + b.d - 6, b.z + 20)], { width: 1.4, amp: 0.2, seed: 280 + p.i });
        break;
      }
      case 'nic': {
        isoBox(ctx, iso, b, color(C.sky), { seed: p.seed, lit });
        const Y = b.y + b.d;
        for (let k = 0; k < 2; k++) { const x0 = b.x + 6 + k * 12; polyPath(ctx, [iso.p(x0, Y, b.z + 4), iso.p(x0 + 8, Y, b.z + 4), iso.p(x0 + 8, Y, b.z + 11), iso.p(x0, Y, b.z + 11)]); ctx.fillStyle = 'rgba(35,30,22,.75)'; ctx.fill(); }
        break;
      }
      case 'psu': {
        isoBox(ctx, iso, b, color(C.shade), { seed: p.seed });
        const cx = b.x + b.w / 2, cy = b.y + b.d / 2;
        ink(ctx, Array.from({ length: 16 }, (_, i) => { const t = i / 16 * Math.PI * 2; return iso.p(cx + 18 * Math.cos(t), cy + 18 * Math.sin(t), topZ); }), { closed: true, width: 0.9, amp: 0.3, seed: 290 });
        ink(ctx, [iso.p(cx - 18, cy, topZ), iso.p(cx + 18, cy, topZ)], { width: 0.7, amp: 0.2, seed: 291 });
        ink(ctx, [iso.p(cx, cy - 18, topZ), iso.p(cx, cy + 18, topZ)], { width: 0.7, amp: 0.2, seed: 292 });
        break;
      }
    }
  }

  gpu(ctx, iso, p, time, s, down) {
    const b = p.b, gpus = down ? [] : (s?.gpus || []), lit = this.focus === 'gpu' && !down, topZ = b.z + b.h;
    if (!gpus.length) {
      ink(ctx, iso.outline(b), { closed: true, width: 1.1, color: C.pencil, amp: 0.5, seed: p.seed, dash: [4, 4] });
      ink(ctx, [iso.p(b.x, b.y + b.d, topZ), iso.p(b.x + b.w, b.y + b.d, topZ), iso.p(b.x + b.w, b.y, topZ)], { width: 1.1, color: C.pencil, amp: 0.4, seed: p.seed + 1, dash: [4, 4] });
      text(ctx, '空槽', ...iso.p(b.x + b.w / 2, b.y + b.d / 2, topZ + 6), { size: 13, color: C.pencil, align: 'center' });
      if (lit) ink(ctx, iso.outline(b), { closed: true, width: 2.2, color: C.red, amp: 1.2, seed: p.seed + 9 });
      return;
    }
    const util = gpuUtil(s);
    isoBox(ctx, iso, b, C.pink, { seed: p.seed, lit, top: lighter(C.pink, 0.35) });
    for (let k = 1; k < 9; k++) { const x = b.x + b.w * k / 9; ink(ctx, [iso.p(x, b.y + b.d, b.z + 3), iso.p(x, b.y + b.d, topZ - 3)], { width: 0.7, amp: 0.2, seed: 600 + k }); }
    const speed = 0.3 + util / 100 * 3.2;
    for (let f = 0; f < 2; f++) {
      const cx = b.x + b.w / 2, cy = b.y + b.d * (f ? 0.72 : 0.28), r = 11;
      const ring = Array.from({ length: 16 }, (_, i) => { const t = i / 16 * Math.PI * 2; return iso.p(cx + r * Math.cos(t), cy + r * Math.sin(t), topZ); });
      marker(ctx, ring, C.steel, { opacity: 0.9, seed: 610 + f, off: [0, 0], streaks: false });
      ink(ctx, ring, { closed: true, width: 0.9, amp: 0.3, seed: 620 + f });
      const a0 = time * speed * Math.PI * 2 + f * 0.7;
      for (let bl = 0; bl < 5; bl++) { const a = a0 + bl * 2 * Math.PI / 5; polyPath(ctx, [iso.p(cx, cy, topZ), iso.p(cx + r * 0.9 * Math.cos(a), cy + r * 0.9 * Math.sin(a), topZ), iso.p(cx + r * 0.9 * Math.cos(a + 0.45), cy + r * 0.9 * Math.sin(a + 0.45), topZ)]); ctx.fillStyle = 'rgba(35,30,22,.5)'; ctx.fill(); }
    }
    ink(ctx, [iso.p(b.x, b.y + b.d, b.z - 4), iso.p(b.x, b.y + b.d, topZ + 2)], { width: 2.2, amp: 0.2, seed: 630 });
    const f = Math.max(0.02, Math.min(1, util / 100));
    marker(ctx, [iso.p(b.x + b.w, b.y + 6, b.z + 4), iso.p(b.x + b.w, b.y + 6 + (b.d - 12) * f, b.z + 4), iso.p(b.x + b.w, b.y + 6 + (b.d - 12) * f, b.z + 9), iso.p(b.x + b.w, b.y + 6, b.z + 9)], loadColor(util), { opacity: 1, seed: 640, off: [0, 0], streaks: false });
    if (gpus.length > 1) text(ctx, `×${gpus.length}`, ...iso.p(b.x + b.w, b.y, topZ + 10), { size: 13, font: 'mono', bold: true, color: C.red, align: 'center' });
  }

  cable(ctx, iso, nic, time, s, down) {
    const Y = nic.y + nic.d;
    const pts = [[nic.x + 10, Y, nic.z + 7], [nic.x + 10, Y + 26, nic.z + 7], [nic.x - 14, Y + 52, nic.z - 2], [nic.x - 52, Y + 66, nic.z - 6]].map((q) => iso.p(...q));
    ink(ctx, pts, { width: 2.4, amp: 0.4, seed: 300 });
    if (down || !s) return;
    const lens = [0]; for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = lens[lens.length - 1] || 1;
    const at = (u) => { const d = u * total; for (let i = 1; i < pts.length; i++) if (lens[i] >= d) { const t = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; } return pts[pts.length - 1]; };
    const flow = (rate, inbound, color, sh) => {
      if (rate <= 64) return;
      const mag = Math.log10(rate / 1024 + 1), n = Math.min(8, 1 + Math.floor(mag * 2)), speed = 0.12 + Math.min(1, mag * 0.22);
      for (let k = 0; k < n; k++) { let f = (time * speed + k / n) % 1; if (inbound) f = 1 - f; const p = at(f); dot(ctx, [p[0] + sh, p[1] - sh], 3.2, color, C.ink, 0.8); }
    };
    flow(s.rxRate, true, C.blue, -3);
    flow(s.txRate, false, C.rose, 3);
  }

  lid(ctx, iso, e, color) {
    const b = moved(box3(0, 0, 52, 300, 180, 4), -24 * e, 0, 150 * e);
    const solid = Math.max(0, 1 - e * 1.8);
    if (solid > 0.02) {
      isoBox(ctx, iso, b, color(C.cream), { seed: 130, opacity: 0.97 * solid });
      if (e < 0.05) {
        for (let k = 0; k < 6; k++) { const x = 150 + k * 18; ink(ctx, [iso.p(x, 40, b.z + b.h), iso.p(x, 140, b.z + b.h)], { width: 0.9, color: C.pencil, amp: 0.3, seed: 310 + k }); }
        text(ctx, 'RACKBOOK', ...iso.p(70, 90, b.z + b.h), { size: 12, font: 'mono', bold: true, color: C.red, align: 'center' });
      }
    }
    if (e > 0.05) {
      ink(ctx, iso.outline(b), { closed: true, width: 1, color: C.pencil, amp: 0.5, seed: 131, dash: [5, 4] });
      ink(ctx, [iso.p(b.x, b.y + b.d, b.z + b.h), iso.p(b.x + b.w, b.y + b.d, b.z + b.h), iso.p(b.x + b.w, b.y, b.z + b.h)], { width: 1, color: C.pencil, amp: 0.4, seed: 132, dash: [5, 4] });
      text(ctx, '盖板 · 已掀开', ...iso.p(20, 20, b.z + b.h + 8), { size: 14, color: C.pencil });
    }
  }

  callouts(ctx, iso, ps, w, h, s, down, cpu) {
    const top = (k) => { const b = ps.find((p) => p.k === k).b; return iso.p(b.x + b.w / 2, b.y + b.d / 2, b.z + b.h); };
    const v = (f) => (s ? f(s) : '—');
    const g = s?.gpus || [];
    const items = [
      { sub: 'cpu', a: top('cooler'), left: false, t: 'CPU · 处理器', v: v((s) => `${s.cores} 核 · ${F.pct(s.cpu)}`), n: v((s) => '负载 ' + loadText(s)) },
      { sub: 'cpu', a: top('fans'), left: false, t: 'FANS · 风扇', v: down ? '停转' : `≈ ${Math.round(900 + cpu * 48)} rpm`, n: '示意：随 CPU 占用加速' },
      { sub: 'disk', a: top('disk'), left: false, t: 'DISKS · 磁盘', v: v((s) => { const w = worstDisk(s); return w ? `${w.mount} ${F.pct(mountFrac(w) * 100)}` : '无挂载'; }), n: v((s) => `读 ${F.rate(s.ioRead)} · 写 ${F.rate(s.ioWrite)}`) },
      { sub: 'mem', a: top('ram'), left: true, t: 'MEMORY · 内存', v: v((s) => `${F.bytes(s.memUsed)} / ${F.bytes(s.memTotal)}`), n: v((s) => `缓存 ${F.bytes(s.memCache)} · swap ${F.bytes(s.swapUsed)}`) },
      g.length
        ? { sub: 'gpu', a: top('gpu'), left: true, t: 'GPU · 显卡', v: `${g.length} 块 · ${F.pct(gpuUtil(s))}`, n: `显存 ${F.bytes(g.reduce((a, x) => a + x.memUsed, 0))} / ${F.bytes(g.reduce((a, x) => a + x.memTotal, 0))}` + (g.some((x) => x.temp != null) ? ` · ${Math.max(...g.map((x) => x.temp || 0))}°C` : '') }
        : { sub: 'gpu', a: top('gpu'), left: true, t: 'GPU · 显卡', v: s ? '未检测到' : '—', n: '空的 PCIe 槽（虚线）' },
      { sub: 'net', a: top('nic'), left: true, t: 'NETWORK · 网卡', v: v((s) => `↓ ${F.rate(s.rxRate)}  ↑ ${F.rate(s.txRate)}`), n: v((s) => `${s.tcp} 个 TCP 连接`) },
      { sub: null, a: top('psu'), left: true, t: 'SYSTEM · 电源', v: v((s) => `已运行 ${F.uptime(s.uptime)}`), n: v((s) => s.os || s.kernel) },
    ];
    for (const side of [true, false]) {
      const list = items.filter((x) => x.left === side).sort((a, b) => a.a[1] - b.a[1]);
      const topY = 40, gap = (h - 30 - topY) / list.length;
      list.forEach((c, i) => {
        const y = topY + gap * (i + 0.5), lit = c.sub && c.sub === this.focus && !down;
        const x = side ? 14 : w - 14, al = side ? 'left' : 'right';
        text(ctx, c.t, x, y - 12, { size: 16, bold: true, color: lit ? C.red : C.ink, align: al });
        text(ctx, c.v, x, y + 5, { size: 12, font: 'mono', bold: true, align: al });
        text(ctx, c.n, x, y + 21, { size: 13, color: C.muted, align: al });
        const tw = Math.min(200, Math.max(measure(ctx, c.t, 16, 'hand', true), measure(ctx, c.v, 12, 'mono', true), measure(ctx, c.n, 13)));
        if (lit) { const ux = side ? x : x - tw; ink(ctx, [[ux, y - 7], [ux + Math.min(tw, 90), y - 6]], { width: 1.6, color: C.red, amp: 0.6, seed: 500 + i }); }
        const sx = side ? x + tw + 10 : x - tw - 10;
        ink(ctx, [[sx, y - 2], [sx + (side ? 18 : -18), y - 2], c.a], { width: lit ? 1.6 : 1, color: lit ? C.red : 'rgba(35,30,22,.7)', amp: 0.6, seed: 520 + i + (side ? 0 : 50) });
        dot(ctx, c.a, lit ? 3.6 : 2.6, lit ? C.red : C.ink, null);
        if (lit) ink(ctx, circlePts(c.a, 8, 12), { closed: true, width: 1.4, color: C.red, amp: 0.5, seed: 540 });
      });
    }
  }

  hit(x, y) {
    const r = this.cv.getBoundingClientRect();
    const iso = this.iso(r.width, r.height), ps = parts(this.e(performance.now()));
    const ord = order(ps, iso).reverse();
    for (const i of ord) if (ps[i].sub && pointInPoly([x, y], iso.outline(ps[i].b))) return ps[i].sub;
    return null;
  }
}

// ---------- hand-drawn line chart ----------
export function niceCeil(v) {
  if (!(v > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= v) return m * e;
  return 10 * e;
}
export function lineChart(cv, lines, maxY, format) {
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  const plot = { x: 64, y: 8, w: w - 70, h: h - 26 };
  const all = lines.flatMap((l) => l.values || []);
  const ymax = maxY || niceCeil(Math.max(...all, 0) * 1.15 || 1024);
  for (let k = 0; k <= 3; k++) {
    const y = plot.y + plot.h - plot.h * k / 3;
    ink(ctx, [[plot.x, y], [plot.x + plot.w, y]], { width: 0.6, color: alpha(C.pencil, 0.6), amp: 0.4, seed: (k + 1) * 31, over: 0 });
    text(ctx, format(ymax * k / 3), plot.x - 6, y + 3, { size: 9, font: 'mono', color: C.muted, align: 'right' });
  }
  ink(ctx, [[plot.x, plot.y], [plot.x, plot.y + plot.h], [plot.x + plot.w, plot.y + plot.h]], { width: 1.3, seed: 5 });
  text(ctx, '← 最近 150 次采样', plot.x + 4, plot.y + plot.h + 14, { size: 12, color: C.muted });
  const step = plot.w / 149;
  let any = false;
  for (const l of lines) {
    const v = l.values || [];
    if (v.length < 2) continue;
    any = true;
    const x0 = plot.x + plot.w - step * (v.length - 1);
    const pts = v.map((y, i) => [x0 + step * i, plot.y + plot.h - plot.h * Math.min(1, Math.max(0, y / ymax))]);
    if (l.fill !== false) {
      ctx.beginPath(); ctx.moveTo(pts[0][0], plot.y + plot.h); pts.forEach((p) => ctx.lineTo(p[0], p[1])); ctx.lineTo(pts[pts.length - 1][0], plot.y + plot.h); ctx.closePath();
      ctx.fillStyle = alpha(l.color, 0.45); ctx.fill();
    }
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.strokeStyle = darker(l.color, 0.45); ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    dot(ctx, pts[pts.length - 1], 3.4, C.red, C.ink, 0.8);
  }
  if (!any) text(ctx, '正在攒数据…', plot.x + plot.w / 2, plot.y + plot.h / 2, { size: 16, color: C.muted, align: 'center' });
}
