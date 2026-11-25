// The overlay, in Rackbook's own look: Gaegu hand lettering for the title and the big numbers, small caps for labels,
// one red accent for whatever is working. Left: title, the wall-power readout, the workload slider and the panel of
// what Rackbook reads from the machine (the same numbers the app shows). Right: the subsystem buttons and two
// toggles. Bottom: a one-line caption. Callouts draw thin leaders into the parts. Fixed 1600 x 900 CSS layout;
// update(s) redraws every live part from the frame's state.
import gaegu400 from './fonts/gaegu-latin-400-normal.woff2';
import gaegu700 from './fonts/gaegu-latin-700-normal.woff2';

export const C = {ink: '#1d1b17', mute: '#857f73', faint: '#cfcabe', line: '#e2ddd2', paper: 'rgba(250,247,240,.94)', red: '#c8372f', heat: '#e4572e', cool: '#5aa9e6', green: '#3f9e6b'};
export const VIEWS = [
  ['overview', 'Overview'],
  ['lid', 'Lid off · airflow'],
  ['cpu', 'CPU & heatsink'],
  ['dimm', 'Memory'],
  ['gpu', 'GPU'],
  ['drives', 'Disks'],
  ['rear', 'Power & network'],
  ['exploded', 'Exploded view'],
];
export const TOGGLES = [['air', 'Airflow'], ['labels', 'Labels']];
const W = 1600;
const H = 900;
const CSS = `
@font-face{font-family:Gaegu;font-weight:400;src:url(data:font/woff2;base64,${gaegu400}) format('woff2')}
@font-face{font-family:Gaegu;font-weight:700;src:url(data:font/woff2;base64,${gaegu700}) format('woff2')}
#app{font-family:Inter,system-ui,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.ui{position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none}
.hand{font-family:Gaegu,cursive}
.pn{position:absolute;background:${C.paper};border:1.5px solid ${C.ink};border-radius:3px 6px 4px 5px;box-shadow:3px 3px 0 rgba(93,108,156,.12)}
.cp{font-size:9.6px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;white-space:nowrap}
.mu{color:${C.mute}}
.row{position:absolute;left:14px;right:14px;height:34px}
.row .k{position:absolute;left:0;top:2px}
.row .v{position:absolute;right:0;top:-3px;font-family:Gaegu,cursive;font-size:19px;font-weight:700;white-space:nowrap}
.row .bar{position:absolute;left:0;right:0;top:22px;height:6px;border:1.2px solid ${C.ink};border-radius:2px}
.row .bar i{position:absolute;left:0;top:0;bottom:0;background:${C.green}}
.tb{position:absolute;height:30px;padding:0 12px;display:flex;align-items:center;font-family:Gaegu,cursive;font-size:19px;font-weight:700;border:1.5px solid ${C.ink};border-radius:4px 7px 5px 6px;background:#fffdf8;color:${C.ink};white-space:nowrap;box-shadow:2px 2px 0 rgba(93,108,156,.14)}
.tb.on{background:#f8d57e}
.tb.tog{font-size:16px;height:26px}
.tb.tog::before{content:'';width:9px;height:9px;border:1.5px solid ${C.ink};border-radius:2px;margin-right:7px;background:#fff}
.tb.tog.on{background:#fffdf8}
.tb.tog.on::before{background:${C.red}}
.call{position:absolute;white-space:nowrap}
.call b{display:block;font-family:Gaegu,cursive;font-size:22px;font-weight:700;line-height:1}
.call span{display:block;font-size:9px;font-weight:600;letter-spacing:1.3px;color:${C.mute};text-transform:uppercase;margin-top:3px}
.cap{position:absolute;left:50%;bottom:30px;transform:translateX(-50%);padding:5px 18px 3px;background:${C.paper};border:1.5px solid ${C.ink};border-radius:5px 8px 6px 7px;font-family:Gaegu,cursive;font-size:25px;font-weight:700;white-space:nowrap}
.cur{position:absolute;left:0;top:0;z-index:50;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))}
.ring{position:absolute;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:2px solid ${C.red};opacity:0;z-index:49}
`;
const el = (h) => {
  const d = document.createElement('div');
  d.innerHTML = h.trim();
  return d.firstElementChild;
};
const fmt = (v, d = 0) => v.toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
export const WALL_MAX = 1000;

export function createConsole(app) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const ui = el(`<div class="ui"></div>`);
  app.appendChild(ui);
  const add = (h, parent = ui) => {
    const n = el(h);
    parent.appendChild(n);
    return n;
  };

  // ------------------------------------------------------------ title
  add(`<div class="cp" style="position:absolute;left:36px;top:34px;color:${C.red}">Rackbook &nbsp;·&nbsp; Teardown</div>`);
  add(`<div class="hand" style="position:absolute;left:34px;top:52px;font-size:44px;font-weight:700;line-height:1">Inside a 2U server</div>`);
  add(`<svg style="position:absolute;left:36px;top:100px" width="230" height="8"><path d="M2 5 Q60 1 118 4 T228 3" stroke="${C.red}" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`);
  add(`<div class="cp mu" style="position:absolute;left:36px;top:114px;font-weight:500;letter-spacing:1.2px">2 × 32 cores · 512 GB · 1 GPU · 12 × 3.5" · 2 × 25 GbE</div>`);

  // ------------------------------------------------------------ wall power and the workload slider
  const wall = add(`<div class="hand" style="position:absolute;left:33px;top:132px;font-size:74px;font-weight:700;line-height:1;color:${C.red}"></div>`);
  add(`<div class="cp" style="position:absolute;left:36px;top:212px">At the wall</div>`);
  const wallSub = add(`<div class="cp mu" style="position:absolute;left:150px;top:212px;font-weight:500"></div>`);
  add(`<div style="position:absolute;left:36px;top:230px;width:250px;height:8px;border:1.4px solid ${C.ink};border-radius:2px"></div>`);
  const wallFill = add(`<div style="position:absolute;left:37.5px;top:231.5px;height:5px;background:${C.red}"></div>`);

  add(`<div class="cp" style="position:absolute;left:36px;top:262px">Workload</div>`);
  const loadV = add(`<div class="hand" style="position:absolute;left:224px;top:252px;width:62px;text-align:right;font-size:24px;font-weight:700"></div>`);
  const SL = {x0: 44, x1: 278, y: 294};
  add(`<div style="position:absolute;left:${SL.x0 - 8}px;top:${SL.y - 2}px;width:${SL.x1 - SL.x0 + 16}px;height:4px;background:${C.faint};border-radius:2px"></div>`);
  const loadFill = add(`<div style="position:absolute;left:${SL.x0 - 8}px;top:${SL.y - 2}px;height:4px;background:${C.ink};border-radius:2px"></div>`);
  const knob = add(`<div style="position:absolute;top:${SL.y - 9}px;width:18px;height:18px;margin-left:-9px;border-radius:50%;background:#fffdf8;border:2px solid ${C.ink};box-shadow:2px 2px 0 rgba(93,108,156,.18)"></div>`);
  add(`<div class="cp mu" style="position:absolute;left:36px;top:308px;font-weight:500;font-size:8.6px">idle</div>`);
  add(`<div class="cp mu" style="position:absolute;left:258px;top:308px;font-weight:500;font-size:8.6px">flat out</div>`);
  const sliderAt = (k) => [SL.x0 + (SL.x1 - SL.x0) * k, SL.y];

  // ------------------------------------------------------------ what Rackbook reads
  const pn = add(`<div class="pn" style="left:30px;top:336px;width:262px;height:378px"></div>`);
  add(`<div class="cp" style="position:absolute;left:14px;top:12px;color:${C.red}">Live readings</div>`, pn);
  const ROWS = ['CPU 0', 'CPU 1', 'GPU', 'Memory', 'Disks', 'Network', 'Fans'];
  const rows = ROWS.map((k, i) => {
    const r = add(`<div class="row" style="top:${36 + i * 40}px"><div class="k cp">${k}</div><div class="v"></div><div class="bar"><i></i></div></div>`, pn);
    return {r, v: r.querySelector('.v'), bar: r.querySelector('.bar i')};
  });
  const chart = add(`<canvas width="468" height="72" style="position:absolute;left:14px;top:${36 + 7 * 40 + 2}px;width:234px;height:36px"></canvas>`, pn);
  const cg = chart.getContext('2d');
  add(`<div class="cp mu" style="position:absolute;left:36px;top:${336 + 378 + 10}px;font-weight:500;font-size:8.4px;letter-spacing:1px;line-height:1.6">Illustrative model from part ratings<br>Fans drawn at 1/200 speed</div>`);

  // ------------------------------------------------------------ subsystem buttons and toggles
  const btn = {};
  const spots = {};
  add(`<div class="cp" style="position:absolute;left:1336px;top:${118}px">Take it apart</div>`);
  VIEWS.forEach(([k, t], i) => {
    const y = 136 + i * 40;
    btn[k] = add(`<div class="tb" style="left:1336px;top:${y}px">${t}</div>`);
    spots[k] = [1336 + 48, y + 15];
  });
  const ty = 136 + VIEWS.length * 40 + 18;
  add(`<div class="cp" style="position:absolute;left:1336px;top:${ty}px">Show</div>`);
  TOGGLES.forEach(([k, t], i) => {
    const x = 1336 + i * 112;
    btn[k] = add(`<div class="tb tog" style="left:${x}px;top:${ty + 18}px">${t}</div>`);
    spots[k] = [x + 40, ty + 31];
  });

  // ------------------------------------------------------------ caption, callouts, cursor
  const cap = add(`<div class="cap"></div>`);
  const svg = add(`<svg style="position:absolute;left:0;top:0" width="${W}" height="${H}"></svg>`);
  const calls = [];
  const lines = [];
  for (let i = 0; i < 4; i++) {
    calls.push(add(`<div class="call"><b></b><span></span></div>`));
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    l.setAttribute('fill', 'none');
    l.setAttribute('stroke', C.ink);
    l.setAttribute('stroke-width', '1.3');
    svg.appendChild(l);
    const d = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    d.setAttribute('r', '3.4');
    d.setAttribute('fill', C.red);
    svg.appendChild(d);
    lines.push([l, d]);
  }
  const ring = add(`<div class="ring"></div>`);
  const cur = add(`<svg class="cur" width="26" height="30" viewBox="0 0 26 30"><path d="M3 2 L3 24 L9 18.5 L13 27 L17 25 L13 16.8 L21 16.5 Z" fill="#fff" stroke="${C.ink}" stroke-width="1.8" stroke-linejoin="round"/></svg>`);

  const bar = (b, k, color) => {
    b.style.width = `${Math.max(0, Math.min(1, k)) * 100}%`;
    b.style.background = color;
  };
  const hot = (k) => (k > 0.8 ? C.heat : k > 0.55 ? '#e8a33a' : C.green);

  function update(s) {
    const r = s.r;
    wall.textContent = `${fmt(r.wall)} W`;
    wallSub.textContent = `${fmt(r.dc)} W DC · 94 %`;
    wallFill.style.width = `${(Math.min(1, r.wall / WALL_MAX) * 250 - 3).toFixed(1)}px`;
    loadV.textContent = `${Math.round(r.L * 100)} %`;
    const [kx] = sliderAt(r.L);
    knob.style.left = `${kx}px`;
    loadFill.style.width = `${kx - (SL.x0 - 8)}px`;
    const vals = [
      [`${fmt(r.cpuT)}°C · ${fmt(r.cpuW)} W`, (r.cpuT - 25) / 70],
      [`${fmt(r.cpuT1)}°C · ${fmt(r.cpuW)} W`, (r.cpuT1 - 25) / 70],
      [`${fmt(r.gpuU * 100)} % · ${fmt(r.gpuT)}°C`, r.gpuU],
      [`${fmt(r.memGB)} / 512 GB`, r.memGB / 512],
      [`${fmt(r.diskMB / 1000, 2)} GB/s`, r.diskMB / 1600],
      [`${fmt(r.netGb, 1)} Gb/s`, r.netGb / 50],
      [`${fmt(Math.round(r.rpm / 100) * 100)} rpm · ${fmt(r.cfm)} CFM`, r.rpm / 16800],
    ];
    vals.forEach(([v, k], i) => {
      rows[i].v.textContent = v;
      bar(rows[i].bar, k, i < 3 ? hot(k) : i === 6 ? C.cool : C.green);
    });
    // the last 20 s of wall power (red) and CPU temperature (ink)
    cg.clearRect(0, 0, 468, 72);
    cg.lineWidth = 2.6;
    cg.lineJoin = 'round';
    for (const [key, col, lo, hi] of [['wall', C.red, 200, WALL_MAX], ['cpuT', C.ink, 25, 95]]) {
      cg.strokeStyle = col;
      cg.beginPath();
      s.hist.forEach((h, i) => {
        const x = 4 + (i / (s.hist.length - 1)) * 460;
        const y = 68 - ((h[key] - lo) / (hi - lo)) * 64;
        i ? cg.lineTo(x, y) : cg.moveTo(x, y);
      });
      cg.stroke();
    }
    for (const [k] of VIEWS) btn[k].classList.toggle('on', s.view === k);
    for (const [k] of TOGGLES) btn[k].classList.toggle('on', !!s.toggles[k]);
    cap.textContent = s.caption;
    cap.style.opacity = s.capO;
    // callouts
    calls.forEach((c, i) => {
      const co = s.callouts[i];
      const [l, d] = lines[i];
      if (!co || !co.at || co.o <= 0.01) {
        c.style.opacity = 0;
        l.setAttribute('d', '');
        d.setAttribute('opacity', 0);
        return;
      }
      c.querySelector('b').textContent = co.name;
      c.querySelector('span').textContent = co.sub;
      const [lx, ly] = co.label;
      c.style.left = `${lx}px`;
      c.style.top = `${ly - 30}px`;
      c.style.opacity = co.o;
      const [ax, ay] = co.at;
      const ex = lx - 6;
      const ey = ly - 8;
      l.setAttribute('d', `M${ex} ${ey} L${ex - 14} ${ey} L${ax} ${ay}`);
      l.setAttribute('opacity', co.o);
      d.setAttribute('cx', ax);
      d.setAttribute('cy', ay);
      d.setAttribute('opacity', co.o);
    });
    const cu = s.cursor;
    cur.style.display = cu ? 'block' : 'none';
    if (cu) {
      cur.style.transform = `translate(${cu.x - 3}px, ${cu.y - 2}px) scale(${cu.press ? 0.88 : 1})`;
      ring.style.opacity = cu.ring;
      ring.style.left = `${cu.ringX}px`;
      ring.style.top = `${cu.ringY}px`;
      ring.style.transform = `scale(${1.6 - 0.6 * cu.ring})`;
    } else ring.style.opacity = 0;
  }
  return {root: ui, update, btn, spots, sliderAt, SL};
}
