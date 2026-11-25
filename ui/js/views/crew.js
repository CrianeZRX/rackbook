import { invoke } from '../api.js';
import { say, server, liveOf, privilege, canSudo, isCaptain, roleName, privDetail, active } from '../state.js';
import { card, btn, badge, delegate, confirm, modal, titleBlock } from '../ui.js';
import { date, esc, shq } from '../fmt.js';
import { CREW_STATUS, INACTIVE_DAYS, readCrew } from '../crew-status.js';
import { crewPortrait, drawCrewCabin } from '../rockets.js';

const SCALES = [75, 100, 125, 150];
const STATUS_ORDER = ['online', 'offline', 'inactive', 'unknown'];
const currentTag = '<span class="crew-current">★ 当前用户</span>';
const statusTag = (status) => `<span class="crew-state ${status}"><i aria-hidden="true"></i>${CREW_STATUS[status === 'inactive' ? 'offline' : status]}</span>`;
const inactiveTag = '<strong class="crew-inactive">长期不活跃</strong>';

export function mount(el, { id, editServer }) {
  let roster = null, loading = false, error = '', request = 0, context, destroyed = false;
  let zoom = 1, query = '', status = '';
  el.innerHTML = `<div class="page crew-page">
    <div class="card sk crew-roster">
      <div class="head"><span class="kicker">Crew manifest</span><span class="h">舰上的船员（服务器账户）</span></div>
      <div class="crew-toolbar">
        <input class="field sk" id="crew-query" type="search" placeholder="搜索船员…" aria-label="搜索船员…">
        <select class="field sk" id="crew-filter" aria-label="筛选登录状态"><option value="">全部状态</option>
          ${STATUS_ORDER.map((key) => `<option value="${key}">${CREW_STATUS[key]}</option>`).join('')}
        </select>
        <div class="crew-zoom" role="group" aria-label="缩放船员卡片">
          ${btn('−', { act: 'zoom', cls: 'chip', data: 'data-step="-1" aria-label="缩小船员卡片"' })}
          <output id="crew-scale" class="mono"></output>
          ${btn('+', { act: 'zoom', cls: 'chip', data: 'data-step="1" aria-label="放大船员卡片"' })}
        </div>
        ${btn('↻ 读取', { act: 'load', cls: 'chip' })}
      </div>
      <div id="crew-notice" class="muted small" role="status"></div>
      <div id="crew-groups" class="col"></div>
      <div class="foot crew-notes">没有运行进程的船员显示为离线。离线且上次登录已满 ${INACTIVE_DAYS} 天，会标为长期不活跃。</div>
    </div>
    <aside id="accts"></aside>
  </div>`;
  const find = (selector) => el.querySelector(selector);
  const groups = find('#crew-groups');
  const notice = find('#crew-notice');
  const loadButton = find('[data-act="load"]');
  const accountPanel = find('#accts');
  const cabinResize = new ResizeObserver((entries) => {
    for (const { target } of entries) drawCrewCabin(target, target.dataset.cabin === 'command');
  });
  let groupHtml, accountHtml;

  const setZoom = () => {
    const scale = SCALES[zoom] / 100;
    groups.style.setProperty('--crew-size', `${145 * scale}px`);
    groups.style.setProperty('--crew-art', `${108 * scale}px`);
    find('#crew-scale').value = `${SCALES[zoom]}%`;
    find('[data-step="-1"]').disabled = zoom === 0;
    find('[data-step="1"]').disabled = zoom === SCALES.length - 1;
  };

  const tile = (user, login) => {
    const isCurrent = user.name === login;
    return `<button class="crew-tile${isCurrent ? ' current' : ''}" data-act="member" data-u="${esc(user.name)}">
      <span class="crew-tile-top">${isCurrent ? currentTag : ''}</span>
      <img class="crew-portrait" src="${crewPortrait(user.status, user.captain)}" alt="">
      <b class="mono crew-name" data-notr title="${esc(user.name)}">${esc(user.name)}</b>
      <span class="crew-tile-state">${statusTag(user.status)}${user.status === 'inactive' ? inactiveTag : ''}</span>
    </button>`;
  };

  const renderRoster = () => {
    const users = (roster?.users || []).map((u) => u.name === roster.login && isCaptain(privilege(id)) ? { ...u, captain: true } : u);
    const shown = users.filter((u) => (!status || u.status === status || (status === 'offline' && u.status === 'inactive')) && u.name.toLowerCase().includes(query));
    const sorted = (list) => list.sort((a, b) => Number(b.name === roster.login) - Number(a.name === roster.login)
      || STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.uid - b.uid);
    const section = (label, list, kind) => list.length ? `<section class="crew-section sk ${kind}">
      <div class="crew-section-head"><h3>${label}</h3><span class="mono muted small">${list.length}</span></div>
      <canvas class="crew-cabin" data-cabin="${kind}" aria-hidden="true"></canvas>
      <div class="crew-grid">${sorted(list).map((u) => tile(u, roster.login)).join('')}</div>
    </section>` : '';

    const markup = section('★ 指挥舱 · 舰长', shown.filter((u) => u.captain), 'command')
      + section('✦ 乘员舱 · 领航员', shown.filter((u) => !u.captain), 'quarters');
    const focused = groups.contains(document.activeElement) ? document.activeElement.dataset.u : undefined;
    if (markup !== groupHtml) {
      cabinResize.disconnect();
      groups.innerHTML = groupHtml = markup;
      for (const canvas of groups.querySelectorAll('.crew-cabin')) cabinResize.observe(canvas);
      if (focused) [...groups.querySelectorAll('[data-u]')].find((el) => el.dataset.u === focused)?.focus({ preventScroll: true });
    }
    const online = liveOf(id).phase === 'online';
    loadButton.disabled = !online || loading;
    const message = loading && !roster ? '读取中…'
      : !online ? '接通以后才能读取船员名单。'
      : error || (!roster ? '点「读取」列出船员。' : !shown.length ? '没有符合条件的船员。' : '');
    if (notice.dataset.message !== message) {
      notice.textContent = message;
      notice.dataset.message = message;
    }
    notice.hidden = !message;
    return users;
  };

  const renderAccounts = () => {
    const cfg = server(id);
    if (!cfg) return;
    const markup = card(cfg.accounts.map((a) => {
      const on = a.id === active(cfg)?.id;
      return `<div class="crew-account${on ? ' on' : ''}">
        <div class="crew-account-head">${badge(a.privilege)}${on ? currentTag : ''}</div>
        <b class="crew-account-name" data-notr>${esc(a.label || a.user)}</b>
        <div class="muted small"><span class="mono" data-notr>${esc(a.user)}</span> · ${a.auth === 'password' ? '密码登录' : a.keyPath ? '私钥' : '默认私钥'}</div>
        ${a.keyPath && a.auth !== 'password' ? `<div class="mono muted small" data-notr>${esc(a.keyPath)}</div>` : ''}
        <div class="muted small">${esc(privDetail(a.privilege))}${a.hasSudoPassword ? ' · 凭据管理器里有 sudo 密码' : ''}</div>
        <div class="row">${on ? btn('重新查验权限', { act: 'probe', cls: 'chip' }) : btn('以此登舰', { act: 'use', cls: 'chip', data: `data-a="${esc(a.id)}"` })}${btn(a.hasSudoPassword ? '改 sudo 密码…' : '存 sudo 密码…', { act: 'pw', cls: 'chip', data: `data-a="${esc(a.id)}"` })}</div>
      </div>`;
    }).join('') + btn('＋ 添加 / 编辑账户…', { act: 'edit' }) +
      '<p class="foot">角色按 sudo / wheel / admin 组判断；通过 /etc/sudoers 单独授权的账户这里看不出来。</p>',
    { kicker: 'Boarding accounts', title: '登舰账户（这台电脑上）' });
    if (markup !== accountHtml) accountPanel.innerHTML = accountHtml = markup;
  };

  const load = async (report = false) => {
    if (loading || liveOf(id).phase !== 'online') return;
    const token = ++request;
    loading = true; error = ''; renderRoster();
    try {
      const result = await readCrew(id);
      if (destroyed || token !== request) return;
      roster = result;
      if (report) {
        const captains = result.users.filter((u) => u.captain || (u.name === result.login && isCaptain(privilege(id)))).length;
        say(`船员名单：${result.users.length} 人，其中舰长 ${captains} 人、领航员 ${result.users.length - captains} 人。`);
      }
    } catch (e) {
      if (destroyed || token !== request) return;
      roster = null;
      error = '没读到船员名单：' + e.message;
    } finally {
      if (!destroyed && token === request) { loading = false; renderRoster(); }
    }
  };

  const update = () => {
    const online = liveOf(id).phase === 'online';
    const next = online ? active(server(id))?.id || '' : null;
    if (context !== next) {
      context = next;
      ++request;
      roster = null; loading = false; error = '';
      if (online) load();
    }
    renderAccounts();
    renderRoster();
  };

  const showMember = async (button) => {
    const user = renderRoster().find((u) => u.name === button.dataset.u);
    if (!user) return;
    const role = user.captain ? '舰长' : '领航员';
    const nonLogin = /(?:^|\/)(?:nologin|false)$/.test(user.shell);
    const action = (label, value, danger = false) => btn(label, { act: 'role', cls: 'chip' + (danger ? ' danger' : ''), data: `data-u="${esc(user.name)}" data-v="${value}"` });
    const actions = user.uid === 0 ? '' :
      (user.captain ? action('降为领航员', 'demote', true) : action('升为舰长', 'promote')) +
      (user.docker ? action('移出货舱', 'undock') : action('进入货舱', 'dock'));
    const accountAtOpen = context;
    await modal(`${titleBlock('Crew manifest', user.name, '', true)}
      <div class="crew-profile">
        <img class="crew-portrait" src="${crewPortrait(user.status, user.captain)}" alt="">
        <div class="col">
          <div class="row"><span class="badge ${user.captain ? 'cap' : 'nav'}">${user.captain ? '★' : '✦'} ${role}</span>${user.name === roster.login ? currentTag : ''}</div>
          <div class="row">${statusTag(user.status)}${user.status === 'inactive' ? inactiveTag : ''}</div>
          ${user.count != null ? `<div class="muted small">运行进程 ${user.count}</div>` : ''}
          ${user.last > 0 ? `<div class="muted small">最近登录 <span class="mono" data-notr>${date(user.last)}</span></div>` : ''}
          ${user.last === 0 ? '<div class="muted small">无登录记录</div>' : ''}
          <div class="mono small crew-path" data-notr>UID ${user.uid} · ${esc(user.home)} · ${esc(user.shell)}</div>
          <div class="row muted small">${user.docker ? '<span>· 货舱</span>' : ''}${nonLogin ? '<span>· 不能登录</span>' : ''}</div>
        </div>
      </div>
      <div class="row crew-profile-actions">${actions}<span class="spacer"></span>${btn('关闭', { act: 'close' })}</div>`,
    { width: 470, onMount: (sheet, close) => {
      sheet.querySelector('[data-act="close"]').focus();
      delegate(sheet, { close: () => close(), role: (b) => {
        close();
        if (!destroyed && context === accountAtOpen) changeRole(b);
      } });
    } });
    if (button.isConnected) button.focus({ preventScroll: true });
  };

  find('#crew-query').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); renderRoster(); });
  find('#crew-filter').addEventListener('change', (e) => { status = e.target.value; renderRoster(); });

  const labels = { promote: (u) => `把 ${u} 升为舰长（加入 sudo/wheel 组）`, demote: (u) => `把 ${u} 降为领航员（移出 sudo/wheel/admin 组）`, dock: (u) => `让 ${u} 进入货舱（加入 docker 组）`, undock: (u) => `让 ${u} 移出货舱（移出 docker 组）` };
  delegate(el, {
    load: () => load(true),
    zoom: (b) => { zoom = Math.max(0, Math.min(SCALES.length - 1, zoom + Number(b.dataset.step))); setZoom(); },
    member: (b) => showMember(b),
    edit: () => editServer(id),
    probe: () => { if (server(id).paused) { say('还不行：先接通再查验。', 'refuse'); return; } say('重新查验权限…'); invoke('reprobe', { id }); },
    use: (b) => invoke('switch_account', { id, account: b.dataset.a }),
    pw: async (b) => {
      const a = server(id).accounts.find((x) => x.id === b.dataset.a);
      const v = await modal(`${titleBlock('Credential Manager · 凭据管理器', `${a.label || a.user} 的 sudo 密码`, '只存在这台电脑的 Windows 凭据管理器里，用来让舰长执行 sudo')}
        <input type="password" class="field sk mono" id="pw" placeholder="sudo 密码">
        <div class="row">${a.hasSudoPassword ? btn('删除已存密码', { act: 'del', cls: 'danger' }) : ''}<span class="spacer"></span>${btn('取消', { act: 'no' })}${btn('存进凭据管理器', { act: 'yes', cls: 'solid' })}</div>`,
      { width: 500, onMount: (m, close) => { const i = m.querySelector('#pw'); i.focus(); i.addEventListener('keydown', (e) => e.key === 'Enter' && close(i.value)); delegate(m, { yes: () => close(i.value), no: () => close(null), del: () => close('') }); } });
      if (v === null) return;
      invoke('set_sudo_password', { id, account: a.id, value: v || null });
    },
  });

  const changeRole = async (b) => {
    const u = b.dataset.u, v = b.dataset.v, p = privilege(id), account = context;
    if (!canSudo(p)) { say(p === 'needsPassword' ? '还不行：先给舰长存一个 sudo 密码。' : '还不行：你现在是领航员，调整船员角色需要舰长。', 'refuse'); return; }
    if (v === 'demote' && u === active(server(id))?.user) { say('还不行：不能把正在登舰的自己降为领航员，否则会把自己锁在门外。换一个舰长账户再操作。', 'refuse'); return; }
    if ((v === 'dock' || v === 'undock') && !liveOf(id).snap?.hasDocker) { say('还不行：这艘船上没装 Docker。', 'refuse'); return; }
    if (!await confirm('调整船员角色？', `${labels[v](u)}。对方下次登录后生效。`, '确定调整')) return;
    if (destroyed || context !== account) return;
    const q = shq(u);
    const cmd = { promote: `if getent group sudo >/dev/null; then usermod -aG sudo ${q}; else usermod -aG wheel ${q}; fi`, demote: `for g in sudo wheel admin; do getent group $g >/dev/null && gpasswd -d ${q} $g >/dev/null 2>&1; done; true`, dock: `usermod -aG docker ${q}`, undock: `gpasswd -d ${q} docker` }[v];
    const r = await invoke('sudo', { id, cmd });
    if (r.code === 0) {
      say(`完成：${labels[v](u)}。`, 'ok');
      if (!destroyed && context === account) { loading = false; load(); }
    } else say('没成功：' + (r.err.trim() || `退出码 ${r.code}`), 'refuse');
  };

  setZoom(); update();
  const timer = setInterval(load, 30_000);
  return { update, destroy() { destroyed = true; clearInterval(timer); cabinResize.disconnect(); } };
}
