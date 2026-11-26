import { invoke } from '../api.js';
import { S, liveOf, health, healthLabel, title, display, active, alerts, memFrac, worstDisk, mountFrac, shipClass, onlineCount, phaseText, gpuUtil, SHIP_CLASS_TIERS, shipClassThreshold } from '../state.js';
import { card, meter, dot, badge, btn, delegate, titleBlock, bar } from '../ui.js';
import { drawChart, chartHit, miniShip } from '../ships.js';
import { C, fitCanvas, ink, marker, dot as kdot } from '../kit.js';
import * as F from '../fmt.js';
import { esc } from '../fmt.js';
import { tr } from '../i18n.js';

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

const totalCard = (key, label, color) => card(
  `<div class="fleet-total-reading big"><span data-dir></span><span data-value data-notr></span><span class="fleet-total-unit" data-unit></span></div>
   ${color ? bar(0, color) : '<div class="fleet-total-spacer"></div>'}
   <div class="fleet-total-note muted" data-note></div>`,
  { kicker: label, cls: 'fleet-total', attrs: `data-total="${key}"` },
);

export function mount(el, { go, editServer }) {
  el.innerHTML = `<div class="page">
    <div class="row fleet-heading" style="align-items:flex-end">
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
      <div class="foot"><div id="class-guide" data-notr></div><div>尾焰长度随 CPU 负载，蓝→金→红；虚线护盾表示忙碌或吃紧；蓝点是网络流量。旗舰是未停泊舰船中核数最多的一艘。</div></div>
    </div>
    <div id="totals">${totalCard('cores', 'Cores')}${totalCard('memory', 'Memory', C.blue)}
      ${totalCard('traffic', 'Traffic')}${totalCard('storage', 'Storage', C.tan)}</div>
    <div class="kicker" id="catTitle">舰船名录</div>
    <div class="cards" id="cards"></div>
    <div class="foot">基础指标约每秒更新，显卡、进程和磁盘容量按舰船的刷新间隔采样。</div>
  </div>`;
  el.querySelector('#legend').innerHTML = ['ok', 'warn', 'hot', 'down', 'parked'].map((h) => `<span class="row" style="gap:4px">${dot(h)}<span>${healthLabel[h]}</span></span>`).join('&nbsp;&nbsp;');
  const cv = el.querySelector('#chart');
  const classGuide = el.querySelector('#class-guide');
  const totals = Object.fromEntries([...el.querySelectorAll('[data-total]')].map((node) => [node.dataset.total, node]));
  const cards = el.querySelector('#cards');
  let cardOrder = [];
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

  const update = (what, changedShips) => {
    const thresholds = SHIP_CLASS_TIERS.map((tier) => {
      const { cores, memoryGib } = shipClassThreshold(tier);
      return tr(`${tier.name} ≥${cores} 核或 ${memoryGib} GiB`);
    }).join(' · ');
    const guide = tr('舰级从高到低判定') + ' · ' + thresholds + ' · ' + tr('其余归为侦察艇');
    if (classGuide.textContent !== guide) classGuide.textContent = guide;
    const lives = S.servers.map((s) => liveOf(s.id));
    const nAlerts = lives.reduce((n, l) => n + alerts(l).length, 0);
    const name = S.prefs.fleetName?.trim();
    el.querySelector('#fTitle').innerHTML = titleBlock('Starfleet · 星际舰队', name || '第一舰队',
      `${S.servers.length} 艘 · ${onlineCount()} 艘在航 · ${S.servers.filter((s) => s.paused).length} 艘停泊 · ${nAlerts} 处需要留意`, !!name);
    const empty = !S.servers.length;
    el.querySelector('#chartCard').classList.toggle('hidden', empty);
    el.querySelector('#totals').classList.toggle('hidden', empty);
    el.querySelector('#catTitle').classList.toggle('hidden', empty);
    el.querySelector('#empty').innerHTML = empty ? card(`<div class="row top" style="gap:24px"><div class="col" style="font-size:1.0625rem">
        <div>Rackbook 用内置的 SSH 去读服务器的 /proc，不需要在服务器上安装任何东西。</div>
        <div>1. 点「＋ 新舰船」，填主机和端口。</div>
        <div>2. 添加登舰账户：用密钥（自动找 C:\\Users\\你\\.ssh\\id_ed25519）或密码。</div>
        <div>3. 有 sudo 的账户是舰长，没有的是领航员；一艘船可以挂多个账户随时切换。</div>
        <div>${btn('＋ 让第一艘舰船入列', { act: 'new', cls: 'solid' })}</div></div></div>`, { kicker: 'Page one', title: '星图上还是空的' }) : '';

    const snaps = lives.filter((l) => l.phase === 'online' && l.snap).map((l) => l.snap);
    const sum = (f) => snaps.reduce((a, s) => a + f(s), 0);
    const memU = sum((s) => s.memUsed), memT = sum((s) => s.memTotal);
    const dU = sum((s) => s.mounts.reduce((a, m) => a + m.used, 0)), dT = sum((s) => s.mounts.reduce((a, m) => a + m.used + m.avail, 0));
    const updateTotal = (key, reading, note, direction = '', fraction) => {
      const tile = totals[key];
      const [value, unit = ''] = reading.split(' ');
      const label = tr(note);
      tile.querySelector('[data-dir]').textContent = direction;
      tile.querySelector('[data-value]').textContent = value;
      tile.querySelector('[data-unit]').textContent = unit;
      tile.querySelector('[data-note]').textContent = label;
      tile.querySelector('[data-note]').title = label;
      tile.querySelector('.fleet-total-reading').title = `${direction} ${reading}`.trim();
      if (fraction != null) tile.querySelector('.bar > i').style.width = `${Math.min(1, Math.max(0, fraction)) * 100}%`;
    };
    updateTotal('cores', String(sum((s) => s.cores)), '在航舰船的 CPU 核数合计');
    updateTotal('memory', F.bytes(memU), `共 ${F.bytes(memT)}`, '', memT ? memU / memT : 0);
    updateTotal('traffic', F.rate(sum((s) => s.rxRate)), `↑ ${F.rate(sum((s) => s.txRate))}`, '↓');
    updateTotal('storage', F.bytes(dU), `共 ${F.bytes(dT)}`, '', dT ? dU / dT : 0);

    const shipCard = (s, i) => {
      const l = liveOf(s.id), hl = health(l), sn = l.snap, cls = shipClass(sn), a = active(s);
      const online = sn && l.phase === 'online';
      const wd = worstDisk(sn), warnings = alerts(l);
      return card(`
        <div class="row top" style="gap:12px">
          <canvas class="mini" data-id="${s.id}" style="width:104px;height:76px;flex:none"></canvas>
          <div class="col grow" style="gap:2px">
            <div class="kicker" style="font-size:0.75rem">No.${i + 1} · ${sn ? cls.name : '舰船'} · ${healthLabel[hl]}</div>
            <div class="h" style="font-size:1.3125rem" data-notr>${esc(title(s))}</div>
            <div class="row">${badge(a?.privilege || 'unknown', true)}<span class="mono muted" style="font-size:0.6875rem">${esc(display(s))}</span></div>
            ${sn ? `<div class="muted" style="font-size:0.875rem">${sn.cores} 核${sn.gpus.length ? ` · ${sn.gpus.length} GPU` : ''} · ${F.bytes(sn.memTotal)} · 运行 ${F.uptime(sn.uptime)}</div>` : ''}
          </div>
        </div>
        ${online ? meter('CPU', sn.cpu / 100, F.pct(sn.cpu)) + meter('MEM', memFrac(sn), F.pct(memFrac(sn) * 100)) + meter('DISK', wd ? mountFrac(wd) : 0, F.pct((wd ? mountFrac(wd) : 0) * 100))
          + (sn.gpus.length ? meter('GPU', gpuUtil(sn) / 100, F.pct(gpuUtil(sn)), C.pink) : '')
          + `<canvas class="spark" data-id="${s.id}" style="width:100%;height:34px"></canvas>
             <div class="metric-line mono" style="font-size:0.6875rem"><span>↓ ${F.rate(sn.rxRate)}</span><span>↑ ${F.rate(sn.txRate)}</span><span>load ${F.num(sn.load[0] || 0)}</span></div>
             <div class="fleet-ship-alert red" title="${esc(warnings.join(' · '))}">${warnings.map((warning) => `● ${esc(warning)}`).join(' · ')}</div>`
          : `<div class="${l.phase === 'offline' ? 'red' : 'muted'}" style="font-size:1rem">${esc(phaseText(l))}</div>`}`,
      { lit: hl === 'hot', cls: 'click', attrs: `data-act="open" data-id="${s.id}"` });
    };
    const drawShipCard = (node, ship) => {
      const live = liveOf(ship.id);
      miniShip(node.querySelector('canvas.mini'), ship, live);
      const history = node.querySelector('canvas.spark');
      if (history) spark(history, live.hist?.cpu, C.gold, 100);
    };
    const sameOrder = cardOrder.length === S.servers.length && S.servers.every((s, i) => s.id === cardOrder[i]);
    if (what === 'live' && changedShips?.size && sameOrder) {
      S.servers.forEach((ship, i) => {
        if (!changedShips.has(ship.id)) return;
        cards.children[i].outerHTML = shipCard(ship, i);
        drawShipCard(cards.children[i], ship);
      });
    } else {
      cardOrder = S.servers.map((s) => s.id);
      cards.innerHTML = S.servers.map(shipCard).join('');
      S.servers.forEach((ship, i) => drawShipCard(cards.children[i], ship));
    }
  };
  update();
  return { update, destroy: () => { alive = false; cancelAnimationFrame(raf); } };
}

export { spark };
