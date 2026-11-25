// The floating panel: shown only while the app runs in the background. Drag anywhere to move it.
import { invoke, listen, currentWindow, isTauri } from './api.js';
import { S, liveOf, health, healthLabel, title, alerts, memFrac, worstDisk, mountFrac, gpuUtil, loadText, phaseText, onlineCount } from './state.js';
import { meter, dot, delegate } from './ui.js';
import { miniShip } from './ships.js';
import { C, paperTooth, sketchAll } from './kit.js';
import { setLang, startDomTranslation, getLang } from './i18n.js';
import * as F from './fmt.js';
import { esc } from './fmt.js';

const card = document.getElementById('floatcard');
const menu = document.getElementById('fmenu');

function metricRow(m, s) {
  switch (m) {
    case 'cpu': return meter('CPU', s.cpu / 100, F.pct(s.cpu));
    case 'mem': return meter('MEM', memFrac(s), F.pct(memFrac(s) * 100));
    case 'disk': { const w = worstDisk(s); return meter('DISK', w ? mountFrac(w) : 0, F.pct((w ? mountFrac(w) : 0) * 100)); }
    case 'gpu': return s.gpus.length ? meter('GPU', gpuUtil(s) / 100, F.pct(gpuUtil(s)), C.pink) : '';
    case 'net': return `<div class="row mono" style="font-size:10px"><span>↓ ${F.rate(s.rxRate)}</span><span class="spacer"></span><span>↑ ${F.rate(s.txRate)}</span></div>`;
    case 'load': return `<div class="mono" style="font-size:10px">负载 ${loadText(s)}</div>`;
  }
  return '';
}

function render() {
  const p = S.prefs;
  const ships = S.servers.filter((s) => (!p.floatServers?.length || p.floatServers.includes(s.id)) &&
    (!p.floatAlertsOnly || alerts(liveOf(s.id)).length || liveOf(s.id).phase === 'offline'));
  card.style.width = (p.floatMode === 'ships' ? 310 : 280) + 'px';
  card.style.backgroundColor = `rgba(248,243,230,${p.floatOpacity ?? 0.96})`;
  card.style.boxShadow = `4px 4px 0 rgba(93,108,156,${0.14 * (p.floatOpacity ?? 0.96)})`;
  card.innerHTML = `<div class="row base"><span class="kicker" style="font-size:12px">RACKBOOK · 舰队简报</span><span class="spacer"></span><span class="mono muted" style="font-size:10px">${onlineCount()}/${S.servers.length} 在航</span></div>
    <div class="rule-h" style="height:4px;margin:4px 0 6px" data-width="1"></div>
    ${!ships.length ? `<div class="muted" style="font-size:14px">${p.floatAlertsOnly ? '一切从容，没有需要留意的舰船。' : '悬浮窗里没有选中的舰船。'}</div>` : ''}
    ${ships.map((s) => {
      const l = liveOf(s.id), hl = health(l), sn = l.snap;
      return `<div class="row top" data-id="${s.id}" style="gap:8px;padding:3px 0">
        ${p.floatMode === 'ships' ? `<canvas class="ship" data-id="${s.id}" style="width:58px;height:40px;flex:none"></canvas>` : `<span style="margin-top:4px">${dot(hl, 11)}</span>`}
        <div class="col grow" style="gap:2px;min-width:0">
          <div class="row base"><b data-notr style="font-size:15px;${hl === 'hot' ? 'color:#c8372f' : ''}">${esc(title(s))}</b><span class="spacer"></span><span class="muted" style="font-size:11px">${healthLabel[hl]}</span></div>
          ${sn && l.phase === 'online' ? (p.floatMetrics || []).map((m) => metricRow(m, sn)).join('') + alerts(l).slice(0, 2).map((a) => `<div class="red" style="font-weight:700;font-size:12px">● ${esc(a)}</div>`).join('')
            : `<div class="${l.phase === 'offline' ? 'red' : 'muted'}" style="font-size:12px">${esc(phaseText(l))}</div>`}
        </div></div>`;
    }).join('')}
    <div class="muted" style="font-size:11px;margin-top:4px">拖动可移动 · 双击登舰 · 右键设置</div>`;
  card.querySelectorAll('canvas.ship').forEach((cv) => miniShip(cv, S.servers.find((x) => x.id === cv.dataset.id), liveOf(cv.dataset.id)));
  sketchAll(card);
  requestAnimationFrame(() => {
    const r = card.getBoundingClientRect();
    invoke('float_resize', { width: Math.ceil(r.width + 16), height: Math.ceil(r.height + 16) });
  });
}

// drag after a 3 px threshold, so double-click and right-click still work
let down = null;
card.addEventListener('mousedown', (e) => { if (e.button === 0) down = { x: e.screenX, y: e.screenY }; });
window.addEventListener('mousemove', (e) => {
  if (!down || !(e.buttons & 1)) { down = null; return; }
  if (Math.hypot(e.screenX - down.x, e.screenY - down.y) > 3) { down = null; currentWindow()?.startDragging(); }
});
window.addEventListener('mouseup', () => { down = null; });
card.addEventListener('dblclick', (e) => {
  const row = e.target.closest('[data-id]');
  invoke('show_main', { server: row ? row.dataset.id : null });
});
card.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  menu.innerHTML = ['打开主窗口', '悬浮窗设置…', '隐藏悬浮窗'].map((l, i) => `<div class="menu-item" data-act="m${i}">${l}</div>`).join('');
  menu.classList.remove('hidden');
  menu.style.left = Math.min(e.clientX, 120) + 'px'; menu.style.top = e.clientY + 'px';
  invoke('float_resize', { width: Math.max(card.offsetWidth + 16, 300), height: Math.max(card.offsetHeight + 16, e.clientY + 130) });
});
document.addEventListener('mousedown', (e) => { if (!menu.contains(e.target)) menu.classList.add('hidden'); });
delegate(menu, {
  m0: () => { menu.classList.add('hidden'); invoke('show_main', { server: null }); },
  m1: () => { menu.classList.add('hidden'); invoke('show_main', { server: 'settings' }); },
  m2: () => { menu.classList.add('hidden'); invoke('set_prefs', { prefs: { ...S.prefs, floatEnabled: false } }); },
});

async function main() {
  const st = await invoke('get_state');
  S.servers = st.servers || []; S.live = st.live || {}; S.prefs = st.prefs || {};
  setLang(S.prefs.lang || localStorage.getItem('rackbook.lang') || '');
  startDomTranslation();
  let queued = false;
  const later = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; render(); }, 250); };
  await listen('live', ({ id, live }) => { S.live[id] = live; later(); });
  await listen('servers', (l) => { S.servers = l; later(); });
  await listen('prefs', (p) => { const relang = p.lang && p.lang !== getLang(); S.prefs = p; if (relang) location.reload(); else later(); });
  document.fonts?.addEventListener?.('loadingdone', later);
  render();
}
if (!isTauri) document.body.style.background = '#ddd';
main();
