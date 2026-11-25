import { paperTooth, sketchAll, wash, WASHES } from './kit.js';
import { invoke, listen, isTauri, openDialog } from './api.js';
import { S, boot, onChange, changed, say, server, liveOf, active, title, display, health, phaseText, onlineCount, memFrac, roleName } from './state.js';
import { meter, dot, badge, btn, delegate, modal, confirm, check, titleBlock } from './ui.js';
import * as F from './fmt.js';
import { esc } from './fmt.js';
import * as fleet from './views/fleet.js';
import * as detail from './views/detail.js';
import * as settings from './views/settings.js';
import { startDomTranslation, LANGS, getLang } from './i18n.js';

let current = null;   // { pane, view }

function shell() {
  document.getElementById('app').innerHTML = `
    <aside id="sidebar">
      <div class="brand">
        <div class="kicker" style="font-size:12px">RACKBOOK · 机房手账</div>
        <div class="title">星际舰队</div>
        <div class="subtitle" style="font-size:14px">every server is a ship; you are its crew</div>
      </div>
      <div class="navrow sk" data-act="fleet" id="navFleet"></div>
      <div class="shiplist" id="ships"></div>
      <div class="sidefoot">
        ${btn('＋ 新舰船', { act: 'new', cls: 'solid' })}
        <div class="row">${btn('设置', { act: 'settings', cls: 'chip' })}<select id="langSel" class="field sk" style="width:auto;padding:2px 6px;font-size:14px" title="Language">${LANGS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select><span class="spacer"></span>${btn('转入后台', { act: 'bg', cls: 'chip', title: '关闭主窗口但继续监控；任务栏右下角出现舰船图标，可选弹出悬浮窗' })}</div>
      </div>
    </aside>
    <div id="rule" class="rule-v" data-width="1.4" data-seed="8"></div>
    <main id="main">
      <div id="view"></div>
      <div id="statusline"><div class="topline rule-h" data-seed="13"></div><span class="pin"></span><span class="text" id="stText"></span><span class="meta" id="stMeta"></span></div>
    </main>`;
  const ls = document.getElementById('langSel');
  ls.value = getLang();
  ls.addEventListener('change', () => setLanguage(ls.value));
  delegate(document.getElementById('sidebar'), {
    fleet: () => go('fleet'),
    new: () => editServer(null),
    settings: () => go('settings'),
    bg: () => goBackground(),
    ship: (el) => go(el.dataset.id),
  });
  document.getElementById('ships').addEventListener('contextmenu', (e) => {
    const el = e.target.closest('[data-id]'); if (!el) return;
    e.preventDefault(); shipMenu(el.dataset.id, e.clientX, e.clientY);
  });
}

export async function setLanguage(l) {
  S.prefs = { ...S.prefs, lang: l };
  try { localStorage.setItem('rackbook.lang', l); } catch {}
  await invoke('set_prefs', { prefs: S.prefs });
  location.reload();
}

export function goBackground() {
  if (!isTauri) { say('浏览器预览里没有后台模式；在 Windows 版里会隐藏主窗口并显示托盘图标。', 'refuse'); return; }
  invoke('go_background');
}

function renderSidebar() {
  const nf = document.getElementById('navFleet');
  nf.classList.toggle('on', S.pane === 'fleet');
  nf.classList.toggle('lit', S.pane === 'fleet');
  nf.innerHTML = `<span class="red" style="font-size:18px;font-weight:700">✦</span><div><div class="h" style="font-size:18px">星图 · 舰队总览</div><div class="mono muted" style="font-size:11px">${S.servers.length} 艘 · ${onlineCount()} 在航</div></div>`;
  document.getElementById('ships').innerHTML = S.servers.map((s, i) => {
    const l = liveOf(s.id), hl = health(l), sel = S.pane === s.id, a = active(s), sn = l.snap;
    const body = sn && l.phase === 'online'
      ? meter('CPU', sn.cpu / 100, F.pct(sn.cpu)) + meter('MEM', memFrac(sn), F.pct(memFrac(sn) * 100)) +
        `<div class="row mono muted" style="font-size:10px"><span>↓ ${F.rate(sn.rxRate)}</span><span class="spacer"></span><span>↑ ${F.rate(sn.txRate)}</span></div>`
      : `<div style="font-size:13px" class="${l.phase === 'offline' ? 'red' : 'muted'}">${esc(phaseText(l))}</div>`;
    return `<div class="shiprow sk${sel ? ' lit' : ''}" data-act="ship" data-id="${s.id}" style="background-color:${sel ? 'rgba(244,184,41,.3)' : 'transparent'};box-shadow:inset 0 0 0 999px ${wash(s.wash)}${sel ? '40' : '22'}">
      <div class="row">${dot(hl, 13)}<span class="name grow" data-notr>${esc(title(s))}</span><span class="mono red" style="font-size:10px">No.${i + 1}</span></div>
      <div class="row">${badge(a?.privilege || 'unknown', true)}<span class="mono muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(display(s))}</span></div>
      ${body}</div>`;
  }).join('');
}

function renderStatus() {
  const t = document.getElementById('stText');
  t.textContent = S.status.text;
  t.className = 'text ' + (S.status.tone || 'info');
  document.getElementById('stMeta').textContent = `${onlineCount()}/${S.servers.length} 在航 · ${F.clock()}`;
}

export function go(pane, tab) {
  if (pane !== 'fleet' && pane !== 'settings' && !server(pane)) pane = 'fleet';
  if (tab) S.tab = tab;
  const same = current && current.pane === pane;
  S.pane = pane;
  if (!same) {
    current?.view?.destroy?.();
    const el = document.getElementById('view');
    el.innerHTML = '';
    el.scrollTop = 0;
    const mod = pane === 'fleet' ? fleet : pane === 'settings' ? settings : detail;
    current = { pane, view: mod.mount(el, { go, editServer, id: pane }) };
    if (pane !== 'fleet' && pane !== 'settings') S.tab = tab || 'teardown';
  } else if (tab) {
    current.view?.update?.('tab');
  }
  renderSidebar();
  sketchAll();
}

function shipMenu(id, x, y) {
  const s = server(id); if (!s) return;
  document.querySelectorAll('.popover').forEach((p) => p.remove());
  const p = document.createElement('div');
  p.className = 'popover sk';
  p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.width = '200px';
  const items = [
    ['refresh', '立即刷新'], [s.paused ? 'connect' : 'disconnect', s.paused ? '接通' : '断开'], ['terminal', '在终端打开'], ['edit', '编辑…'],
    ['up', '上移'], ['down', '下移'], ['delete', '退出舰队…'],
  ];
  p.innerHTML = items.map(([a, l]) => `<div class="menu-item ${a === 'delete' ? 'red' : ''}" data-act="${a}">${l}</div>`).join('') +
    (s.accounts.length > 1 ? `<div class="kicker" style="margin-top:4px">切换登舰账户</div>` + s.accounts.map((a) => `<div class="menu-item" data-act="acct" data-a="${a.id}">${roleName(a.privilege)} · ${esc(a.label || a.user)}</div>`).join('') : '');
  document.body.appendChild(p);
  const close = () => p.remove();
  setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!p.contains(e.target)) { close(); document.removeEventListener('mousedown', off); } }));
  delegate(p, {
    refresh: () => { close(); invoke('refresh', { id }); },
    connect: () => { close(); invoke('connect', { id }); },
    disconnect: () => { close(); invoke('disconnect', { id }); },
    terminal: () => { close(); invoke('open_terminal', { id }); },
    edit: () => { close(); editServer(id); },
    up: () => { close(); invoke('move_server', { id, delta: -1 }); },
    down: () => { close(); invoke('move_server', { id, delta: 1 }); },
    delete: async () => {
      close();
      if (await confirm(`让「${title(s)}」退出舰队？`, '只从 Rackbook 里移除（连同凭据管理器里的密码），不会改动服务器本身。', '退出舰队')) invoke('delete_server', { id });
    },
    acct: (el) => { close(); invoke('switch_account', { id, account: el.dataset.a }); },
  });
}

// ---------------- server editor ----------------

function newAccount(n) {
  return { id: crypto.randomUUID(), label: n ? `账户 ${n}` : '', user: 'root', auth: 'key', keyPath: '', hasKeyPass: false, hasLoginPassword: false, hasSudoPassword: false, privilege: 'unknown' };
}

export async function editServer(id) {
  const orig = id ? server(id) : null;
  const d = orig ? JSON.parse(JSON.stringify(orig)) : { id: crypto.randomUUID(), name: '', host: '', port: 22, accounts: [newAccount(0)], activeAccount: null, wash: 'sky', interval: 3, paused: false };
  if (!d.activeAccount) d.activeAccount = d.accounts[0].id;
  const secrets = {};     // `${accountId}:${kind}` -> value ('' = delete)
  const isNew = !orig;

  const acctHtml = (a) => {
    const on = d.activeAccount === a.id;
    const pw = (kind, has, ph) => `<input type="password" class="field sk mono" data-sec="${a.id}:${kind}" placeholder="${esc(has ? '已存在凭据管理器（输入以替换）' : ph)}" value="${esc(secrets[`${a.id}:${kind}`] || '')}">`;
    return `<div class="card sk${on ? ' lit' : ''}" style="padding:12px;gap:8px;background-color:${on ? 'rgba(244,184,41,.15)' : 'rgba(255,253,246,.7)'}" data-acc="${a.id}">
      <div class="row">${btn(on ? '● 当前登舰' : '○ 设为当前', { act: 'useAcct', cls: 'chip' + (on ? ' active' : ''), data: `data-a="${a.id}"` })}${badge(a.privilege, true)}<span class="spacer"></span>${d.accounts.length > 1 ? btn('移除', { act: 'rmAcct', cls: 'chip danger', data: `data-a="${a.id}"` }) : ''}</div>
      <div class="row"><input class="field sk" style="width:170px" data-f="label" placeholder="称呼，例如 运维舰长" value="${esc(a.label)}"><input class="field sk mono" data-f="user" placeholder="用户名" value="${esc(a.user)}"></div>
      <div class="row"><b style="font-size:14px">登录方式</b>${btn('密钥', { act: 'auth', cls: 'chip' + (a.auth !== 'password' ? ' active' : ''), data: `data-a="${a.id}" data-v="key"` })}${btn('密码', { act: 'auth', cls: 'chip' + (a.auth === 'password' ? ' active' : ''), data: `data-a="${a.id}" data-v="password"` })}</div>
      ${a.auth === 'password'
        ? pw('login', a.hasLoginPassword, '登录密码（只存在 Windows 凭据管理器里）')
        : `<div class="row"><input class="field sk mono" data-f="keyPath" placeholder="私钥文件（留空 = 自动找 ~/.ssh/id_ed25519、id_rsa）" value="${esc(a.keyPath)}">${btn('选择…', { act: 'pickKey', cls: 'chip', data: `data-a="${a.id}"` })}</div>${pw('keypass', a.hasKeyPass, '私钥口令（没有就留空）')}`}
      ${pw('sudo', a.hasSudoPassword, a.auth === 'password' ? 'sudo 密码（留空 = 同登录密码）' : 'sudo 密码（可选，用于需要密码的 sudo）')}
    </div>`;
  };

  const render = (m) => {
    m.innerHTML = `
      ${titleBlock(isNew ? 'New ship · 新舰船入列' : "Ship's log · 修改", isNew ? '添加舰船（服务器）' : title(d), '内置 SSH：支持密钥、带口令的密钥和密码登录')}
      <div class="row"><b style="width:80px;text-align:right">舰名</b><input class="field sk" data-g="name" placeholder="例如 web-01" value="${esc(d.name)}"></div>
      <div class="row"><b style="width:80px;text-align:right">主机</b><input class="field sk mono" data-g="host" placeholder="IP 或域名" value="${esc(d.host)}"><b>端口</b><input class="field sk mono" style="width:90px" data-g="port" value="${d.port}"></div>
      <div class="row"><b style="width:80px;text-align:right">刷新间隔</b><input class="field sk mono" style="width:70px" data-g="interval" value="${d.interval}"><span>秒</span><span class="spacer"></span>${!isNew ? btn('忘记主机指纹', { act: 'forget', cls: 'chip', title: '服务器重装后指纹会变，确认无误再点' }) : ''}</div>
      <div class="row"><b style="width:80px;text-align:right">船体颜色</b>${WASHES.map((w) => `<span data-act="wash" data-w="${w}" style="cursor:pointer;width:22px;height:22px;border-radius:50%;background:${wash(w)};border:${d.wash === w ? '2.4px solid #c8372f' : '1px solid #231e16'}"></span>`).join('')}</div>
      <div class="row"><span class="kicker">登舰账户 · 角色</span><span class="spacer"></span>${btn('＋ 添加账户', { act: 'addAcct', cls: 'chip' })}</div>
      <div class="foot">角色按 sudo 权限自动判定：有 sudo 的是舰长，没有的是领航员。所有密码只存在 Windows 凭据管理器里。</div>
      ${d.accounts.map(acctHtml).join('')}
      <div id="testMsg" style="font-weight:700"></div>
      <div class="row">${btn('用当前账户测试', { act: 'test' })}<span class="spacer"></span>${btn('取消', { act: 'cancel' })}${btn(isNew ? '入列' : '保存', { act: 'save', cls: 'solid' })}</div>`;
    sketchAll(m);
  };

  const collect = (m) => {
    m.querySelectorAll('[data-g]').forEach((i) => { const k = i.dataset.g; d[k] = k === 'port' ? (parseInt(i.value) || 22) : k === 'interval' ? Math.max(1, parseFloat(i.value) || 3) : i.value.trim(); });
    m.querySelectorAll('[data-acc]').forEach((box) => {
      const a = d.accounts.find((x) => x.id === box.dataset.acc);
      box.querySelectorAll('[data-f]').forEach((i) => { a[i.dataset.f] = i.value.trim(); });
    });
    m.querySelectorAll('[data-sec]').forEach((i) => { if (i.value) secrets[i.dataset.sec] = i.value; });
  };
  const secretList = () => Object.entries(secrets).map(([k, v]) => { const [accountId, kind] = k.split(':'); return { accountId, kind, value: v }; });

  await modal('', {
    width: 760,
    onMount: (m, close) => {
      render(m);
      delegate(m, {
        cancel: () => close(),
        wash: (el) => { collect(m); d.wash = el.dataset.w; render(m); },
        addAcct: () => { collect(m); d.accounts.push(newAccount(d.accounts.length + 1)); render(m); },
        rmAcct: (el) => { collect(m); d.accounts = d.accounts.filter((a) => a.id !== el.dataset.a); if (!d.accounts.some((a) => a.id === d.activeAccount)) d.activeAccount = d.accounts[0].id; render(m); },
        useAcct: (el) => { collect(m); d.activeAccount = el.dataset.a; render(m); },
        auth: (el) => { collect(m); const a = d.accounts.find((x) => x.id === el.dataset.a); a.auth = el.dataset.v; a.privilege = 'unknown'; render(m); },
        pickKey: async (el) => {
          collect(m);
          const f = await openDialog({ multiple: false, directory: false, title: '选择私钥文件' });
          if (f) { d.accounts.find((x) => x.id === el.dataset.a).keyPath = f; render(m); }
        },
        forget: () => { invoke('forget_host_key', { host: d.host, port: d.port }); },
        test: async () => {
          collect(m);
          const out = m.querySelector('#testMsg');
          out.className = 'muted'; out.textContent = `正在呼叫 ${d.host}…`;
          try { const r = await invoke('test_connection', { cfg: d, secrets: secretList() }); out.className = 'okc'; out.textContent = '接通了：' + r; }
          catch (e) { out.className = 'red'; out.textContent = '没接通：' + e; }
        },
        save: async () => {
          collect(m);
          if (!d.host) { m.querySelector('#testMsg').innerHTML = '<span class="red">主机不能为空。</span>'; return; }
          if (!d.name) d.name = d.host;
          await invoke('save_server', { cfg: d, secrets: secretList() });
          close();
          go(d.id);
        },
      });
    },
  });
}

// ---------------- boot ----------------

async function main() {
  paperTooth();
  await boot();
  shell();
  startDomTranslation();
  // canvases draw text themselves: fetch the CJK font subsets they need, then redraw
  document.fonts?.addEventListener?.('loadingdone', () => changed('fonts'));
  onChange((what) => {
    if (what === 'status') { renderStatus(); return; }
    renderSidebar();
    renderStatus();
    if (current && current.pane !== 'fleet' && current.pane !== 'settings' && !server(current.pane)) go('fleet');
    else current?.view?.update?.(what);
  });
  await listen('navigate', ({ server: sid }) => { if (sid) go(sid); });
  go('fleet');
  renderStatus();
  setInterval(renderStatus, 1000);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); editServer(null); }
    if (e.ctrlKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) { e.preventDefault(); goBackground(); }
    if (e.ctrlKey && e.key === '0') { e.preventDefault(); go('fleet'); }
    if (e.ctrlKey && e.key === ',') { e.preventDefault(); go('settings'); }
  });
  if (!isTauri) say('浏览器预览：这是一个虚构的舰队，用来看界面。', 'info');
}
main();
