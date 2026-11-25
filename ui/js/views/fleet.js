import { invoke } from '../api.js';
import { S, liveOf, health, healthLabel, title, display, active, alerts, memFrac, worstDisk, mountFrac, shipClass, onlineCount, phaseText, gpuUtil } from '../state.js';
import { card, meter, dot, badge, btn, delegate, titleBlock, bar } from '../ui.js';
import { drawChart, chartHit, miniShip } from '../ships.js';
import { C, fitCanvas, ink, marker, dot as kdot } from '../kit.js';
import * as F from '../fmt.js';
import { esc } from '../fmt.js';

function spark(cv, values, color, maxY) {
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  if (!values || values.length < 2) { ink(ctx, [[0, h - 1], [w, h - 1]], { width: 0.8, color: C.pencil, amp: 0.4, seed: 3 }); return; }
  const m = maxY || Math.max(1, Math.max(...values) * 1.15);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - 2 - (h - 4) * Math.min(1, Math.max(0, v / m))]);
  ctx.beginPath(); ctx.moveTo(0, h); pts.forEach((p) => ctx.lineTo(p[0], p[1])); ctx.lineTo(pts[pts.length - 1][0], h); ctx.closePath();
  ctx.fillStyle = color + '73'; ctx.fill();
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.strokeStyle = 'rgba(35,30,22,.85)'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.stroke();
  kdot(ctx, pts[pts.length - 1], 2.6, C.red, null);
}

export function mount(el, { go, editServer }) {
  el.innerHTML = `<div class="page">
    <div class="row" style="align-items:flex-end">
      <div class="grow" id="fTitle"></div>
      <div class="col" style="align-items:flex-end">
        <div class="row" id="legend"></div>
        <div class="row">${btn('全部接通', { act: 'up', cls: 'chip' })}${btn('全部断开', { act: 'down', cls: 'chip danger' })}</div>
      </div>
    </div>
    <div id="empty"></div>
    <div id="chartCard" class="card sk" style="gap:8px">
      <div class="head"><span class="kicker">Star chart</span><span class="h">编队航行中（点舰船登舰）</span></div>
      <canvas id="chart" style="width:100%;height:520px;cursor:pointer"></canvas>
      <div class="foot">舰级按规模定：侦察艇 ≤2 核、护卫舰、巡洋舰 ≥9 核或 24 GB、母舰 ≥32 核或 128 GB。尾焰长度随 CPU 负载，蓝→金→红；虚线护盾表示忙碌或吃紧；蓝点是网络流量。旗舰为核数最多的在航舰船。</div>
    </div>
    <div id="totals" class="row" style="gap:18px;align-items:stretch"></div>
    <div class="kicker" id="catTitle">舰船名录</div>
    <div class="cards" id="cards"></div>
    <div class="foot">数据经 SSH 从 /proc 读取，每艘按各自间隔刷新。颜色：绿 = 从容，黄 = 忙碌，红 = 吃紧，灰 = 失联，钢灰 = 停泊（主动断开）。</div>
  </div>`;
  el.querySelector('#legend').innerHTML = ['ok', 'warn', 'hot', 'down', 'parked'].map((h) => `<span class="row" style="gap:4px">${dot(h)}<span>${healthLabel[h]}</span></span>`).join('&nbsp;&nbsp;');
  const cv = el.querySelector('#chart');
  let raf = 0, alive = true;
  const loop = (t) => { if (!alive) return; drawChart(cv, t / 1000); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    const id = chartHit(cv, e.clientX - r.left, e.clientY - r.top);
    if (id) go(id);
  });
  delegate(el, {
    up: () => invoke('connect_all'),
    down: () => invoke('disconnect_all'),
    open: (x) => go(x.dataset.id),
    new: () => editServer(null),
  });

  const update = () => {
    const lives = S.servers.map((s) => liveOf(s.id));
    const nAlerts = lives.reduce((n, l) => n + alerts(l).length, 0);
    el.querySelector('#fTitle').innerHTML = titleBlock('Starfleet · 星际舰队', '第一舰队',
      `${S.servers.length} 艘 · ${onlineCount()} 艘在航 · ${S.servers.filter((s) => s.paused).length} 艘停泊 · ${nAlerts} 处需要留意`);
    const empty = !S.servers.length;
    el.querySelector('#chartCard').classList.toggle('hidden', empty);
    el.querySelector('#totals').classList.toggle('hidden', empty);
    el.querySelector('#catTitle').classList.toggle('hidden', empty);
    el.querySelector('#empty').innerHTML = empty ? card(`<div class="row top" style="gap:24px"><div class="col" style="font-size:17px">
        <div>Rackbook 用内置的 SSH 去读服务器的 /proc，不需要在服务器上安装任何东西。</div>
        <div>1. 点「＋ 新舰船」，填主机和端口。</div>
        <div>2. 添加登舰账户：用密钥（自动找 C:\\Users\\你\\.ssh\\id_ed25519）或密码。</div>
        <div>3. 有 sudo 的账户是舰长，没有的是领航员；一艘船可以挂多个账户随时切换。</div>
        <div>${btn('＋ 让第一艘舰船入列', { act: 'new', cls: 'solid' })}</div></div></div>`, { kicker: 'Page one', title: '星图上还是空的' }) : '';

    const snaps = lives.filter((l) => l.phase === 'online' && l.snap).map((l) => l.snap);
    const sum = (f) => snaps.reduce((a, s) => a + f(s), 0);
    const memU = sum((s) => s.memUsed), memT = sum((s) => s.memTotal);
    const dU = sum((s) => s.mounts.reduce((a, m) => a + m.used, 0)), dT = sum((s) => s.mounts.reduce((a, m) => a + m.used + m.avail, 0));
    const tally = (k, big, note, frac, color) => card(`<div class="big">${esc(big)}</div>${frac != null ? bar(frac, color) : ''}<div class="muted">${esc(note)}</div>`, { kicker: k, style: 'flex:1' });
    el.querySelector('#totals').innerHTML =
      tally('Cores', String(sum((s) => s.cores)), '在航舰船的 CPU 核数合计') +
      tally('Memory', F.bytes(memU), `共 ${F.bytes(memT)}`, memT ? memU / memT : 0, C.blue) +
      tally('Traffic', `↓ ${F.rate(sum((s) => s.rxRate))}`, `↑ ${F.rate(sum((s) => s.txRate))}`) +
      tally('Storage', F.bytes(dU), `共 ${F.bytes(dT)}`, dT ? dU / dT : 0, C.tan);

    el.querySelector('#cards').innerHTML = S.servers.map((s, i) => {
      const l = liveOf(s.id), hl = health(l), sn = l.snap, cls = shipClass(sn), a = active(s);
      const online = sn && l.phase === 'online';
      const wd = worstDisk(sn);
      return card(`
        <div class="row top" style="gap:12px">
          <canvas class="mini" data-id="${s.id}" style="width:104px;height:76px;flex:none"></canvas>
          <div class="col grow" style="gap:2px">
            <div class="kicker" style="font-size:12px">No.${i + 1} · ${sn ? cls.name : '舰船'} · ${healthLabel[hl]}</div>
            <div class="h" style="font-size:21px" data-notr>${esc(title(s))}</div>
            <div class="row">${badge(a?.privilege || 'unknown', true)}<span class="mono muted" style="font-size:11px">${esc(display(s))}</span></div>
            ${sn ? `<div class="muted" style="font-size:14px">${sn.cores} 核${sn.gpus.length ? ` · ${sn.gpus.length} GPU` : ''} · ${F.bytes(sn.memTotal)} · 运行 ${F.uptime(sn.uptime)}</div>` : ''}
          </div>
        </div>
        ${online ? meter('CPU', sn.cpu / 100, F.pct(sn.cpu)) + meter('MEM', memFrac(sn), F.pct(memFrac(sn) * 100)) + meter('DISK', wd ? mountFrac(wd) : 0, F.pct((wd ? mountFrac(wd) : 0) * 100))
          + (sn.gpus.length ? meter('GPU', gpuUtil(sn) / 100, F.pct(gpuUtil(sn)), C.pink) : '')
          + `<canvas class="spark" data-id="${s.id}" style="width:100%;height:34px"></canvas>
             <div class="row mono" style="font-size:11px"><span>↓ ${F.rate(sn.rxRate)}</span><span class="spacer"></span><span>↑ ${F.rate(sn.txRate)}</span><span class="spacer"></span><span>load ${F.num(sn.load[0] || 0)}</span></div>
             ${alerts(l).map((a) => `<div class="red" style="font-weight:700">● ${esc(a)}</div>`).join('')}`
          : `<div class="${l.phase === 'offline' ? 'red' : 'muted'}" style="font-size:16px">${esc(phaseText(l))}</div>`}`,
      { lit: hl === 'hot', cls: 'click', attrs: `data-act="open" data-id="${s.id}"` });
    }).join('');
    el.querySelectorAll('canvas.mini').forEach((c) => { const s = S.servers.find((x) => x.id === c.dataset.id); miniShip(c, s, liveOf(s.id)); });
    el.querySelectorAll('canvas.spark').forEach((c) => spark(c, liveOf(c.dataset.id).hist?.cpu, C.gold, 100));
  };
  update();
  return { update, destroy: () => { alive = false; cancelAnimationFrame(raf); } };
}

export { spark };
