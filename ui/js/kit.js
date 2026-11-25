import { tr, getLang } from './i18n.js';

// The pen: deterministic wobbly ink, marker washes, pencil hatching, isometric boxes.
// A port of the Tinycharts look to Canvas 2D and SVG.

export const C = {
  ink: '#231e16', red: '#c8372f', pencil: '#7f9db3', shadow: '#5d6c9c', paper: '#f8f3e6', cream: '#fffdf6',
  tan: '#ecc98e', wood: '#c07f3f', pink: '#f3a6bb', rose: '#ef6a4c', sage: '#93d3b0', sky: '#a9c8ee',
  blue: '#76a0e2', gold: '#f4b829', steel: '#c6ccce', shade: '#e3e0d2', muted: '#6f665a', ok: '#2f7a54',
};
export const WASHES = ['sky', 'sage', 'gold', 'pink', 'rose', 'tan', 'blue', 'steel'];
export const wash = (n) => C[n] || C.sky;
export const loadColor = (pct) => (pct < 60 ? C.sage : pct < 85 ? C.gold : C.rose);

// Same stacks as the CSS: Gaegu (Latin + Hangul) first, then the handwritten CJK font for the language.
const cjk = () => ({ 'zh-TW': '"LXGW WenKai TC","ZCOOL KuaiLe","Yomogi"', ja: '"Yomogi","LXGW WenKai TC","ZCOOL KuaiLe"' }[getLang()] || '"ZCOOL KuaiLe","LXGW WenKai TC","Yomogi"');
export const FONT = {
  get hand() { return `"Gaegu",${cjk()},cursive`; },
  get mono() { return `"Courier Prime",${cjk()},monospace`; },
  get serif() { return `"Young Serif",${cjk()},serif`; },
};

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); }
export function mix(a, b, f) { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f); }
export const darker = (c, f) => mix(c, '#000000', f);
export const lighter = (c, f) => mix(c, '#ffffff', f);
export function alpha(c, a) { const [r, g, b] = hexToRgb(c); return `rgba(${r},${g},${b},${a})`; }

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s % 100000) / 100000; };
}
export function seedOf(pts, salt = 0) {
  let h = 2166136261 ^ salt;
  for (const p of pts) { h = Math.imul(h ^ Math.round(p[0] * 4), 16777619); h = Math.imul(h ^ Math.round(p[1] * 4), 16777619); }
  return h >>> 0;
}

/** Points of a hand-drawn polyline: smooth perpendicular wander plus a little overshoot. */
export function wobblePts(pts, { closed = false, amp = 0.8, seed, over = 1.6 } = {}) {
  if (pts.length < 2) return pts.slice();
  const r = rng(seed ?? seedOf(pts));
  const poly = pts.map((p) => [p[0], p[1]]);
  if (closed) poly.push([pts[0][0], pts[0][1]]);
  if (over > 0) {
    const n = poly.length;
    if (!closed) {
      const [a, b] = [poly[0], poly[1]]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      poly[0] = [a[0] - (b[0] - a[0]) / l * over, a[1] - (b[1] - a[1]) / l * over];
    }
    const [y, z] = [poly[n - 2], poly[n - 1]]; const l = Math.hypot(z[0] - y[0], z[1] - y[1]) || 1;
    const e = closed ? over * 1.8 : over;
    poly[n - 1] = [z[0] + (z[0] - y[0]) / l * e, z[1] + (z[1] - y[1]) / l * e];
  }
  const f1 = 0.035 + r() * 0.03, f2 = 0.09 + r() * 0.05, p1 = r() * 6.283, p2 = r() * 6.283;
  const out = [];
  let dist = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 0.001;
    const nx = -dy / len, ny = dx / len;
    const steps = Math.max(1, Math.floor(len / 12));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, d = dist + len * t;
      const off = amp * (0.65 * Math.sin(d * f1 + p1) + 0.35 * Math.sin(d * f2 + p2));
      out.push([a[0] + dx * t + nx * off, a[1] + dy * t + ny * off]);
    }
    dist += len;
  }
  out.push(poly[poly.length - 1]);
  return out;
}

export function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 2) { ctx.lineTo(pts[1][0], pts[1][1]); return; }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const l = pts[pts.length - 1];
  ctx.lineTo(l[0], l[1]);
}

export function ink(ctx, pts, { closed = false, width = 1.5, color = C.ink, amp = 0.7, seed, over, dash } = {}) {
  if (pts.length < 2) return;
  tracePath(ctx, wobblePts(pts, { closed, amp, seed, over }));
  ctx.save();
  ctx.lineWidth = width; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.stroke();
  ctx.restore();
}

export function polyPath(ctx, pts) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** Marker wash: flat colour slightly off-register, with darker overlap streaks. */
export function marker(ctx, pts, color, { opacity = 0.92, seed, off = [1.4, 1.1], streaks = true } = {}) {
  if (pts.length < 3) return;
  const p = pts.map((q) => [q[0] + off[0], q[1] + off[1]]);
  ctx.save();
  ctx.globalAlpha = opacity;
  polyPath(ctx, p); ctx.fillStyle = color; ctx.fill();
  if (streaks) {
    ctx.clip();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of p) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
    const h = maxY - minY;
    if (maxX - minX > 6 && h > 6) {
      const r = rng(seed ?? seedOf(pts, 7));
      ctx.strokeStyle = alpha(darker(color, 0.12), 0.28);
      let x = minX - h;
      while (x < maxX) {
        const w = 5 + r() * 9;
        ctx.lineWidth = w * 0.45;
        ctx.beginPath(); ctx.moveTo(x, maxY); ctx.lineTo(x + h * 0.6, minY); ctx.stroke();
        x += w + 6 + r() * 14;
      }
    }
  }
  ctx.restore();
}

export function hatch(ctx, pts, { color = C.pencil, gap = 5, width = 0.7 } = {}) {
  ctx.save();
  polyPath(ctx, pts); ctx.clip();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of pts) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
  const h = maxY - minY;
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
  for (let x = minX - h; x < maxX; x += gap) { ctx.moveTo(x, maxY); ctx.lineTo(x + h, minY); }
  ctx.stroke();
  ctx.restore();
}

export function dot(ctx, p, r, color, ring = C.ink, rw = 1) {
  ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  if (ring) { ctx.lineWidth = rw; ctx.strokeStyle = ring; ctx.stroke(); }
}

export function circlePts(c, r, n = 18, ry) {
  const out = [];
  for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; out.push([c[0] + r * Math.cos(t), c[1] + (ry ?? r) * Math.sin(t)]); }
  return out;
}

export function text(ctx, s, x, y, { size = 14, font = 'hand', bold = false, color = C.ink, align = 'left', base = 'alphabetic', raw = false } = {}) {
  if (!raw) s = tr(s);
  ctx.save();
  ctx.font = `${bold ? '700 ' : ''}${size}px ${FONT[font] || font}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.fillText(s, x, y);
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}
export function measure(ctx, s, size = 14, font = 'hand', bold = false) {
  s = tr(s);
  ctx.save(); ctx.font = `${bold ? '700 ' : ''}${size}px ${FONT[font] || font}`; const w = ctx.measureText(s).width; ctx.restore(); return w;
}

// ---------- isometric projection, viewed along (1,1,1) ----------
export class Iso {
  constructor(ox, oy, s) { this.ox = ox; this.oy = oy; this.s = s; }
  p(x, y, z) { return [this.ox + (x - y) * 0.866 * this.s, this.oy + ((x + y) * 0.5 - z) * this.s]; }
  top(b) { const z = b.z + b.h; return [this.p(b.x, b.y, z), this.p(b.x + b.w, b.y, z), this.p(b.x + b.w, b.y + b.d, z), this.p(b.x, b.y + b.d, z)]; }
  left(b) { return [this.p(b.x, b.y + b.d, b.z), this.p(b.x + b.w, b.y + b.d, b.z), this.p(b.x + b.w, b.y + b.d, b.z + b.h), this.p(b.x, b.y + b.d, b.z + b.h)]; }
  right(b) { return [this.p(b.x + b.w, b.y, b.z), this.p(b.x + b.w, b.y + b.d, b.z), this.p(b.x + b.w, b.y + b.d, b.z + b.h), this.p(b.x + b.w, b.y, b.z + b.h)]; }
  outline(b) {
    return [this.p(b.x, b.y, b.z + b.h), this.p(b.x + b.w, b.y, b.z + b.h), this.p(b.x + b.w, b.y, b.z),
      this.p(b.x + b.w, b.y + b.d, b.z), this.p(b.x, b.y + b.d, b.z), this.p(b.x, b.y + b.d, b.z + b.h)];
  }
}
export const box3 = (x, y, z, w, d, h) => ({ x, y, z, w, d, h });
export const moved = (b, dx, dy, dz) => ({ ...b, x: b.x + dx, y: b.y + dy, z: b.z + dz });

export function isoBox(ctx, iso, b, color, { seed = 1, stroke = C.ink, width = 1.3, lit = false, top, opacity = 0.95 } = {}) {
  marker(ctx, iso.left(b), darker(color, 0.14), { opacity, seed: seed + 1 });
  marker(ctx, iso.right(b), color, { opacity, seed: seed + 2 });
  marker(ctx, iso.top(b), top || lighter(color, 0.2), { opacity, seed: seed + 3 });
  const c = iso.p(b.x + b.w, b.y + b.d, b.z + b.h);
  ink(ctx, iso.outline(b), { closed: true, width, color: stroke, seed });
  ink(ctx, [iso.p(b.x, b.y + b.d, b.z + b.h), c, iso.p(b.x + b.w, b.y, b.z + b.h)], { width: width * 0.8, color: stroke, amp: 0.5, seed: seed + 5 });
  ink(ctx, [c, iso.p(b.x + b.w, b.y + b.d, b.z)], { width: width * 0.8, color: stroke, amp: 0.4, seed: seed + 6 });
  if (lit) ink(ctx, iso.outline(b), { closed: true, width: 2.6, color: C.red, amp: 1.3, seed: seed + 9 });
}

export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- canvas helper: crisp on HiDPI ----------
export function fitCanvas(cv) {
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

// ---------- DOM: hand-drawn borders as SVG backgrounds ----------
function svgPath(pts) {
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l[0].toFixed(1)} ${l[1].toFixed(1)}`;
}
export function borderURI(w, h, color = C.ink, width = 1.4, amp = 0.9, seed) {
  const i = 1.5;
  const pts = wobblePts([[i, i], [w - i, i], [w - i, h - i], [i, h - i]], { closed: true, amp, seed: seed ?? (Math.round(w) * 7919 + Math.round(h)) });
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><path d='${svgPath(pts)}' fill='none' stroke='${color}' stroke-width='${width}' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
export function ruleURI(w, h, color = C.ink, width = 1.3, vertical = false, seed = 21) {
  const pts = vertical ? wobblePts([[w / 2, 0], [w / 2 + 1, h]], { amp: 1, seed, over: 0 }) : wobblePts([[0, h / 2], [w, h / 2 + 1]], { amp: 1.1, seed, over: 0 });
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><path d='${svgPath(pts)}' fill='none' stroke='${color}' stroke-width='${width}' stroke-linecap='round'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function paint(el) {
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return;
  if (el.classList.contains('rule-h') || el.classList.contains('rule-v')) {
    const v = el.classList.contains('rule-v');
    el.style.backgroundImage = ruleURI(w, h, el.dataset.ink || C.ink, +(el.dataset.width || 1.3), v, +(el.dataset.seed || 21));
    return;
  }
  const lit = el.classList.contains('lit');
  const color = lit ? C.red : el.dataset.ink || (el.classList.contains('danger') ? C.red : el.classList.contains('active') ? C.red : C.ink);
  const width = lit ? 2.2 : +(el.dataset.width || (el.classList.contains('btn') || el.classList.contains('field') ? 1.2 : 1.4));
  const amp = el.classList.contains('btn') || el.classList.contains('field') ? 0.6 : 0.9;
  const key = `${w}x${h}|${color}|${width}`;
  if (el._skKey === key) return;
  el._skKey = key;
  el.style.backgroundImage = borderURI(w, h, color, width, amp, el.dataset.seed ? +el.dataset.seed : undefined);
}

const ro = new ResizeObserver((entries) => { for (const e of entries) paint(e.target); });
const watched = new WeakSet();
function watch(el) {
  if (watched.has(el)) { paint(el); return; }
  watched.add(el); ro.observe(el); paint(el);
}
export function sketchAll(root = document) {
  root.querySelectorAll('.sk, .rule-h, .rule-v').forEach(watch);
}
// Auto-apply to anything added later, and repaint when .lit / .active toggles.
new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.type === 'attributes') { const el = m.target; if (el.classList && (el.classList.contains('sk'))) { el._skKey = null; paint(el); } continue; }
    m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches('.sk, .rule-h, .rule-v')) watch(n); sketchAll(n); } });
  }
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

// paper tooth, generated once
export function paperTooth() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 220;
  const ctx = cv.getContext('2d'); const r = rng(42);
  ctx.fillStyle = 'rgba(35,30,22,0.07)';
  for (let i = 0; i < 260; i++) { const s = 0.4 + r() * 0.8; ctx.fillRect(r() * 220, r() * 220, s, s); }
  document.body.style.setProperty('--tooth', `url(${cv.toDataURL()})`);
}
