import { say, liveOf, health, memFrac, worstDisk, mountFrac, gpuUtil, loadText } from '../state.js';
import { card, btn, meter, delegate, bar } from '../ui.js';
import { Teardown, SUBS, sentence, lineChart } from '../teardown.js';
import { C, loadColor, sketchAll } from '../kit.js';
import * as F from '../fmt.js';
import { esc } from '../fmt.js';

export function mount(el, { id }) {
  el.innerHTML = `<div class="page" style="padding-top:18px">
    <div class="row top" style="gap:18px">
      <div class="card sk grow" data-seed="3">
        <div class="head"><span class="kicker">Teardown</span><span class="h" id="tdTitle">拆开看：每个部件此刻在做什么</span></div>
        <canvas id="hero" style="width:100%;height:500px;cursor:pointer"></canvas>
        <div class="row" id="tdBtns"></div>
        <div class="foot">风扇转速和数据包的动画按真实负载缩放，属示意；其余数字都来自 /proc。点任一部件可以聚焦。</div>
      </div>
      <div id="focus" style="width:320px;flex:none"></div>
    </div>
    <div class="grid2" id="charts"></div>
    <div class="row top" style="gap:18px;align-items:stretch"><div id="disks" class="grow"></div><div id="nets" class="grow"></div></div>
  </div>`;
  const hero = new Teardown(el.querySelector('#hero'));
  let exploded = true, alive = true, raf = 0;
  const loop = (t) => { if (!alive) return; const l = liveOf(id); hero.snap = l.snap; hero.hl = health(l); hero.draw(t); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  const buttons = () => {
    el.querySelector('#tdBtns').innerHTML = btn(exploded ? '◂ 合上' : '拆开 ▸', { act: 'explode', cls: 'solid' }) +
      SUBS.map(([k, t]) => btn(t, { act: 'focus', cls: 'chip' + (hero.focus === k ? ' active' : ''), data: `data-k="${k}"` })).join('');
    el.querySelector('#tdTitle').textContent = exploded ? '拆开看：每个部件此刻在做什么' : '合上：一台完整的机器';
  };
  const setFocus = (k) => { hero.focus = k; buttons(); update(); say(sentence(k, snap())); };
  const snap = () => { const l = liveOf(id); return l.phase === 'online' ? l.snap : null; };

  el.querySelector('#hero').addEventListener('click', (e) => {
    const r = e.target.getBoundingClientRect();
    const k = hero.hit(e.clientX - r.left, e.clientY - r.top);
    if (k) setFocus(k);
  });
  delegate(el, {
    explode: () => { exploded = !exploded; hero.setExploded(exploded); buttons(); say(exploded ? '拆开了：盖板掀起，硬盘抽出，网卡和电源往后退。点任一部件看细节。' : '合上了。数字仍在实时更新。'); },
    focus: (b) => setFocus(b.dataset.k),
    chart: (b) => setFocus(b.dataset.k),
  });

  const focusPanel = (s) => {
    const k = hero.focus, sub = SUBS.find((x) => x[0] === k);
    if (!s) return card(`<div class="muted">还没有数据。等这艘船接通后，这里会列出${sub[1]}的细节。</div>`, { kicker: sub[2], title: sub[1], lit: true });
    const big = (b, n) => `<div><div class="big" style="font-size:32px">${esc(b)}</div><div class="muted">${esc(n)}</div></div>`;
    let body = '';
    if (k === 'cpu') {
      body = big(F.pct(s.cpu), `${s.cores} 核 · 运行队列 ${s.procsRunning} · iowait ${F.pct(s.iowait)}`) +
        `<div class="kicker" style="font-size:12px">每个核一格</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(30px,1fr));gap:6px">` +
        s.perCore.map((v, i) => `<div title="核 ${i}：${F.pct(v)}" style="text-align:center"><div style="height:26px;border:1px solid #231e16;position:relative;background:#fffdf6"><i style="position:absolute;left:0;right:0;bottom:0;height:${Math.min(100, v).toFixed(0)}%;background:${loadColor(v)}"></i></div><div class="mono muted" style="font-size:9px">c${i}</div></div>`).join('') +
        `</div><div class="mono" style="font-size:11px">负载 1 / 5 / 15 分钟：${loadText(s)}</div>`;
    } else if (k === 'mem') {
      const free = Math.max(0, s.memTotal - s.memUsed - s.memCache);
      const seg = (v, c) => `<i style="display:block;flex:${v};background:${c}"></i>`;
      body = big(F.bytes(s.memUsed), `共 ${F.bytes(s.memTotal)} · 可用 ${F.bytes(s.memAvail)}`) +
        `<div style="display:flex;height:16px;border:1.1px solid #231e16">${seg(s.memUsed, C.blue)}${seg(s.memCache, C.sky)}${seg(free, C.cream)}</div>
         <div class="row small"><span style="color:${C.blue}">■</span>已用 <span style="color:${C.sky}">■</span>缓存 <span>□</span>空闲</div>` +
        (s.swapTotal > 0 ? meter('SWAP', s.swapUsed / s.swapTotal, F.bytes(s.swapUsed)) : '') +
        `<div class="kicker" style="font-size:12px">最占内存的进程</div>` +
        s.procs.slice().sort((a, b) => b.rss - a.rss).slice(0, 6).map((p) => `<div class="row"><span class="grow">${esc(p.command)}</span><span class="mono small">${F.bytes(p.rss)}</span></div>`).join('');
    } else if (k === 'gpu') {
      body = !s.gpus.length
        ? big('—', '没检测到显卡') + '<div class="muted">通过 nvidia-smi（NVIDIA）或 /sys/class/drm 的 amdgpu 节点读取显卡。都没有时，拆解图上画的是一个空的 PCIe 槽。</div>'
        : big(F.pct(gpuUtil(s)), `${s.gpus.length} 块显卡的平均占用`) + s.gpus.map((g) => `<div class="col" style="gap:3px">
            <div class="row"><b class="mono grow" style="font-size:12px">#${g.index} ${esc(g.name)}</b>${g.temp != null ? `<span class="mono ${g.temp > 80 ? 'red' : ''}" style="font-size:11px">${Math.round(g.temp)}°C</span>` : ''}</div>
            ${meter('UTIL', g.util / 100, F.pct(g.util))}${meter('VRAM', g.memTotal ? g.memUsed / g.memTotal : 0, F.pct(g.memTotal ? g.memUsed / g.memTotal * 100 : 0))}
            <div class="muted small">显存 ${F.bytes(g.memUsed)} / ${F.bytes(g.memTotal)}${g.power != null ? ` · ${Math.round(g.power)} W` : ''}</div></div>`).join('');
    } else if (k === 'net') {
      body = big('↓ ' + F.rate(s.rxRate), `↑ ${F.rate(s.txRate)} · ${s.tcp} 个 TCP 连接`) +
        s.nets.slice(0, 8).map((n) => `<div><b class="mono" style="font-size:12px">${esc(n.name)}</b><div class="row mono muted small" style="font-size:11px"><span>↓ ${F.rate(n.rxRate)}</span><span class="spacer"></span><span>↑ ${F.rate(n.txRate)}</span></div></div>`).join('');
    } else {
      body = big('读 ' + F.rate(s.ioRead), `写 ${F.rate(s.ioWrite)}`) +
        s.mounts.slice(0, 8).map((m) => `<div class="col" style="gap:2px"><div class="row ${mountFrac(m) > 0.9 ? 'red' : ''}"><b class="mono grow" style="font-size:12px">${esc(m.mount)}</b><span class="mono small">${F.pct(mountFrac(m) * 100)}</span></div>${bar(mountFrac(m))}</div>`).join('');
    }
    return card(body, { kicker: sub[2], title: sub[1], lit: true });
  };

  const update = () => {
    const l = liveOf(id), s = l.phase === 'online' ? l.snap : null, hist = l.hist || {};
    el.querySelector('#focus').innerHTML = focusPanel(s);
    const cc = (k, kicker, t, big, note) => `<div class="card sk click${hero.focus === k ? ' lit' : ''}" data-act="chart" data-k="${k}"><div class="head"><span class="kicker">${kicker}</span><span class="h">${t}</span></div><div class="row base"><span class="big">${esc(big)}</span><span class="muted">${esc(note)}</span></div><canvas data-c="${k}" style="width:100%;height:140px"></canvas></div>`;
    const charts = [
      cc('cpu', 'CPU', '处理器占用', s ? F.pct(s.cpu) : '—', s ? `iowait ${F.pct(s.iowait)} · 负载 ${loadText(s)}` : ''),
      cc('mem', 'Memory', '内存占用', s ? F.pct(memFrac(s) * 100) : '—', s ? `${F.bytes(s.memUsed)} / ${F.bytes(s.memTotal)}` : ''),
      cc('net', 'Network', '网络吞吐', s ? '↓ ' + F.rate(s.rxRate) : '—', s ? `↑ ${F.rate(s.txRate)}   蓝 = 下行，红 = 上行` : ''),
      cc('disk', 'Disk I/O', '磁盘读写', s ? '读 ' + F.rate(s.ioRead) : '—', s ? `写 ${F.rate(s.ioWrite)}   绿 = 读，棕 = 写` : ''),
    ];
    if (s?.gpus?.length) {
      // "8 × NVIDIA A100-PCIE-40GB" rather than the same name eight times
      const models = Object.entries(s.gpus.reduce((m, g) => ((m[g.name] = (m[g.name] || 0) + 1), m), {})).map(([n, c]) => (c > 1 ? `${c} × ${n}` : n)).join(' · ');
      charts.push(cc('gpu', 'GPU', '显卡占用（平均）', F.pct(gpuUtil(s)), models));
      // the card beside it: one row per GPU, so the grid has no hole and each card is readable at a glance
      const hot = (t) => (t == null ? '' : t >= 85 ? 'red' : '');
      charts.push(`<div class="card sk${hero.focus === 'gpu' ? ' lit' : ''}"><div class="head"><span class="kicker">GPUs</span><span class="h">逐块显卡</span></div>
        <div style="overflow:auto;max-height:200px"><table class="sheet"><tr><th>#</th><th style="width:38%">占用</th><th class="r">显存</th><th class="r">温度</th><th class="r">功耗</th></tr>` +
        s.gpus.map((g) => `<tr><td class="nw"><b>${g.index}</b></td><td><div class="row" style="gap:6px">${bar(g.util / 100, C.pink, 9)}<span class="nw" style="width:34px;text-align:right">${F.pct(g.util)}</span></div></td><td class="r">${F.bytes(g.memUsed)} / ${F.bytes(g.memTotal)}</td><td class="r ${hot(g.temp)}">${g.temp == null ? '—' : Math.round(g.temp) + '°C'}</td><td class="r">${g.power == null ? '—' : Math.round(g.power) + ' W'}</td></tr>`).join('') +
        `</table></div></div>`);
    }
    const ch = el.querySelector('#charts');
    ch.innerHTML = charts.join('');
    const draw = (k, lines, maxY, fmt) => { const c = ch.querySelector(`[data-c="${k}"]`); if (c) lineChart(c, lines, maxY, fmt); };
    draw('cpu', [{ values: hist.cpu, color: C.gold }], 100, F.pct);
    draw('mem', [{ values: hist.mem, color: C.blue }], 100, F.pct);
    draw('net', [{ values: hist.rx, color: C.sky }, { values: hist.tx, color: C.rose, fill: false }], null, F.rate);
    draw('disk', [{ values: hist.ioR, color: C.sage }, { values: hist.ioW, color: C.wood, fill: false }], null, F.rate);
    draw('gpu', [{ values: hist.gpu, color: C.pink }], 100, F.pct);

    el.querySelector('#disks').innerHTML = card(s && s.mounts.length ? `<table class="sheet"><tr><th>挂载点</th><th>用量</th><th class="r">已用 / 总量</th><th class="r">%</th></tr>` +
      s.mounts.map((m) => `<tr class="${mountFrac(m) > 0.9 ? 'red' : ''}"><td class="hand name" title="${esc(m.mount)}"><b data-notr>${esc(m.mount)}</b><div class="mono muted" data-notr style="font-size:10px">${esc(m.fs)} · ${esc(m.type)}</div></td><td style="min-width:90px">${bar(mountFrac(m), null, 11)}</td><td class="r">${F.bytes(m.used)} / ${F.bytes(m.used + m.avail)}</td><td class="r"><b>${F.pct(mountFrac(m) * 100)}</b></td></tr>`).join('') + '</table>'
      : '<div class="muted">没有可显示的挂载点。</div>', { kicker: 'Storage', title: '挂载点', lit: hero.focus === 'disk' });
    el.querySelector('#nets').innerHTML = card(s && s.nets.length ? `<table class="sheet"><tr><th>名称</th><th class="r">下行</th><th class="r">上行</th><th class="r">累计 收 / 发</th></tr>` +
      s.nets.slice(0, 10).map((n) => `<tr><td class="name" title="${esc(n.name)}"><b data-notr>${esc(n.name)}</b></td><td class="r">${F.rate(n.rxRate)}</td><td class="r">${F.rate(n.txRate)}</td><td class="r">${F.bytes(n.rx)} / ${F.bytes(n.tx)}</td></tr>`).join('') + '</table>'
      : '<div class="muted">没有网卡数据。</div>', { kicker: 'Interfaces', title: '网卡', lit: hero.focus === 'net' });
    sketchAll(el);
  };
  buttons(); update();
  return { update, destroy: () => { alive = false; cancelAnimationFrame(raf); } };
}
