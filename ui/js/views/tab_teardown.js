import { say, liveOf, health, memFrac, worstDisk, mountFrac, gpuUtil, loadText } from '../state.js';
import { card, btn, meter, delegate, bar } from '../ui.js';
import { Teardown, SUBS, sentence, lineChart } from '../teardown.js';
import { C, loadColor, sketchAll } from '../kit.js';
import { gpuCardScene } from '../rockets.js';
import { openGpu } from './gpu_detail.js';
import * as F from '../fmt.js';
import { esc } from '../fmt.js';

const CHARTS = [
  ['cpu', 'CPU', '处理器占用'], ['mem', 'Memory', '内存占用'],
  ['net', 'Network', '网络吞吐'], ['disk', 'Disk I/O', '磁盘读写'],
];

export function mount(el, { id }) {
  el.innerHTML = `<div class="page" style="padding-top:18px">
    <div class="row teardown-main">
      <div class="card sk grow" data-seed="3">
        <div class="head"><span class="kicker">Teardown</span><span class="h" id="tdTitle">拆开看：每个部件此刻在做什么</span></div>
        <canvas id="hero" style="width:100%;height:500px;cursor:pointer"></canvas>
        <div class="row teardown-controls">${btn('◂ 合上', { act: 'explode', cls: 'solid' })}
          ${SUBS.map(([key, title]) => btn(title, { act: 'focus', cls: 'chip', data: `data-k="${key}" aria-pressed="false" aria-controls="teardown-details"` })).join('')}</div>
        <div class="foot">风扇转速和数据包的动画按真实负载缩放，属示意；其余数字都来自 /proc。点任一部件可以聚焦。</div>
      </div>
      <div class="teardown-focus">
        <div class="card sk lit" id="teardown-details">
          <div class="head"><span class="kicker"></span><span class="h"></span></div>
          <div class="teardown-focus-body col"></div>
        </div>
      </div>
    </div>
    <div class="grid2">${CHARTS.map(([key, kicker, title]) => `<div class="card sk click" data-act="chart" data-k="${key}">
      <div class="head"><span class="kicker">${kicker}</span><span class="h">${title}</span></div>
      <div class="row base"><span class="big"></span><span class="muted"></span></div>
      <canvas style="width:100%;height:140px"></canvas></div>`).join('')}</div>
    <div id="bay"></div>
    <div class="row top" style="gap:18px;align-items:stretch"><div id="disks" class="grow"></div><div id="nets" class="grow"></div></div>
  </div>`;
  const page = el.firstElementChild;
  const hero = new Teardown(page.querySelector('#hero'));
  const focus = page.querySelector('#teardown-details');
  const focusBody = focus.querySelector('.teardown-focus-body');
  const charts = Object.fromEntries([...page.querySelectorAll('[data-act="chart"]')].map((chart) => [chart.dataset.k, chart]));
  let exploded = true, alive = true, raf = 0;
  let frame = 0, renderedFocus;
  const loop = (t) => {
    if (!alive) return;
    const l = liveOf(id); hero.snap = l.snap; hero.hl = health(l); hero.draw(t);
    // engines: every other frame is plenty for a flicker
    if (++frame % 2 === 0 && l.snap?.gpus?.length) page.querySelectorAll('canvas.engine').forEach((cv) => { const g = l.snap.gpus.find((x) => String(x.index) === cv.dataset.g); if (g) gpuCardScene(cv, g, t / 1000); });
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  const showFocus = () => {
    const [, name, kicker] = SUBS.find(([key]) => key === hero.focus);
    focus.querySelector('.head .kicker').textContent = kicker;
    focus.querySelector('.head .h').textContent = name;
    for (const button of page.querySelectorAll('[data-act="focus"]')) {
      const selected = button.dataset.k === hero.focus;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  };
  const setFocus = (key) => {
    if (hero.focus !== key) {
      hero.focus = key;
      showFocus();
      update();
      focusBody.scrollTop = 0;
    }
    say(sentence(key, snap()));
  };
  const snap = () => { const l = liveOf(id); return l.phase === 'online' ? l.snap : null; };

  hero.cv.addEventListener('click', (e) => {
    const r = e.target.getBoundingClientRect();
    const k = hero.hit(e.clientX - r.left, e.clientY - r.top);
    if (k) setFocus(k);
  });
  delegate(page, {
    explode: (button) => {
      exploded = !exploded;
      hero.setExploded(exploded);
      button.textContent = exploded ? '◂ 合上' : '拆开 ▸';
      page.querySelector('#tdTitle').textContent = exploded ? '拆开看：每个部件此刻在做什么' : '合上：一台完整的机器';
      say(exploded ? '拆开了：盖板掀起，硬盘抽出，网卡和电源往后退。点任一部件看细节。' : '合上了。数字仍在实时更新。');
    },
    focus: (b) => setFocus(b.dataset.k),
    chart: (b) => setFocus(b.dataset.k),
    gpu: (b) => openGpu(id, Number(b.dataset.g)),
  });

  const focusContent = (s) => {
    const k = hero.focus;
    if (!s) {
      const [, name] = SUBS.find(([key]) => key === k);
      return `<div class="muted">还没有数据。等这艘船接通后，这里会列出${name}的细节。</div>`;
    }
    const big = (b, n) => `<div><div class="big" style="font-size:2rem">${esc(b)}</div><div class="muted">${esc(n)}</div></div>`;
    let body = '';
    if (k === 'cpu') {
      body = big(F.pct(s.cpu), `${s.cores} 核 · 运行队列 ${s.procsRunning} · iowait ${F.pct(s.iowait)}`) +
        `<div class="kicker" style="font-size:0.75rem">每个核一格</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(30px,1fr));gap:6px">` +
        s.perCore.map((v, i) => `<div title="核 ${i}：${F.pct(v)}" style="text-align:center"><div style="height:26px;border:1px solid #231e16;position:relative;background:#fffdf6"><i style="position:absolute;left:0;right:0;bottom:0;height:${Math.min(100, v).toFixed(0)}%;background:${loadColor(v)}"></i></div><div class="mono muted" style="font-size:0.5625rem">c${i}</div></div>`).join('') +
        `</div><div class="mono" style="font-size:0.6875rem">负载 1 / 5 / 15 分钟：${loadText(s)}</div>`;
    } else if (k === 'mem') {
      const free = Math.max(0, s.memTotal - s.memUsed - s.memCache);
      const seg = (v, c) => `<i style="display:block;flex:${v};background:${c}"></i>`;
      body = big(F.bytes(s.memUsed), `共 ${F.bytes(s.memTotal)} · 可用 ${F.bytes(s.memAvail)}`) +
        `<div style="display:flex;height:16px;border:1.1px solid #231e16">${seg(s.memUsed, C.blue)}${seg(s.memCache, C.sky)}${seg(free, C.cream)}</div>
         <div class="row small"><span style="color:${C.blue}">■</span>已用 <span style="color:${C.sky}">■</span>缓存 <span>□</span>空闲</div>` +
        (s.swapTotal > 0 ? meter('SWAP', s.swapUsed / s.swapTotal, F.bytes(s.swapUsed)) : '') +
        `<div class="kicker" style="font-size:0.75rem">最占内存的进程</div>` +
        s.procs.slice().sort((a, b) => b.rss - a.rss).slice(0, 6).map((p) => `<div class="row"><span class="grow">${esc(p.command)}</span><span class="mono small">${F.bytes(p.rss)}</span></div>`).join('');
    } else if (k === 'gpu') {
      body = !s.gpus.length
        ? big('—', '没检测到显卡') + '<div class="muted">通过 nvidia-smi（NVIDIA）或 /sys/class/drm 的 amdgpu 节点读取显卡。都没有时，拆解图上画的是一个空的 PCIe 槽。</div>'
        : big(F.pct(gpuUtil(s)), `${s.gpus.length} 块显卡的平均占用`) + s.gpus.map((g) => `<div class="col" style="gap:3px">
            <div class="row"><b class="mono grow" style="font-size:0.75rem">#${g.index} ${esc(g.name)}</b>${g.temp != null ? `<span class="mono ${g.temp > 80 ? 'red' : ''}" style="font-size:0.6875rem">${Math.round(g.temp)}°C</span>` : ''}</div>
            ${meter('UTIL', g.util / 100, F.pct(g.util))}${meter('VRAM', g.memTotal ? g.memUsed / g.memTotal : 0, F.pct(g.memTotal ? g.memUsed / g.memTotal * 100 : 0))}
            <div class="muted small">显存 ${F.bytes(g.memUsed)} / ${F.bytes(g.memTotal)}${g.power != null ? ` · ${Math.round(g.power)} W` : ''}</div></div>`).join('');
    } else if (k === 'net') {
      body = big('↓ ' + F.rate(s.rxRate), `↑ ${F.rate(s.txRate)} · ${s.tcp} 个 TCP 连接`) +
        s.nets.slice(0, 8).map((n) => `<div><b class="mono" style="font-size:0.75rem">${esc(n.name)}</b><div class="row mono muted small" style="font-size:0.6875rem"><span>↓ ${F.rate(n.rxRate)}</span><span class="spacer"></span><span>↑ ${F.rate(n.txRate)}</span></div></div>`).join('');
    } else {
      body = big('读 ' + F.rate(s.ioRead), `写 ${F.rate(s.ioWrite)}`) +
        s.mounts.slice(0, 8).map((m) => `<div class="col" style="gap:2px"><div class="row ${mountFrac(m) > 0.9 ? 'red' : ''}"><b class="mono grow" style="font-size:0.75rem">${esc(m.mount)}</b><span class="mono small">${F.pct(mountFrac(m) * 100)}</span></div>${bar(mountFrac(m))}</div>`).join('');
    }
    return body;
  };

  // the propulsion bay: one engine per GPU, built once per card count, numbers refreshed in place
  const renderBay = (s, hist) => {
    const bay = page.querySelector('#bay');
    const gpus = s?.gpus || [];
    if (!gpus.length) { bay.innerHTML = ''; bay.dataset.n = ''; return; }
    const models = Object.entries(gpus.reduce((m, g) => ((m[g.name] = (m[g.name] || 0) + 1), m), {})).map(([n, c]) => (c > 1 ? `${c} × ${n}` : n)).join(' · ');
    if (bay.dataset.n !== String(gpus.length)) {
      bay.dataset.n = String(gpus.length);
      bay.innerHTML = `<div class="card sk">
        <div class="head"><span class="kicker">Propulsion bay</span><span class="h">推进器舱 · ${gpus.length} 块显卡</span><span class="spacer"></span><span class="muted small" data-notr>${esc(models)}</span></div>
        <div class="row top" style="gap:18px;align-items:stretch;flex-wrap:wrap">
          <div class="col" style="flex:1 1 320px;min-width:280px;gap:4px"><div class="row base"><span class="big" id="gpuAvg"></span><span class="muted">平均推力 · 每块显卡是这艘船的一台引擎：尾焰越长越忙，喷管越红越热，燃料罐水位是显存</span></div><canvas data-c="gpu" style="width:100%;height:150px"></canvas></div>
          <div class="gpugrid" style="flex:3 1 520px">${gpus.map((g) => `<div class="gpucard sk click" data-act="gpu" data-g="${g.index}" title="点击查看这台引擎（显卡）的详情">
            <canvas class="engine" data-g="${g.index}"></canvas>
            <div class="row base" style="gap:6px"><b class="mono">引擎 #${g.index}</b><span class="spacer"></span><b class="hand" data-v="util" style="font-size:1.25rem"></b></div>
            <div class="mono muted" data-v="mem" style="font-size:0.6875rem"></div>
            <div class="row mono" style="font-size:0.6875rem;gap:6px"><span data-v="temp"></span><span class="spacer"></span><span data-v="power" class="muted"></span></div></div>`).join('')}</div>
        </div></div>`;
      sketchAll(bay);
    }
    bay.firstElementChild.classList.toggle('lit', hero.focus === 'gpu');
    bay.querySelector('#gpuAvg').textContent = F.pct(gpuUtil(s));
    for (const g of gpus) {
      const c = bay.querySelector(`.gpucard[data-g="${g.index}"]`); if (!c) continue;
      c.querySelector('[data-v="util"]').textContent = F.pct(g.util);
      c.querySelector('[data-v="mem"]').textContent = `${F.bytes(g.memUsed)} / ${F.bytes(g.memTotal)}`;
      const t = c.querySelector('[data-v="temp"]');
      t.textContent = g.temp == null ? '—' : `${Math.round(g.temp)}°C`;
      t.style.color = g.temp != null && g.temp >= 85 ? C.red : '';
      c.querySelector('[data-v="power"]').textContent = g.power == null ? '' : `${Math.round(g.power)} W`;
      c.style.boxShadow = g.temp != null && g.temp >= 85 ? `inset 0 0 0 999px rgba(239,106,76,.12)` : '';
    }
    const cv = bay.querySelector('[data-c="gpu"]'); if (cv) lineChart(cv, [{ values: hist.gpu, color: C.pink }], 100, F.pct);
  };

  const update = () => {
    const l = liveOf(id), s = l.phase === 'online' ? l.snap : null, hist = l.hist || {};
    const content = focusContent(s);
    if (content !== renderedFocus) {
      const scrollTop = focusBody.scrollTop;
      focusBody.innerHTML = renderedFocus = content;
      focusBody.scrollTop = scrollTop;
    }
    const chartSummary = (key, value, note) => {
      const chart = charts[key];
      chart.classList.toggle('lit', hero.focus === key);
      chart.querySelector('.big').textContent = value;
      chart.querySelector('.muted').textContent = note;
    };
    chartSummary('cpu', s ? F.pct(s.cpu) : '—', s ? `iowait ${F.pct(s.iowait)} · 负载 ${loadText(s)}` : '');
    chartSummary('mem', s ? F.pct(memFrac(s) * 100) : '—', s ? `${F.bytes(s.memUsed)} / ${F.bytes(s.memTotal)}` : '');
    chartSummary('net', s ? '↓ ' + F.rate(s.rxRate) : '—', s ? `↑ ${F.rate(s.txRate)}   蓝 = 下行，红 = 上行` : '');
    chartSummary('disk', s ? '读 ' + F.rate(s.ioRead) : '—', s ? `写 ${F.rate(s.ioWrite)}   绿 = 读，棕 = 写` : '');
    const draw = (key, lines, maxY, fmt) => lineChart(charts[key].querySelector('canvas'), lines, maxY, fmt);
    draw('cpu', [{ values: hist.cpu, color: C.gold }], 100, F.pct);
    draw('mem', [{ values: hist.mem, color: C.blue }], 100, F.pct);
    draw('net', [{ values: hist.rx, color: C.sky }, { values: hist.tx, color: C.rose, fill: false }], null, F.rate);
    draw('disk', [{ values: hist.ioR, color: C.sage }, { values: hist.ioW, color: C.wood, fill: false }], null, F.rate);
    renderBay(s, hist);

    page.querySelector('#disks').innerHTML = card(s && s.mounts.length ? `<table class="sheet"><tr><th>挂载点</th><th>用量</th><th class="r">已用 / 总量</th><th class="r">%</th></tr>` +
      s.mounts.map((m) => `<tr class="${mountFrac(m) > 0.9 ? 'red' : ''}"><td class="hand name" title="${esc(m.mount)}"><b data-notr>${esc(m.mount)}</b><div class="mono muted" data-notr style="font-size:0.625rem">${esc(m.fs)} · ${esc(m.type)}</div></td><td style="min-width:90px">${bar(mountFrac(m), null, 11)}</td><td class="r">${F.bytes(m.used)} / ${F.bytes(m.used + m.avail)}</td><td class="r"><b>${F.pct(mountFrac(m) * 100)}</b></td></tr>`).join('') + '</table>'
      : '<div class="muted">没有可显示的挂载点。</div>', { kicker: 'Storage', title: '挂载点', lit: hero.focus === 'disk' });
    page.querySelector('#nets').innerHTML = card(s && s.nets.length ? `<table class="sheet"><tr><th>名称</th><th class="r">下行</th><th class="r">上行</th><th class="r">累计 收 / 发</th></tr>` +
      s.nets.slice(0, 10).map((n) => `<tr><td class="name" title="${esc(n.name)}"><b data-notr>${esc(n.name)}</b></td><td class="r">${F.rate(n.rxRate)}</td><td class="r">${F.rate(n.txRate)}</td><td class="r">${F.bytes(n.rx)} / ${F.bytes(n.tx)}</td></tr>`).join('') + '</table>'
      : '<div class="muted">没有网卡数据。</div>', { kicker: 'Interfaces', title: '网卡', lit: hero.focus === 'net' });
    sketchAll(page);
  };
  showFocus(); update();
  return { update, destroy: () => { alive = false; cancelAnimationFrame(raf); } };
}
