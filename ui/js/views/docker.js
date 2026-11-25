import { invoke } from '../api.js';
import { say, privilege, canSudo, active, server } from '../state.js';
import { card, btn, delegate, confirm, meter, textSheet } from '../ui.js';
import { C, Iso, box3, isoBox, ink, dot, fitCanvas, sketchAll } from '../kit.js';
import { esc, shq } from '../fmt.js';

function cargo(cv, color, running) {
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  const iso = new Iso(4 + 22 * 0.866 * 0.62, 4 + 22 * 0.62, 0.62);
  isoBox(ctx, iso, box3(0, 0, 0, 80, 22, 22), color, { seed: 700, width: 1.1 });
  for (let k = 1; k < 10; k++) ink(ctx, [iso.p(k * 8, 22, 2), iso.p(k * 8, 22, 20)], { width: 0.6, amp: 0, seed: 710, over: 0 });
  ink(ctx, [iso.p(80, 11, 2), iso.p(80, 11, 20)], { width: 1, amp: 0, seed: 720, over: 0 });
  if (running) dot(ctx, iso.p(80, 4, 18), 2.4, C.gold);
}
const lines = (s) => s.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

export function mount(el, { id }) {
  let containers = [], images = [], version = '', loaded = false, busy = false, showStopped = true, filter = '', alive = true, viaSudo = false;
  el.innerHTML = `<div class="page" style="padding-top:18px">
    <div class="card sk" data-seed="160"><div class="head"><span class="kicker">Cargo hold</span><span class="h">Docker 货舱</span></div>
      <div class="row" id="dstats"></div>
      <div class="row"><input class="field sk" id="dq" placeholder="筛选货柜名或镜像…"><span id="dbtns" class="row"></span></div></div>
    <div class="cards" id="dcards" style="grid-template-columns:repeat(auto-fill,minmax(330px,1fr))"></div>
    <div id="dimgs"></div>
    <div class="foot">每 6 秒自动刷新一次。账户在 docker 组里时直接运行 docker，否则由舰长通过 sudo 运行；领航员会被拒绝。</div></div>`;
  el.querySelector('#dq').addEventListener('input', (e) => { filter = e.target.value.toLowerCase(); render(); });

  const render = () => {
    const run = containers.filter((c) => c.running).length, p = privilege(id);
    el.querySelector('#dstats').innerHTML = [[run, '运行中'], [containers.length, '货柜总数'], [images.length, '镜像']].map(([b, n]) => `<div style="margin-right:18px"><div class="big">${b}</div><div class="muted small">${n}</div></div>`).join('') +
      `<span class="spacer"></span><div class="col" style="align-items:flex-end;gap:2px"><span class="mono muted" style="font-size:11px">${version ? 'Docker ' + esc(version) : '—'}</span><span class="muted small">${viaSudo ? (canSudo(p) ? '通过 sudo（舰长）' : '需要舰长权限') : '以 ' + esc(active(server(id))?.user || '') + ' 直接操作'}</span></div>`;
    el.querySelector('#dbtns').innerHTML = btn(showStopped ? '隐藏已停止' : '显示已停止', { act: 'toggle', cls: 'chip' + (!showStopped ? ' active' : '') }) + btn(busy ? '读取中…' : '↻ 刷新', { act: 'reload', disabled: busy });
    const shown = containers.filter((c) => (showStopped || c.running) && (!filter || c.name.toLowerCase().includes(filter) || c.image.toLowerCase().includes(filter)));
    el.querySelector('#dcards').innerHTML = (loaded && !containers.length ? '<div class="muted" style="font-size:17px">货舱是空的：这艘船上还没有容器。</div>' : '') + shown.map((c) => {
      const color = c.running ? C.sage : c.state === 'paused' ? C.gold : c.state === 'restarting' ? C.rose : C.shade;
      return card(`<div class="row top" style="gap:12px"><canvas class="cargo" data-color="${color}" data-run="${c.running ? 1 : 0}" style="width:76px;height:52px;flex:none"></canvas>
        <div class="col grow" style="gap:1px;min-width:0"><div class="h" style="font-size:18px;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</div><div class="mono muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis">${esc(c.image)}</div><div class="${c.running ? 'okc' : 'muted'} small">${esc(c.status)}</div></div></div>
        ${c.running ? meter('MEM', c.memPerc / 100, c.memPerc.toFixed(0) + '%') + `<div class="row mono" style="font-size:10px"><span>CPU ${esc(c.cpu || '—')}</span><span class="spacer"></span><span>${esc(c.mem)}</span></div>${c.net ? `<div class="mono muted" style="font-size:10px">网络 ${esc(c.net)}</div>` : ''}` : ''}
        ${c.ports ? `<div class="mono muted" style="font-size:10px">${esc(c.ports)}</div>` : ''}
        <div class="row">${c.running ? btn('重启', { act: 'ask', cls: 'chip', data: `data-v="restart" data-t="${esc(c.name)}"` }) + btn('停止', { act: 'ask', cls: 'chip danger', data: `data-v="stop" data-t="${esc(c.name)}"` })
          : btn('启动', { act: 'do', cls: 'chip', data: `data-v="start" data-t="${esc(c.name)}"` }) + btn('删除', { act: 'ask', cls: 'chip danger', data: `data-v="rm" data-t="${esc(c.name)}"` })}${btn('日志', { act: 'logs', cls: 'chip', data: `data-t="${esc(c.name)}"` })}</div>`, { lit: c.state === 'restarting' });
    }).join('');
    el.querySelectorAll('canvas.cargo').forEach((cv) => cargo(cv, cv.dataset.color, cv.dataset.run === '1'));
    el.querySelector('#dimgs').innerHTML = card(images.length ? `<table class="sheet"><tr><th>镜像</th><th>ID</th><th class="r">大小</th><th>创建</th><th></th></tr>` +
      images.map((i) => `<tr><td><b>${esc(i.repo)}</b></td><td class="muted">${esc(i.id)}</td><td class="r">${esc(i.size)}</td><td class="hand muted">${esc(i.created)}</td><td>${btn('删除', { act: 'ask', cls: 'chip danger', data: `data-v="rmi" data-t="${esc(i.id)}" data-l="${esc(i.repo)}"` })}</td></tr>`).join('') + '</table>'
      : `<div class="muted">${loaded ? '没有镜像。' : '正在读取…'}</div>`, { kicker: 'Images', title: '镜像' });
    sketchAll(el);
  };

  const load = async (quiet) => {
    if (busy) return;
    busy = true; render();
    const [ps, st, im, v] = await Promise.all([
      invoke('docker', { id, args: "ps -a --format '{{json .}}'" }),
      invoke('docker', { id, args: "stats --no-stream --format '{{json .}}'", timeout: 30 }),
      invoke('docker', { id, args: "images --format '{{json .}}'" }),
      invoke('docker', { id, args: "version --format '{{.Server.Version}}'" }),
    ]);
    viaSudo = await invoke('docker_via_sudo', { id });
    busy = false;
    if (ps.code !== 0) { if (!quiet || !loaded) say('还不行：读不了货舱（' + (ps.err.trim() || `退出码 ${ps.code}`) + '）。', 'refuse'); loaded = true; render(); return; }
    const stats = {}; lines(st.out).forEach((d) => { stats[d.Name] = d; });
    containers = lines(ps.out).map((d) => {
      const status = d.Status || ''; const state = d.State || (status.startsWith('Up') ? (status.includes('Paused') ? 'paused' : 'running') : 'exited');
      const s = stats[d.Names] || {};
      return { id: d.ID, name: d.Names, image: d.Image, state, status, ports: d.Ports || '', running: state === 'running', cpu: s.CPUPerc || '', mem: s.MemUsage || '', net: s.NetIO || '', memPerc: parseFloat((s.MemPerc || '0').replace('%', '')) || 0 };
    }).sort((a, b) => (a.running !== b.running ? (a.running ? -1 : 1) : a.name.localeCompare(b.name)));
    images = lines(im.out).map((d) => ({ id: d.ID, repo: d.Tag ? `${d.Repository}:${d.Tag}` : d.Repository, size: d.Size, created: d.CreatedSince }));
    version = v.out.trim();
    loaded = true; render();
    if (!quiet) say(`货舱清点完毕：${containers.filter((c) => c.running).length} 个货柜在运行，共 ${containers.length} 个；${images.length} 个镜像。`, 'ok');
  };
  const canAct = () => {
    const p = privilege(id);
    if (viaSudo && !canSudo(p)) { say(p === 'needsPassword' ? '还不行：这个账户不在 docker 组，需要舰长 sudo，但还没存 sudo 密码。' : '还不行：你是领航员，又不在 docker 组，管不了货舱。请换舰长账户，或让舰长把你加入货舱。', 'refuse'); return false; }
    return true;
  };
  const doIt = async (verb, target, label) => {
    say(`正在${label}…`);
    const r = await invoke('docker', { id, args: `${verb} ${shq(target)}`, timeout: 120 });
    say(r.code === 0 ? `完成：${label}。` : '没成功：' + (r.err.trim() || `退出码 ${r.code}`), r.code === 0 ? 'ok' : 'refuse');
    load(true);
  };
  const names = { restart: '重启', stop: '停止', rm: '删除货柜', rmi: '删除镜像', start: '启动' };
  delegate(el, {
    toggle: () => { showStopped = !showStopped; render(); },
    reload: () => load(false),
    do: (b) => { if (canAct()) doIt(b.dataset.v, b.dataset.t, `${names[b.dataset.v]} ${b.dataset.t}`); },
    ask: async (b) => {
      if (!canAct()) return;
      const label = `${names[b.dataset.v]} ${b.dataset.l || b.dataset.t}`;
      if (await confirm(label + '？', b.dataset.v.startsWith('rm') ? '删除后不能撤销。' : `将在这艘船上执行 docker ${b.dataset.v}。`, names[b.dataset.v])) doIt(b.dataset.v, b.dataset.t, label);
    },
    logs: async (b) => { const r = await invoke('docker', { id, args: `logs --tail 300 --timestamps ${shq(b.dataset.t)} 2>&1`, timeout: 30 }); textSheet('docker logs --tail 300', b.dataset.t, r.out || r.err); },
  });
  render();
  (async () => { while (alive) { await load(loaded); for (let i = 0; i < 60 && alive; i++) await new Promise((r) => setTimeout(r, 100)); } })();
  return { update() {}, destroy() { alive = false; } };
}
