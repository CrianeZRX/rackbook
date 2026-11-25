// The server as a page you drive: the film's machine and overlay in real time. Click a subsystem to pull it out,
// drag the workload slider and watch the fans, temperatures and power answer, toggle the airflow and the labels,
// drag to orbit, wheel to zoom. Left alone it plays the film's tour with the operator's cursor, looped; any click,
// drag, wheel or key hands control over, 25 s of quiet hands it back.
import {warmComposer} from 'teardown-kit/warm.js';
import {createConsole, TOGGLES, VIEWS} from './console.js';
import {blendOps, CALLOUTS, CAPTION, captionAt, camAt, DURATION, loadAt, makeCursor, OPS, opsAt, VIEW_FN, viewAt} from './film.js';
import {clamp, integrate, liveModel, ss} from './kin.js';
import {createServerStage} from './stage.js';

const W = 1600;
const H = 900;
const IDLE = 25;
const D2R = Math.PI / 180;
const CSS = `
html,body{background:#e9eaec;overflow:hidden}
#app{position:absolute!important;inset:auto!important;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0}
#gl{touch-action:none;cursor:grab}
#gl.drag{cursor:grabbing}
.tb{pointer-events:auto;cursor:pointer}
.tb:hover{filter:brightness(.96)}
.hit{position:absolute;pointer-events:auto;cursor:ew-resize}
.tourchip{position:absolute;left:800px;top:30px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;height:26px;padding:0 13px;border:1.5px solid #1d1b17;border-radius:5px 8px 6px 7px;background:rgba(250,247,240,.95);font:700 17px Gaegu,cursive;white-space:nowrap;cursor:pointer;pointer-events:auto}
.tourchip i{display:block;width:7px;height:7px;border-radius:50%;background:#c8372f}
.tourchip.on i{animation:blink 1.2s steps(2) infinite}
@keyframes blink{50%{opacity:.15}}
`;

export async function runLive() {
  document.title = 'Rackbook · Inside a 2U server';
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const app = document.getElementById('app');
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  app.appendChild(canvas);
  const st = createServerStage({canvas});
  const ui = createConsole(app);
  await document.fonts.load('700 20px Gaegu').catch(() => {});
  const tourCursor = makeCursor(ui);
  const tourModel = integrate(loadAt, DURATION + 1);
  const live = liveModel(0.12);

  // ------------------------------------------------------------ quality tiers and fitting the 1600 x 900 stage
  const TIERS = [
    {samples: 8, ao: true, pr: 2},
    {samples: 4, ao: false, pr: 1.5},
    {samples: 2, ao: false, pr: 1},
  ];
  const light = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
  let tier = light ? 2 : 0;
  let scale = 1;
  const fit = () => {
    scale = Math.min(innerWidth / W, innerHeight / H);
    app.style.transform = `translate(${(innerWidth - W * scale) / 2}px, ${(innerHeight - H * scale) / 2}px) scale(${scale})`;
    st.resize(W, H, clamp((devicePixelRatio || 1) * scale, 0.75, TIERS[tier].pr));
  };
  const applyTier = () => {
    const {pr, ...q} = TIERS[tier];
    st.setQuality(q);
    fit();
  };
  applyTier();
  addEventListener('resize', fit);
  const toStage = (cx, cy) => {
    const r = app.getBoundingClientRect();
    return [(cx - r.left) / scale, (cy - r.top) / scale];
  };
  const chip = document.createElement('div');
  chip.className = 'tourchip';
  ui.root.appendChild(chip);

  // ------------------------------------------------------------ state
  let T = 0;
  let L = 0.12;
  let view = 'overview';
  let prevView = 'overview';
  let viewT = -9;
  const tog = {air: 1, labels: 1};
  const off = {az: 0, el: 0, k: 1};
  let ring = {t: -9, x: 0, y: 0};
  const pulse = (x, y) => (ring = {t: T, x, y});
  const AP = {on: true, t0: 0};
  let lastInput = 0;
  const startTour = () => {
    AP.on = true;
    AP.t0 = T;
    Object.assign(off, {az: 0, el: 0, k: 1});
  };
  const takeOver = () => {
    lastInput = T;
    if (!AP.on) return;
    AP.on = false;
    const cyc = (T - AP.t0) % DURATION;
    const [t0, v] = viewAt(cyc);
    view = prevView = v;
    viewT = T - (cyc - t0) - 2;
    L = loadAt(cyc);
    tog.air = opsAt(cyc).air > 0.5 ? 1 : 0;
  };
  chip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    lastInput = T;
    if (AP.on) takeOver();
    else startTour();
  });
  addEventListener('pointerdown', (e) => {
    if (e.target !== chip) takeOver();
  });
  addEventListener('keydown', () => takeOver());

  for (const [k] of VIEWS)
    ui.btn[k].addEventListener('click', () => {
      takeOver();
      pulse(...ui.spots[k]);
      if (k === view) return;
      prevView = view;
      view = k;
      viewT = T;
      Object.assign(off, {az: 0, el: 0, k: 1});
      if (k === 'lid') tog.air = 1;
    });
  for (const [k] of TOGGLES)
    ui.btn[k].addEventListener('click', () => {
      takeOver();
      pulse(...ui.spots[k]);
      tog[k] = tog[k] ? 0 : 1;
    });
  // the workload slider: drag along its track
  {
    const [x0, y] = ui.sliderAt(0);
    const [x1] = ui.sliderAt(1);
    const d = document.createElement('div');
    d.className = 'hit';
    Object.assign(d.style, {left: `${x0 - 14}px`, top: `${y - 14}px`, width: `${x1 - x0 + 28}px`, height: '28px'});
    const set = (e) => {
      const [sx] = toStage(e.clientX, e.clientY);
      L = clamp((sx - x0) / (x1 - x0), 0, 1);
    };
    d.addEventListener('pointerdown', (e) => {
      takeOver();
      d.setPointerCapture(e.pointerId);
      set(e);
      d.onpointermove = set;
    });
    d.addEventListener('pointerup', () => (d.onpointermove = null));
    ui.root.appendChild(d);
  }
  // orbit and zoom
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = {x: e.clientX, y: e.clientY, az: off.az, el: off.el};
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    lastInput = T;
    off.az = drag.az - ((e.clientX - drag.x) / scale) * 0.25;
    off.el = clamp(drag.el + ((e.clientY - drag.y) / scale) * 0.18, -25, 50);
  });
  const endDrag = () => {
    drag = null;
    canvas.classList.remove('drag');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      takeOver();
      off.k = clamp(off.k * Math.exp(e.deltaY * 0.0012), 0.45, 2.2);
    },
    {passive: false},
  );

  // ------------------------------------------------------------ the frame
  await warmComposer(st.renderer, st.composer, st.scene, st.camera).catch(() => {});
  let last = performance.now();
  let slow = 0;
  const frame = (now) => {
    const dt = clamp((now - last) / 1000, 0, 0.1);
    last = now;
    T += dt;
    if (!AP.on && T - lastInput > IDLE) startTour();
    // drop a quality tier when frames run long for a while
    slow = dt > 1 / 40 ? slow + dt : Math.max(0, slow - dt * 0.5);
    if (slow > 2 && tier < TIERS.length - 1) {
      tier++;
      slow = 0;
      applyTier();
    }
    let r, cam, ops, cursor, cap, capO, v, since;
    if (AP.on) {
      const t = (T - AP.t0) % DURATION;
      const [t0, vv] = viewAt(t);
      v = vv;
      since = t - t0;
      r = tourModel.read(t);
      cam = camAt(t);
      ops = opsAt(t);
      cursor = tourCursor(t);
      ({caption: cap, capO} = captionAt(t));
      live.step(dt, r.L); // keep the live model warm so a hand-over doesn't jump
      L = r.L;
    } else {
      live.step(dt, L);
      r = live.read();
      v = view;
      since = T - viewT;
      const k = ss(0, 1.5, since);
      const a = VIEW_FN[prevView](since + 6);
      const b = VIEW_FN[view](since);
      cam = {};
      for (const key in b) cam[key] = key === 'az' ? a.az + ((((b.az - a.az + 540) % 360) - 180) * k) : a[key] + (b[key] - a[key]) * k;
      const o = blendOps(OPS[prevView], OPS[view], ss(0.2, 1.4, since));
      ops = {...o, air: (view === 'cpu' || view === 'exploded' ? 0 : tog.air) * (o.lid ?? 0)};
      cursor = null;
      cap = CAPTION[view];
      capO = ss(0.3, 0.7, since);
    }
    cam = {...cam, az: (cam.az + off.az) * D2R, el: clamp(cam.el + off.el, -10, 80) * D2R, d: cam.d * off.k};
    st.frame(r, cam, ops);
    const vis = ss(1.3, 1.9, since) * (AP.on || tog.labels ? 1 : 0);
    const callouts = (CALLOUTS[v] || []).map((c) => {
      const p = st.eng.anchor(c.a);
      return {name: c.name, sub: c.sub, label: c.label, at: st.project(p.x, p.y, p.z), o: vis};
    });
    const hist = [];
    if (AP.on) for (let i = 0; i < 60; i++) hist.push(tourModel.read(Math.max(0, (T - AP.t0) % DURATION - 20 + (i / 59) * 20)));
    else {
      if (T - lastHist > 1 / 3 || !histBuf.length) {
        lastHist = T;
        histBuf.push(r);
        if (histBuf.length > 60) histBuf.shift();
      }
      hist.push(...histBuf, r);
    }
    const ringK = 1 - (T - ring.t) / 0.55;
    ui.update({r, hist, view: v, caption: cap, capO, callouts, toggles: AP.on ? {air: ops.air > 0.5, labels: 1} : tog, cursor: cursor || (ringK > 0 ? {x: -99, y: -99, press: false, ring: ringK, ringX: ring.x, ringY: ring.y} : null)});
    chip.className = `tourchip${AP.on ? ' on' : ''}`;
    chip.innerHTML = AP.on ? '<i></i>Auto tour · click anywhere to take over' : '<i></i>Your turn · click to resume the tour';
    requestAnimationFrame(frame);
  };
  const histBuf = [];
  let lastHist = 0;
  requestAnimationFrame(frame);
}
