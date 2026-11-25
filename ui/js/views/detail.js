import { invoke } from '../api.js';
import { S, say, server, liveOf, health, healthLabel, title, display, active, phaseText, shipClass, privilege, roleName, privDetail } from '../state.js';
import { titleBlock, btn, dot, badge, delegate, popover } from '../ui.js';
import { sketchAll } from '../kit.js';
import { esc } from '../fmt.js';
import * as F from '../fmt.js';
import * as teardownTab from './tab_teardown.js';
import * as procsTab from './procs.js';
import * as dockerTab from './docker.js';
import * as filesTab from './files.js';
import * as consoleTab from './console.js';
import * as crewTab from './crew.js';

const TABS = [
  ['teardown', '拆解图', teardownTab, false],
  ['procs', '进程 · 服务', procsTab, true],
  ['docker', 'Docker 货舱', dockerTab, true],
  ['files', '文件', filesTab, true],
  ['console', '命令', consoleTab, true],
  ['crew', '船员 · 权限', crewTab, false],
];

export function mount(el, { id, editServer }) {
  el.innerHTML = `<div style="display:flex;flex-direction:column;min-height:100%">
    <div id="dhead" class="row" style="align-items:flex-end;padding:26px 28px 12px;gap:14px"></div>
    <div class="tabs" id="dtabs"></div>
    <div id="dbody" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>
  </div>`;
  let sub = null, subKey = null;

  const head = () => {
    const cfg = server(id); if (!cfg) return;
    const l = liveOf(id), s = l.snap, hl = health(l), a = active(cfg);
    const subt = s ? `${s.os || s.kernel} · 内核 ${s.kernel} · ${s.cores} 核 · ${shipClass(s).name} · 已运行 ${F.uptime(s.uptime)}` : phaseText(l);
    const idx = S.servers.findIndex((x) => x.id === id) + 1;
    el.querySelector('#dhead').innerHTML = `
      <div class="grow">${titleBlock(`Sheet No.${idx} · ${display(cfg)}`, title(cfg), subt, true)}</div>
      <div class="row">${dot(hl, 14)}<b style="font-size:16px">${healthLabel[hl]}</b>${l.lastUpdate ? `<span class="mono muted" style="font-size:11px">· ${F.clock(new Date(l.lastUpdate * 1000))}</span>` : ''}</div>
      <button class="btn sk" data-act="acct" id="acctBtn">${badge(a?.privilege || 'unknown', true)} ${esc(a?.label || a?.user || '—')} ▾</button>
      ${cfg.paused ? btn('⚡ 接通', { act: 'connect', cls: 'solid' }) : btn('↻ 刷新', { act: 'refresh' }) + btn('断开', { act: 'disconnect', cls: 'danger' })}
      ${btn('终端', { act: 'term' })}${btn('编辑', { act: 'edit' })}`;
    el.querySelector('#dtabs').innerHTML = TABS.map(([k, t]) => `<button class="tab${S.tab === k ? ' on' : ''}" data-act="tab" data-k="${k}">${t}</button>`).join('') + '<div class="rule rule-h" data-seed="33"></div>';
    sketchAll(el);
  };

  const mountTab = () => {
    if (subKey === S.tab && sub) return;
    sub?.destroy?.();
    const body = el.querySelector('#dbody');
    body.innerHTML = '';
    const t = TABS.find((x) => x[0] === S.tab) || TABS[0];
    subKey = t[0];
    sub = t[2].mount(body, { id, editServer });
  };

  delegate(el.querySelector('#dhead'), {
    refresh: () => invoke('refresh', { id }),
    disconnect: () => invoke('disconnect', { id }),
    connect: () => invoke('connect', { id }),
    term: () => invoke('open_terminal', { id }),
    edit: () => editServer(id),
    acct: (b) => {
      const cfg = server(id);
      popover(b, `<div class="kicker">以谁的身份登舰？</div>` + cfg.accounts.map((a) => `
        <div class="menu-item" data-act="pick" data-a="${a.id}">
          <span class="${a.id === cfg.activeAccount ? 'red' : 'muted'}">${a.id === cfg.activeAccount ? '●' : '○'}</span>
          <div class="grow"><b style="font-size:16px">${esc(a.label || a.user)}</b><div class="muted" style="font-size:12px">${esc(a.user)} · ${a.auth === 'password' ? '密码登录' : '密钥登录'} · ${esc(privDetail(a.privilege))}</div></div>
          ${badge(a.privilege, true)}</div>`).join('') +
        `<div class="rule-h" style="height:4px" data-ink="#7f9db3"></div>${btn('管理账户与角色…', { act: 'manage', cls: 'chip' })}`,
      { width: 380, onMount: (p, close) => delegate(p, {
        pick: (x) => { close(); if (x.dataset.a === server(id).activeAccount) { say('已经是这个账户在登舰了。', 'refuse'); return; } invoke('switch_account', { id, account: x.dataset.a }); },
        manage: () => { close(); editServer(id); },
      }) });
      sketchAll();
    },
  });
  delegate(el.querySelector('#dtabs'), {
    tab: (b) => {
      const k = b.dataset.k, t = TABS.find((x) => x[0] === k), cfg = server(id), l = liveOf(id);
      if (t[3] && cfg.paused) { say(`还不行：「${title(cfg)}」已断开停泊，${t[1]}要先点「接通」。`, 'refuse'); return; }
      if (t[3] && l.phase !== 'online') { say(`还不行：「${title(cfg)}」还没接通，${t[1]}要等连上以后才能用。`, 'refuse'); return; }
      if (k === 'docker' && !l.snap?.hasDocker) { say('还不行：这艘船上没找到 docker 命令，没有货舱可管。', 'refuse'); return; }
      S.tab = k; head(); mountTab(); say(`翻到「${t[1]}」这一页。`);
    },
  });

  head(); mountTab();
  return {
    update(what) { head(); if (what === 'tab') mountTab(); else sub?.update?.(what); },
    destroy() { sub?.destroy?.(); },
  };
}
