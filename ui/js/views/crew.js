import { invoke } from '../api.js';
import { say, server, liveOf, privilege, canSudo, roleName, privDetail, active } from '../state.js';
import { card, btn, badge, delegate, confirm, modal, titleBlock } from '../ui.js';
import { sketchAll } from '../kit.js';
import { esc, shq } from '../fmt.js';

export function mount(el, { id, editServer }) {
  let users = null, login = '', loading = false;
  el.innerHTML = `<div class="page" style="padding-top:18px"><div id="rules"></div><div class="row top" style="gap:18px;align-items:stretch"><div id="accts" style="width:450px;flex:none"></div><div id="remote" class="grow"></div></div></div>`;
  el.querySelector('#rules').innerHTML = card(`<div class="row top" style="gap:24px">
    <div class="col grow" style="gap:4px">${badge('root')}<div>舰长：root、免密 sudo，或者在 sudo/wheel 组里并存了 sudo 密码。可以重启服务、管理 Docker、调整船员角色、以 sudo 保存系统文件。</div></div>
    <div class="col grow" style="gap:4px">${badge('none')}<div>领航员：没有 sudo。能看全部仪表、管自己的进程和文件；需要 sudo 的操作会被拒绝，并说明原因。</div></div></div>`, { kicker: "Ship's rules", title: '两种角色，按 sudo 权限划分' });

  const render = () => {
    const cfg = server(id); if (!cfg) return;
    const p = privilege(id);
    el.querySelector('#accts').innerHTML = card(cfg.accounts.map((a) => {
      const on = a.id === active(cfg)?.id;
      return `<div class="card sk${on ? ' lit' : ''}" style="padding:10px;gap:5px;background-color:${on ? 'rgba(244,184,41,.18)' : 'transparent'};box-shadow:none">
        <div class="row">${badge(a.privilege)}<b style="font-size:18px">${esc(a.label || a.user)}</b>${on ? '<b class="red">· 当前</b>' : ''}</div>
        <div class="mono muted" style="font-size:11px">${esc(a.user)} · ${a.auth === 'password' ? '密码登录' : a.keyPath ? '私钥 ' + esc(a.keyPath) : '默认私钥'}</div>
        <div class="muted small">${esc(privDetail(a.privilege))}${a.hasSudoPassword ? ' · 凭据管理器里有 sudo 密码' : ''}</div>
        <div class="row">${on ? btn('重新查验权限', { act: 'probe', cls: 'chip' }) : btn('以此登舰', { act: 'use', cls: 'chip', data: `data-a="${a.id}"` })}${btn(a.hasSudoPassword ? '改 sudo 密码…' : '存 sudo 密码…', { act: 'pw', cls: 'chip', data: `data-a="${a.id}"` })}</div></div>`;
    }).join('') + btn('＋ 添加 / 编辑账户…', { act: 'edit' }), { kicker: 'Boarding accounts', title: '登舰账户（这台电脑上）' });

    const rows = (users || []).map((u) => `<div class="list-row">
        <span style="width:74px">${badge(u.uid === 0 ? 'root' : u.captain ? 'nopasswd' : 'none', true)}</span>
        <div class="col grow" style="gap:0"><div class="row"><b class="mono">${esc(u.name)}</b>${u.name === login ? '<b class="red small">← 正在登舰</b>' : ''}${u.docker ? '<span class="woodc small">· 货舱</span>' : ''}${/nologin|false$/.test(u.shell) ? '<span class="muted small">· 不能登录</span>' : ''}</div>
          <div class="mono muted" style="font-size:10px">uid ${u.uid} · ${esc(u.home)} · ${esc(u.shell)}</div></div>
        ${u.uid !== 0 ? (u.captain ? btn('降为领航员', { act: 'role', cls: 'chip danger', data: `data-u="${esc(u.name)}" data-v="demote"` }) : btn('升为舰长', { act: 'role', cls: 'chip', data: `data-u="${esc(u.name)}" data-v="promote"` }))
          + btn(u.docker ? '移出货舱' : '进入货舱', { act: 'role', cls: 'chip', data: `data-u="${esc(u.name)}" data-v="${u.docker ? 'undock' : 'dock'}"`, title: 'docker 组：不用 sudo 就能管理 Docker' }) : ''}</div>`).join('');
    el.querySelector('#remote').innerHTML = card(`<div class="row"><span class="${canSudo(p) ? 'okc' : 'muted'}">${canSudo(p) ? '你是舰长，可以调整船员角色。' : `你是${roleName(p)}，只能查看；调整角色需要舰长。`}</span><span class="spacer"></span>${btn(loading ? '读取中…' : '↻ 读取', { act: 'load', cls: 'chip', disabled: loading })}</div>
      ${users ? rows : `<div class="muted">${liveOf(id).phase === 'online' ? '点「读取」列出船员。' : '接通以后才能读取船员名单。'}</div>`}
      <div class="foot">角色按 sudo / wheel / admin 组判断；通过 /etc/sudoers 单独授权的账户这里看不出来。</div>`, { kicker: 'Crew manifest', title: '舰上的船员（服务器账户）' });
    sketchAll(el);
  };

  const load = async () => {
    loading = true; render();
    const cmd = `id -un; echo @@U; getent passwd | awk -F: '$3==0 || ($3>=1000 && $3<65534) {print $1":"$3":"$6":"$7}'; echo @@G; for g in sudo wheel admin docker; do getent group $g; done`;
    const r = await invoke('run', { id, cmd, timeout: 20 });
    loading = false;
    if (r.code !== 0) { say('没读到船员名单：' + r.err.trim(), 'refuse'); render(); return; }
    let sec = 'ME'; const rows = [], caps = new Set(), dock = new Set();
    for (const line of r.out.split('\n').map((x) => x.trim()).filter(Boolean)) {
      if (line === '@@U') { sec = 'U'; continue; } if (line === '@@G') { sec = 'G'; continue; }
      if (sec === 'ME') login = line;
      else if (sec === 'U') { const f = line.split(':'); if (f.length >= 4) rows.push({ name: f[0], uid: +f[1], home: f[2], shell: f[3] }); }
      else { const f = line.split(':'); if (f.length < 4) continue; f[3].split(',').filter(Boolean).forEach((x) => (f[0] === 'docker' ? dock : caps).add(x)); }
    }
    users = rows.map((u) => ({ ...u, captain: u.uid === 0 || caps.has(u.name), docker: dock.has(u.name) })).sort((a, b) => (a.uid === 0 ? -1 : a.uid) - (b.uid === 0 ? -1 : b.uid));
    render();
    const c = users.filter((u) => u.captain).length;
    say(`船员名单：${users.length} 人，其中舰长 ${c} 人、领航员 ${users.length - c} 人。`);
  };

  const labels = { promote: (u) => `把 ${u} 升为舰长（加入 sudo/wheel 组）`, demote: (u) => `把 ${u} 降为领航员（移出 sudo/wheel/admin 组）`, dock: (u) => `让 ${u} 进入货舱（加入 docker 组）`, undock: (u) => `让 ${u} 移出货舱（移出 docker 组）` };
  delegate(el, {
    load,
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
    role: async (b) => {
      const u = b.dataset.u, v = b.dataset.v, p = privilege(id);
      if (!canSudo(p)) { say(p === 'needsPassword' ? '还不行：先给舰长存一个 sudo 密码。' : '还不行：你现在是领航员，调整船员角色需要舰长。', 'refuse'); return; }
      if (v === 'demote' && u === login) { say('还不行：不能把正在登舰的自己降为领航员，否则会把自己锁在门外。换一个舰长账户再操作。', 'refuse'); return; }
      if ((v === 'dock' || v === 'undock') && !liveOf(id).snap?.hasDocker) { say('还不行：这艘船上没装 Docker。', 'refuse'); return; }
      if (!await confirm('调整船员角色？', `${labels[v](u)}。对方下次登录后生效。`, '确定调整')) return;
      const q = shq(u);
      const cmd = { promote: `if getent group sudo >/dev/null; then usermod -aG sudo ${q}; else usermod -aG wheel ${q}; fi`, demote: `for g in sudo wheel admin; do getent group $g >/dev/null && gpasswd -d ${q} $g >/dev/null 2>&1; done; true`, dock: `usermod -aG docker ${q}`, undock: `gpasswd -d ${q} docker` }[v];
      const r = await invoke('sudo', { id, cmd });
      if (r.code === 0) { say(`完成：${labels[v](u)}。`, 'ok'); load(); } else say('没成功：' + (r.err.trim() || `退出码 ${r.code}`), 'refuse');
    },
  });
  render();
  if (liveOf(id).phase === 'online') load();
  return { update: render, destroy() {} };
}
