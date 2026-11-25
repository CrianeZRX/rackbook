import { invoke } from '../api.js';
import { say, liveOf, server, privilege, canSudo, roleName, active, isCaptain } from '../state.js';
import { card, btn, delegate, confirm, bar, textSheet } from '../ui.js';
import { C, WASHES, wash, loadColor, sketchAll } from '../kit.js';
import { orbitScene, userStream } from '../rockets.js';
import { ext } from '../state.js';
import * as F from '../fmt.js';
import { esc, shq } from '../fmt.js';

export function mount(el, { id, openCrew }) {
  let sortMem = false, query = '', svcQuery = '', services = null, loading = false;
  el.innerHTML = `<div class="page" style="padding-top:18px;flex:1;min-height:0">
    <div class="card sk">
      <div class="head row" style="flex-wrap:wrap"><span class="kicker">Crew in orbit</span><span class="h">谁在用这艘船</span><span class="spacer"></span>${btn('查看船员名单', { act: 'crew', cls: 'chip' })}</div>
      <div class="crew-orbit">
        <div class="col">
          <canvas id="orbit" aria-hidden="true"></canvas>
          <div class="muted small">宇航员火箭越大，占用内存越多；尾焰越长、飞得越快，占用 CPU 越多。</div>
        </div>
        <div class="col">
          <div class="muted small">最近的 CPU 占用，按用户叠加（单位：核；条形按最忙的用户为满格）</div>
          <canvas id="ustream" style="width:100%;height:120px"></canvas>
          <div id="ulist" class="orbit-users"></div>
        </div>
      </div>
    </div>
    <div class="proc-panels">
      <div class="card sk grow" style="min-height:0">
        <div class="head"><span class="kicker">Processes</span><span class="h" id="pTitle"></span></div>
        <div class="row"><input class="field sk" id="pq" placeholder="筛选命令、用户或 PID…"><span id="sortBtns" class="row"></span></div>
        <div style="overflow:auto;flex:1;min-height:300px" id="plist"></div>
        <div class="foot">列表随每次采样刷新，显示占用最高的 80 个进程（ps 的 %CPU 是进程生命周期内的平均值）。</div>
      </div>
      <div class="card sk">
        <div class="head"><span class="kicker">Services</span><span class="h">systemd 服务（运行中）</span></div>
        <div class="row"><input class="field sk" id="sq" placeholder="筛选服务…"><span id="loadBtn"></span></div>
        <div style="overflow:auto;flex:1" id="slist"></div>
      </div>
    </div></div>`;
  el.querySelector('#pq').addEventListener('input', (e) => { query = e.target.value.toLowerCase(); renderProcs(); });
  el.querySelector('#sq').addEventListener('input', (e) => { svcQuery = e.target.value.toLowerCase(); renderSvcs(); });

  const renderProcs = () => {
    const l = liveOf(id);
    let rows = (l.snap?.procs || []).slice();
    if (sortMem) rows.sort((a, b) => b.rss - a.rss);
    if (query) rows = rows.filter((p) => p.command.toLowerCase().includes(query) || p.user.toLowerCase().includes(query) || String(p.pid) === query);
    el.querySelector('#pTitle').textContent = `进程 · 按${sortMem ? '内存' : ' CPU'}排序`;
    el.querySelector('#sortBtns').innerHTML = btn('按 CPU', { act: 'sort', cls: 'chip' + (!sortMem ? ' active' : ''), data: 'data-m="0"' }) + btn('按内存', { act: 'sort', cls: 'chip' + (sortMem ? ' active' : ''), data: 'data-m="1"' });
    el.querySelector('#plist').innerHTML = `<table class="sheet procs"><colgroup><col style="width:86px"><col style="width:96px"><col style="width:150px"><col style="width:90px"><col><col style="width:118px"></colgroup>
      <tr><th>PID</th><th>用户</th><th>CPU %</th><th class="r">内存</th><th>命令</th><th></th></tr>` +
      rows.map((p) => `<tr class="prow"><td>${p.pid}</td><td class="name" data-notr title="${esc(p.user)}">${esc(p.user)}</td><td><div class="row" style="gap:6px">${bar(Math.min(1, p.cpu / 100), loadColor(Math.min(100, p.cpu)), 7)}<span class="nw" style="width:44px;text-align:right">${F.num(p.cpu, 1)}</span></div></td><td class="r">${F.bytes(p.rss)}</td><td class="hand name" data-notr style="font-size:0.9375rem" title="${esc(p.command)}">${esc(p.command)}</td>
        <td class="r nw"><span class="act">${btn('结束', { act: 'kill', cls: 'chip', data: `data-pid="${p.pid}" data-c="${esc(p.command)}" data-u="${esc(p.user)}"` })}${btn('强杀', { act: 'kill9', cls: 'chip danger', data: `data-pid="${p.pid}" data-c="${esc(p.command)}" data-u="${esc(p.user)}"` })}</span></td></tr>`).join('') + '</table>';
    sketchAll(el);
  };
  // ---- crew in orbit: per-user CPU and memory, live ----
  const colourOf = (u) => { let h = 0; for (const ch of u) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return u === 'root' ? C.rose : wash(WASHES[h % WASHES.length]); };
  let colours = {}, users = [], captains = new Set(), current = '', alive = true, raf = 0;
  const renderUsers = () => {
    const snap = liveOf(id).snap;
    const cfg = server(id);
    current = active(cfg)?.user || '';
    captains = new Set(['root', ...(cfg?.accounts || []).filter((a) => isCaptain(a.privilege)).map((a) => a.user)]);
    users = (snap?.users || []).filter((u) => u.cores > 0.005 || u.rss > 64 * 1048576).slice(0, 10);
    colours = Object.fromEntries((snap?.users || []).map((u) => [u.user, colourOf(u.user)]));
    const memT = snap?.memTotal || 1;
    const topCores = Math.max(0.01, ...users.map((u) => u.cores));
    el.querySelector('#ulist').innerHTML = users.length ? `<table class="sheet procs"><colgroup><col style="width:18px"><col><col style="width:120px"><col style="width:120px"><col style="width:52px"></colgroup>
      <tr><th></th><th>用户</th><th>CPU</th><th>内存</th><th class="r">进程</th></tr>` +
      users.map((u) => `<tr><td><span style="display:inline-block;width:12px;height:12px;border:1.2px solid #231e16;border-radius:2px;background:${colours[u.user]}"></span></td><td class="name hand" style="font-size:0.9375rem" title="${esc(u.user === current ? `当前用户 · ${u.user}` : u.user)}">${u.user === current ? '<span class="red" aria-hidden="true">★ </span>' : ''}<span data-notr>${esc(u.user)}</span></td>
        <td><div class="row" style="gap:6px">${bar(u.cores / topCores, colours[u.user], 7)}<span class="nw" style="width:56px;text-align:right">${u.cores >= 0.995 ? F.num(u.cores, 1) + ' 核' : F.num(u.cpu, 1) + '%'}</span></div></td>
        <td><div class="row" style="gap:6px">${bar(u.rss / memT, C.blue, 7)}<span class="nw" style="width:56px;text-align:right">${F.bytes(u.rss)}</span></div></td><td class="r">${u.procs}</td></tr>`).join('') + '</table>'
      : '<div class="muted">等第二次采样后才算得出各用户的 CPU。</div>';
    const order = [...users].reverse().map((u) => u.user);
    userStream(el.querySelector('#ustream'), ext(id).users, order, colours, snap?.cores || 1);
  };
  const orbitLoop = (t) => {
    if (!alive) return;
    if (!el.isConnected) { alive = false; return; }
    orbitScene(el.querySelector('#orbit'), users, colours, t / 1000, {
      center: (server(id)?.name || 'SERVER').slice(0, 10), current, captains,
    });
    raf = requestAnimationFrame(orbitLoop);
  };
  raf = requestAnimationFrame(orbitLoop);

  const renderSvcs = () => {
    el.querySelector('#loadBtn').innerHTML = btn(loading ? '读取中…' : services ? '重读' : '读取', { act: 'loadSvc', disabled: loading });
    const list = (services || []).filter((s) => !svcQuery || s.name.toLowerCase().includes(svcQuery) || s.desc.toLowerCase().includes(svcQuery));
    el.querySelector('#slist').innerHTML = !services ? `<div class="muted" style="padding:6px">${loading ? '正在问 systemctl…' : '点「读取」列出正在运行的服务。没有 systemd 的系统会是空的。'}</div>`
      : list.map((s) => `<div class="col" style="gap:3px;padding:6px 2px;border-bottom:1px dashed rgba(127,157,179,.6)">
          <div class="row"><b class="mono grow" style="font-size:0.75rem">${esc(s.name.replace('.service', ''))}</b><span class="okc small">${esc(s.sub)}</span></div>
          <div class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.desc)}</div>
          <div class="row">${btn('日志', { act: 'log', cls: 'chip', data: `data-n="${esc(s.name)}"` })}${btn('重启', { act: 'svc', cls: 'chip', data: `data-n="${esc(s.name)}" data-v="restart"` })}${btn('停止', { act: 'svc', cls: 'chip danger', data: `data-n="${esc(s.name)}" data-v="stop"` })}</div></div>`).join('');
    sketchAll(el);
  };

  const loadSvc = async () => {
    loading = true; renderSvcs(); say(`正在读取运行中的 systemd 服务…`);
    const r = await invoke('run', { id, cmd: 'systemctl list-units --type=service --state=running --no-legend --no-pager --plain 2>/dev/null | head -n 400', timeout: 20 });
    services = r.out.split('\n').map((l) => l.trim().split(/\s+/)).filter((f) => f.length >= 4).map((f) => ({ name: f[0], sub: f[3], desc: f.slice(4).join(' ') }));
    loading = false; renderSvcs();
    say(services.length ? `读到 ${services.length} 个运行中的服务。` : '没读到服务（这艘船可能没有 systemd）。', services.length ? 'ok' : 'warn');
  };
  const kill = async (b, sig) => {
    const pid = b.dataset.pid;
    const me = active(server(id))?.user || '', owner = b.dataset.u, p = privilege(id);
    const mine = owner === me || me === 'root';
    // someone else's process needs sudo: refuse straight away when the account has none
    if (!mine && !canSudo(p)) {
      say(p === 'needsPassword' ? `没有权限：进程属于 ${owner}，需要舰长的 sudo 密码（去「船员 · 权限」补上）。` : `没有权限：进程属于 ${owner}，${roleName(p)}只能结束自己的进程。`, 'refuse');
      return;
    }
    if (!await confirm(`结束进程 ${pid}？`, `「${b.dataset.c}」，属于 ${b.dataset.u}。` + (sig === 'KILL' ? 'SIGKILL 不给进程收尾的机会。' : 'SIGTERM 会请它自行退出。'), sig === 'KILL' ? '强制结束' : '结束')) return;
    const r = mine ? await invoke('run', { id, cmd: `kill -${sig} ${pid}` }) : await invoke('sudo', { id, cmd: `kill -${sig} ${pid}` });
    if (r.code === 0) { say(`已向 ${b.dataset.c}（PID ${pid}）发送 SIG${sig}。`, 'ok'); invoke('refresh', { id }); }
    else say(`没结束掉 PID ${pid}：` + (r.err.includes('not permitted') ? '权限不够（进程不属于当前账户）。' : r.err.trim()), 'refuse');
  };

  delegate(el, {
    crew: openCrew,
    sort: (b) => { sortMem = b.dataset.m === '1'; renderProcs(); say(sortMem ? '按常驻内存 (RSS) 排序。' : '按 CPU 排序。'); },
    kill: (b) => kill(b, 'TERM'),
    kill9: (b) => kill(b, 'KILL'),
    loadSvc,
    log: async (b) => {
      const n = b.dataset.n; say(`正在取 ${n} 的最近 200 行日志…`);
      let r = await invoke('run', { id, cmd: `journalctl -u ${shq(n)} -n 200 --no-pager 2>&1`, timeout: 30 });
      if (canSudo(privilege(id)) && (r.out.includes('not seeing messages') || !r.out.trim())) r = await invoke('sudo', { id, cmd: `journalctl -u ${shq(n)} -n 200 --no-pager`, timeout: 30 });
      textSheet('journalctl', n, r.out || r.err);
    },
    svc: async (b) => {
      const n = b.dataset.n, verb = b.dataset.v, p = privilege(id), word = verb === 'restart' ? '重启' : '停止';
      if (!canSudo(p)) { say(p === 'needsPassword' ? `还不行：舰长 ${active(server(id))?.user} 还没存 sudo 密码，去「船员」页补上。` : `还不行：你现在是${roleName(p)}，${word}服务需要舰长（sudo）。可在右上角切换账户。`, 'refuse'); return; }
      if (!await confirm(`${word} ${n}？`, `将以舰长身份在这艘船上执行 systemctl ${verb} ${n}。`, word)) return;
      say(`正在${word} ${n}…`);
      const r = await invoke('sudo', { id, cmd: `systemctl ${verb} ${shq(n)}`, timeout: 90 });
      if (r.code === 0) { say(`${n} 已${word}。`, 'ok'); loadSvc(); } else say('没成功：' + (r.err.trim() || `退出码 ${r.code}`), 'refuse');
    },
  });
  renderProcs(); renderSvcs(); renderUsers();
  return { update: () => { renderProcs(); renderUsers(); }, destroy() { alive = false; cancelAnimationFrame(raf); } };
}
