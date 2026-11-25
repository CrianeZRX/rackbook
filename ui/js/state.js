// Shared state: servers, live data, prefs; plus derived helpers (health, alerts, ship class).
import { invoke, listen } from './api.js';
import * as F from './fmt.js';
import { setLang, tr, getLang } from './i18n.js';

export const S = {
  servers: [],
  live: {},
  prefs: {},
  backgrounded: false,
  pane: 'fleet',          // 'fleet' | 'settings' | server id
  tab: 'teardown',
  status: { text: '欢迎登舰。点左下角「＋ 新舰船」，记下第一艘。', tone: 'info' },
};

const subs = new Set();
let queued = false;
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
export function changed(what = 'data') {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; subs.forEach((f) => f(what)); });
}

export function say(text, tone = 'info') {
  S.status = { text, tone };
  subs.forEach((f) => f('status'));
}

export async function boot() {
  const st = await invoke('get_state');
  S.servers = st.servers || [];
  S.live = st.live || {};
  S.prefs = st.prefs || {};
  S.backgrounded = st.backgrounded;
  let saved = null; try { saved = localStorage.getItem('rackbook.lang'); } catch {}
  setLang(S.prefs.lang || saved || '');
  if (!S.prefs.lang) { S.prefs.lang = getLang(); invoke('set_prefs', { prefs: S.prefs }); }
  if (S.servers.length) S.status = { text: `正在呼叫 ${S.servers.filter((s) => !s.paused).length} 艘舰船…`, tone: 'info' };
  await listen('live', ({ id, live }) => { S.live[id] = live; record(id, live.snap); changed('live'); });
  Object.entries(S.live).forEach(([id, l]) => record(id, l.snap));
  await listen('servers', (list) => { S.servers = list; changed('servers'); });
  await listen('prefs', (p) => { const relang = p.lang && p.lang !== getLang(); S.prefs = p; if (relang) location.reload(); else changed('prefs'); });
  await listen('status', ({ text, tone }) => say(text, tone));
}

export const server = (id) => S.servers.find((s) => s.id === id);
export const liveOf = (id) => S.live[id] || { phase: 'idle', snap: null, hist: {}, error: '' };
export const active = (cfg) => cfg?.accounts?.find((a) => a.id === cfg.activeAccount) || cfg?.accounts?.[0];
export const title = (cfg) => (cfg?.name?.trim() ? cfg.name : cfg?.host || '');
export const display = (cfg) => { const a = active(cfg); return `${a?.user ? a.user + '@' : ''}${cfg.host}${cfg.port !== 22 ? ':' + cfg.port : ''}`; };
export const privilege = (id) => active(server(id))?.privilege || 'unknown';
export const canSudo = (p) => p === 'root' || p === 'nopasswd' || p === 'password';
export const isCaptain = (p) => canSudo(p) || p === 'needsPassword';
export const roleName = (p) => (p === 'unknown' ? '待查验' : p === 'none' ? '领航员' : '舰长');
export const privDetail = (p) => ({
  unknown: '还没登舰查验过权限', root: 'root：拥有全部权限', nopasswd: '免密 sudo', password: 'sudo（密码存在凭据管理器）',
  needsPassword: '在 sudo 组，但还没存可用的 sudo 密码', none: '没有 sudo 权限，只能查看和管理自己的东西',
}[p] || '');

export const memFrac = (s) => (s && s.memTotal > 0 ? s.memUsed / s.memTotal : 0);
export const mountFrac = (m) => (m.used + m.avail > 0 ? m.used / (m.used + m.avail) : 0);
export const worstDisk = (s) => (s?.mounts || []).reduce((w, m) => (!w || mountFrac(m) > mountFrac(w) ? m : w), null);
export const gpuUtil = (s) => (s?.gpus?.length ? s.gpus.reduce((a, g) => a + g.util, 0) / s.gpus.length : 0);
export const loadText = (s) => [0, 1, 2].map((i) => F.num(s?.load?.[i] ?? 0)).join(' / ');

export function health(l) {
  if (!l) return 'unknown';
  if (l.phase === 'parked') return 'parked';
  if (l.phase === 'offline') return 'down';
  const s = l.snap;
  if (!s) return 'unknown';
  const d = worstDisk(s) ? mountFrac(worstDisk(s)) : 0;
  if (s.cpu > 90 || memFrac(s) > 0.92 || d > 0.92) return 'hot';
  if (s.cpu > 70 || memFrac(s) > 0.8 || d > 0.85) return 'warn';
  return 'ok';
}
export const healthLabel = { unknown: '等待', ok: '从容', warn: '忙碌', hot: '吃紧', down: '失联', parked: '停泊' };
export const healthColor = { unknown: '#c6ccce', ok: '#93d3b0', warn: '#f4b829', hot: '#ef6a4c', down: '#e3e0d2', parked: '#c6ccce' };

export function alerts(l) {
  const s = l?.snap;
  if (!s || l.phase !== 'online') return [];
  const a = [];
  if (s.cpu > 90) a.push(`CPU 吃紧 ${F.pct(s.cpu)}`);
  if (memFrac(s) > 0.92) a.push(`内存吃紧 ${F.pct(memFrac(s) * 100)}`);
  for (const m of s.mounts) if (mountFrac(m) > 0.9) a.push(`${m.mount} 已用 ${F.pct(mountFrac(m) * 100)}`);
  if (s.swapTotal > 0 && s.swapUsed / s.swapTotal > 0.5) a.push(`swap 已用 ${F.pct(s.swapUsed / s.swapTotal * 100)}`);
  return a;
}
export function phaseText(l) {
  switch (l?.phase) {
    case 'online': return '在航';
    case 'connecting': return '正在呼叫…';
    case 'offline': return `失联 · ${l.error || ''}`;
    case 'parked': return '已断开 · 停泊中（点「接通」重新连接）';
    default: return '等待连接…';
  }
}

export function shipClass(s) {
  if (!s) return { key: 'frigate', name: '护卫舰', size: 0.9, engines: 2 };
  const gb = s.memTotal / 2 ** 30;
  if (s.cores >= 32 || gb >= 128) return { key: 'carrier', name: '母舰', size: 1.35, engines: 3 };
  if (s.cores >= 9 || gb >= 24) return { key: 'cruiser', name: '巡洋舰', size: 1.1, engines: 2 };
  if (s.cores >= 3 || gb >= 4) return { key: 'frigate', name: '护卫舰', size: 0.9, engines: 2 };
  return { key: 'scout', name: '侦察艇', size: 0.72, engines: 1 };
}

export const onlineCount = () => S.servers.filter((s) => liveOf(s.id).phase === 'online').length;
export const alertTotal = () => S.servers.reduce((n, s) => n + alerts(liveOf(s.id)).length + (liveOf(s.id).phase === 'offline' ? 1 : 0), 0);

// ---------- client-side history the backend doesn't keep: each GPU, and each user's share ----------
// ext(id) = { t: last snapshot time, gpu: { index: { util:[], mem:[], temp:[], power:[] } }, users: [{ name: cores }] }
const EXT = {};
const CAP = 150;
const push = (a, v) => { a.push(v); if (a.length > CAP) a.shift(); };
export const ext = (id) => EXT[id] || (EXT[id] = { t: 0, gpu: {}, users: [] });
function record(id, snap) {
  if (!snap) return;
  const e = ext(id);
  if (snap.time === e.t) return;
  e.t = snap.time;
  for (const g of snap.gpus || []) {
    const h = e.gpu[g.index] || (e.gpu[g.index] = { util: [], mem: [], temp: [], power: [] });
    push(h.util, g.util);
    push(h.mem, g.memTotal > 0 ? (g.memUsed / g.memTotal) * 100 : 0);
    push(h.temp, g.temp ?? 0);
    push(h.power, g.power ?? 0);
  }
  if (snap.users) push(e.users, Object.fromEntries(snap.users.map((u) => [u.user, u.cores])));
}
