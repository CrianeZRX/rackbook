// The tour, as a pure function of t: the server idles closed, the lid comes off and the airflow shows, the operator
// drags the workload to 90 %, then each subsystem is pulled out in turn while the rest fades back, and it ends on
// the whole machine exploded. Everything on screen reads from kin.js through one input, the workload.
import {runSim} from 'teardown-kit/runtime.js';
import {createConsole} from './console.js';
import {integrate, ss, smoother} from './kin.js';
import {createServerStage} from './stage.js';

export const SCRIPT = [
  {t: 0, view: 'overview'},
  {t: 3.4, view: 'lid'},
  {t: 6.6, load: [0.12, 0.9, 1.6]},
  {t: 9.8, view: 'cpu'},
  {t: 13.2, view: 'dimm'},
  {t: 16.4, view: 'gpu'},
  {t: 19.6, view: 'drives'},
  {t: 22.8, view: 'rear'},
  {t: 26.0, view: 'exploded'},
];
export const DURATION = 30.5;
export const DEFAULTS = {duration: DURATION, fps: 60, theme: 'light', hud: {enabled: false, title: 'Rackbook', subtitle: '· Inside a 2U server'}, director: {enabled: false}, watermark: ''};
const D2R = Math.PI / 180;

const LOAD_EV = SCRIPT.find((e) => e.load);
export const loadAt = (t) => LOAD_EV.load[0] + (LOAD_EV.load[1] - LOAD_EV.load[0]) * ss(LOAD_EV.t, LOAD_EV.t + LOAD_EV.load[2], t);

// ------------------------------------------------------------ what each view pulls out
export const OPS = {
  overview: {},
  lid: {lid: 1, shroud: 1, air: 1},
  cpu: {lid: 1, shroud: 1, hs: 1, focus: ['cpu', 'board'], ghost: 1},
  dimm: {lid: 1, shroud: 1, dimm: 1, focus: ['dimm', 'board'], ghost: 1},
  gpu: {lid: 1, shroud: 1, gpu: 1, focus: ['gpu'], ghost: 1},
  drives: {lid: 1, shroud: 1, drives: 1, focus: ['drives'], ghost: 1},
  rear: {lid: 1, shroud: 1, psu: 1, nic: 1, focus: ['psu', 'nic'], ghost: 1},
  exploded: {lid: 1, shroud: 1, fans: 1, hs: 1, dimm: 1, gpu: 1, drives: 1, psu: 1, nic: 1},
};
const KEYS = ['lid', 'shroud', 'fans', 'hs', 'dimm', 'gpu', 'drives', 'psu', 'nic', 'air'];
// blend two views' ops: distances ease, the focus fades out of the old part and into the new one
export function blendOps(a, b, k) {
  const o = {};
  for (const key of KEYS) o[key] = (a[key] ?? 0) + ((b[key] ?? 0) - (a[key] ?? 0)) * k;
  const ga = a.focus ? a.ghost : 0;
  const gb = b.focus ? b.ghost : 0;
  if (k < 0.5) {
    o.focus = a.focus;
    o.ghost = ga * (1 - 2 * k) + (b.focus ? 0 : gb) * 2 * k;
  } else {
    o.focus = b.focus;
    o.ghost = gb * (2 * k - 1);
  }
  return o;
}

// ------------------------------------------------------------ cameras: target (m), azimuth/elevation (deg), distance
export const VIEW_FN = {
  overview: (u) => {
    const k = smoother(u / 3.6);
    return {tx: 0, ty: 0.04, tz: 0.02, az: 22 + 20 * k, el: 20 + 8 * k, d: 2.4 - 0.35 * k};
  },
  lid: (u) => ({tx: 0, ty: 0.06, tz: -0.01, az: 40 + 2.5 * u, el: 48, d: 2.1}),
  cpu: (u) => ({tx: -0.06, ty: 0.09, tz: -0.01, az: 30 + 3 * u, el: 36, d: 1.0}),
  dimm: (u) => ({tx: -0.03, ty: 0.07, tz: -0.01, az: 72 - 3 * u, el: 26, d: 0.95}),
  gpu: (u) => ({tx: 0, ty: 0.12, tz: -0.18, az: 150 + 3 * u, el: 32, d: 1.2}),
  drives: (u) => ({tx: 0.0, ty: 0.05, tz: 0.38, az: 28 + 3 * u, el: 20, d: 1.3}),
  rear: (u) => ({tx: 0, ty: 0.05, tz: -0.4, az: 208 - 3 * u, el: 22, d: 1.4}),
  exploded: (u) => ({tx: 0, ty: 0.15, tz: 0.04, az: -38 + 3 * u, el: 28, d: 2.55}),
};
const VIEWS = SCRIPT.filter((e) => e.view).map((e) => [e.t, e.view]);
export const viewAt = (t) => VIEWS.filter(([t0]) => t0 <= t).pop() || VIEWS[0];
function blendCam(a, b, k) {
  const o = {};
  for (const key in b) o[key] = key === 'az' ? a.az + ((((b.az - a.az + 540) % 360) - 180) * k) : a[key] + (b[key] - a[key]) * k;
  const swing = Math.min(1, Math.abs(((b.az - a.az + 540) % 360) - 180) / 90);
  o.d += Math.max(0, Math.max(a.d, b.d) + 0.35 * swing - o.d) * Math.sin(Math.PI * k);
  return o;
}
export function camAt(t) {
  let i = 0;
  while (i < VIEWS.length - 1 && VIEWS[i + 1][0] <= t) i++;
  const cur = VIEW_FN[VIEWS[i][1]](t - VIEWS[i][0]);
  if (i === 0) return cur;
  const k = ss(VIEWS[i][0], VIEWS[i][0] + 1.7, t);
  return k >= 1 ? cur : blendCam(VIEW_FN[VIEWS[i - 1][1]](t - VIEWS[i - 1][0]), cur, k);
}
export function opsAt(t) {
  let i = 0;
  while (i < VIEWS.length - 1 && VIEWS[i + 1][0] <= t) i++;
  const cur = OPS[VIEWS[i][1]];
  if (i === 0) return {...cur, labels: 1};
  // the parts move a beat after the click, while the camera is on its way
  const k = ss(VIEWS[i][0] + 0.25, VIEWS[i][0] + 1.75, t);
  return {...blendOps(OPS[VIEWS[i - 1][1]], cur, k), labels: 1};
}

// ------------------------------------------------------------ captions and callouts
export const CAPTION = {
  overview: 'A 2U rack server, idling at 12 %',
  lid: 'Lid and shroud off: six fans pull cold air front to back',
  load: 'Workload to 90 %: power climbs, the fans answer the heat',
  cpu: '205 W per socket, into a 0.19 K/W heatsink',
  dimm: '16 × 32 GB of DDR4: 512 GB, ~4.5 W a stick under load',
  gpu: 'One 150 W GPU, lying flat on the rear riser',
  drives: '12 hot-swap 3.5" drives: 1.4 GB/s flat out',
  rear: 'Two 1,400 W Platinum PSUs and 2 × 25 GbE',
  exploded: 'Rackbook draws your own servers like this, over plain SSH',
};
export const CALLOUTS = {
  lid: [{a: 'fans', name: 'Fan wall', sub: '6 × 60 mm · 4,200–16,800 rpm', label: [470, 180]}],
  cpu: [
    {a: 'cpu0', name: 'Heatsink', sub: '90 × 64 × 110 mm · 34 fins', label: [880, 150]},
    {a: 'socket', name: 'Socket 0', sub: '32 cores · 205 W TDP', label: [900, 640]},
  ],
  dimm: [{a: 'dimm', name: 'DDR4-3200 RDIMM', sub: '32 GB · 133 × 31 mm', label: [900, 170]}],
  gpu: [{a: 'gpu', name: 'GPU', sub: '150 W · 24 GB · 267 mm long', label: [930, 170]}],
  drives: [{a: 'drive', name: '3.5" SATA drive', sub: '8 TB · 7,200 rpm · 147 mm deep', label: [920, 200]}],
  rear: [
    {a: 'psu', name: 'PSU 1 + 1', sub: '1,400 W Platinum · 94 %', label: [930, 210]},
    {a: 'nic', name: 'OCP 3.0 NIC', sub: '2 × 25 GbE SFP28', label: [930, 640]},
  ],
};

// ------------------------------------------------------------ the operator's pointer
const REST = [[820, 520], [700, 470], [900, 560], [760, 430]];
export function makeCursor(ui) {
  const EV = SCRIPT.filter((e) => e.t > 0).map((e) => (e.load ? {t: e.t, spot: ui.sliderAt(e.load[0]), to: ui.sliderAt(e.load[1]), drag: e.load[2]} : {t: e.t, spot: ui.spots[e.view], drag: 0}));
  const WP = [[0, 1000, 640]];
  EV.forEach((e, i) => {
    WP.push([e.t - 0.18, ...e.spot]);
    if (e.drag) {
      for (let k = 0; k <= 12; k++) {
        const tt = e.t + (k / 12) * e.drag;
        WP.push([tt + 0.02, ...ui.sliderAt(loadAt(tt))]);
      }
      WP.push([e.t + e.drag + 0.3, ...e.to]);
    } else WP.push([e.t + 0.24, ...e.spot]);
    WP.push([e.t + e.drag + 1.6, ...REST[i % REST.length]]);
  });
  WP.sort((a, b) => a[0] - b[0]);
  return (t) => {
    let i = 0;
    while (i < WP.length - 2 && t > WP[i + 1][0]) i++;
    const [t0, x0, y0] = WP[i];
    const [t1, x1, y1] = WP[i + 1];
    const lin = t1 - t0 < 0.2;
    const k = lin ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : ss(t0, t1, t);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const bow = lin ? 0 : Math.sin(Math.PI * k) * Math.min(24, len * 0.07);
    let press = false;
    let ring = 0;
    let rx = 0;
    let ry = 0;
    for (const e of EV) {
      if (t >= e.t - 0.07 && t < e.t + Math.max(0.09, e.drag + 0.1)) press = true;
      if (t >= e.t && t < e.t + 0.55) {
        ring = 1 - (t - e.t) / 0.55;
        [rx, ry] = e.spot;
      }
    }
    return {x: x0 + (x1 - x0) * k + (len ? (-(y1 - y0) / len) * bow : 0), y: y0 + (y1 - y0) * k + (len ? ((x1 - x0) / len) * bow : 0), press, ring, ringX: rx, ringY: ry};
  };
}

// ------------------------------------------------------------ the overlay's data for a frame
export function makeConsoleFrame(ui, st, model) {
  const proj = (v) => (v ? st.project(v.x, v.y, v.z) : null);
  return (t, {view, since, cursor, caption, capO, toggles, labels}) => {
    const r = model.read(t);
    const hist = [];
    for (let i = 0; i < 60; i++) hist.push(model.read(Math.max(0, t - 20 + (i / 59) * 20)));
    const vis = ss(1.3, 1.9, since) * (labels ? 1 : 0);
    const callouts = (CALLOUTS[view] || []).map((c) => ({name: c.name, sub: c.sub, label: c.label, at: proj(st.eng.anchor(c.a)), o: vis}));
    ui.update({r, hist, view, caption, capO, callouts, cursor, toggles});
    return r;
  };
}

export function captionAt(t) {
  const [t0, v] = viewAt(t);
  const inLoad = t >= LOAD_EV.t && t < VIEWS.find(([a]) => a > LOAD_EV.t)[0];
  const key = inLoad ? 'load' : v;
  const start = inLoad ? LOAD_EV.t : t0;
  const next = SCRIPT.find((e) => e.t > start)?.t ?? DURATION + 1;
  return {caption: CAPTION[key], capO: ss(start + 0.35, start + 0.75, t) * (1 - ss(next - 0.35, next - 0.05, t))};
}

export function makeFilm() {
  return async ({canvas, capture}) => {
    await document.fonts.load('700 20px Gaegu').catch(() => {});
    const st = createServerStage({canvas});
    const resize = () => st.resize(1600, 900, capture ? devicePixelRatio || 1 : Math.min(devicePixelRatio || 1, 2));
    resize();
    const q = new URLSearchParams(location.search).get('q');
    if (q === 'mid') st.setQuality({samples: 4, ao: true, shadow: 2048});
    if (q === 'lo') st.setQuality({samples: 2, ao: false, shadow: 2048});
    const ui = createConsole(document.getElementById('app'));
    const model = integrate(loadAt, DURATION + 1);
    const cursorAt = makeCursor(ui);
    const frame = makeConsoleFrame(ui, st, model);
    return {
      resize,
      render(t) {
        const [t0, view] = viewAt(t);
        const c = camAt(t);
        const ops = opsAt(t);
        st.frame(model.read(t), {...c, az: c.az * D2R, el: c.el * D2R}, ops);
        frame(t, {view, since: t - t0, cursor: cursorAt(t), ...captionAt(t), toggles: {air: ops.air > 0.5, labels: 1}, labels: 1});
        return {};
      },
    };
  };
}

export const run = () => runSim(DEFAULTS, makeFilm());
