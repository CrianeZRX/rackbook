// One GPU up close: the engine firing on its test stand, every gauge nvidia-smi gives, four live charts and the
// processes riding on this card.
import { invoke } from '../api.js';
import { liveOf, onChange, ext, say } from '../state.js';
import { modal, btn, delegate, meter } from '../ui.js';
import { C, sketchAll } from '../kit.js';
import { lineChart } from '../teardown.js';
import { gpuDetailScene, heatColor } from '../rockets.js';
import * as F from '../fmt.js';
import { esc } from '../fmt.js';

export function openGpu(id, index) {
  const gpu = () => liveOf(id).snap?.gpus?.find((g) => g.index === index);
  let procs = null, loading = false, raf = 0, off = null;

  const stats = (g) => {
    const memF = g.memTotal > 0 ? g.memUsed / g.memTotal : 0;
    const pw = g.power != null && g.powerLimit ? g.power / g.powerLimit : null;
    return [
      meter('推力', g.util / 100, F.pct(g.util)),
      meter('燃料', memF, `${F.bytes(g.memUsed)} / ${F.bytes(g.memTotal)}`, memF > 0.9 ? C.rose : C.blue),
      g.memUtil != null ? meter('显存带宽', g.memUtil / 100, F.pct(g.memUtil), C.sky) : '',
      g.temp != null ? meter('温度', Math.min(1, g.temp / 95), `${Math.round(g.temp)}°C`, heatColor(g.temp)) : '',
      g.power != null ? meter('功耗', pw ?? 0, `${Math.round(g.power)} W${g.powerLimit ? ' / ' + Math.round(g.powerLimit) + ' W' : ''}`, C.gold) : '',
      g.fan != null ? meter('风扇', g.fan / 100, F.pct(g.fan), C.sage) : '',
      g.clockSm != null ? `<div class="row mono muted" style="font-size:0.6875rem"><span>SM 频率</span><span class="spacer"></span><span>${Math.round(g.clockSm)} MHz</span></div>` : '',
    ].join('');
  };
  const procHtml = () => {
    if (loading) return '<div class="muted">正在问 nvidia-smi…</div>';
    if (!procs) return '<div class="muted">点「清点乘客」看哪些进程正在用这块卡。</div>';
    if (!procs.length) return '<div class="muted">这块卡上现在没有计算进程。</div>';
    return `<table class="sheet"><tr><th>PID</th><th>用户</th><th>进程</th><th class="r">显存</th></tr>` +
      procs.map((p) => `<tr><td>${p.pid}</td><td data-notr>${esc(p.user || '—')}</td><td class="name" data-notr title="${esc(p.name)}">${esc(p.name)}</td><td class="r">${F.bytes(p.mem)}</td></tr>`).join('') + '</table>';
  };

  const loadProcs = async (m) => {
    loading = true; m.querySelector('#gprocs').innerHTML = procHtml();
    const r = await invoke('run', { id, timeout: 20, cmd: "nvidia-smi --query-gpu=index,uuid --format=csv,noheader 2>/dev/null; echo @@; nvidia-smi --query-compute-apps=gpu_uuid,pid,used_memory,process_name --format=csv,noheader,nounits 2>/dev/null" });
    const [a, b = ''] = r.out.split('@@');
    const uuid = a.split('\n').map((l) => l.split(',').map((x) => x.trim())).find((f) => f[0] === String(index))?.[1];
    const rows = b.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((f) => f.length >= 4 && f[0] === uuid);
    procs = rows.map((f) => ({ pid: Number(f[1]), mem: (parseFloat(f[2]) || 0) * 1048576, name: f.slice(3).join(','), user: '' }));
    if (procs.length) {
      const u = await invoke('run', { id, timeout: 10, cmd: `ps -o pid=,user= -p ${procs.map((p) => p.pid).join(',')} 2>/dev/null` });
      const owner = Object.fromEntries(u.out.split('\n').map((l) => l.trim().split(/\s+/)).filter((f) => f.length >= 2).map((f) => [f[0], f[1]]));
      procs.forEach((p) => (p.user = owner[String(p.pid)] || ''));
    }
    loading = false;
    if (m.isConnected) m.querySelector('#gprocs').innerHTML = procHtml();
    if (r.code !== 0 && !procs.length) say('读不到进程列表：nvidia-smi 没有返回结果。', 'warn');
  };

  const refresh = (m) => {
    const g = gpu(); if (!g || !m.isConnected) return;
    m.querySelector('#gstats').innerHTML = stats(g);
    const h = ext(id).gpu[index] || { util: [], mem: [], temp: [], power: [] };
    const draw = (k, v, color, max, fmt) => { const cv = m.querySelector(`[data-gc="${k}"]`); if (cv) lineChart(cv, [{ values: v, color }], max, fmt); };
    draw('util', h.util, C.rose, 100, F.pct);
    draw('mem', h.mem, C.blue, 100, F.pct);
    draw('temp', h.temp, C.gold, 100, (v) => `${Math.round(v)}°C`);
    draw('power', h.power, C.sage, null, (v) => `${Math.round(v)} W`);
  };

  const g0 = gpu();
  if (!g0) return;
  modal(`
    <div class="row base"><span class="kicker">Engine #${index}</span><span class="h" style="font-size:1.5rem" data-notr>${esc(g0.name)}</span><span class="spacer"></span>${btn('关闭', { act: 'close', cls: 'chip' })}</div>
    <div class="row top" style="gap:18px;align-items:stretch">
      <div class="gpu-stand" style="flex:1 1 360px"><canvas id="gscene" style="width:100%;height:360px"></canvas></div>
      <div class="col" style="flex:1 1 300px;gap:8px"><div id="gstats" class="col gstats" style="gap:8px"></div>
        <div class="foot">尾焰长度 = 占用，喷管颜色 = 温度，燃料罐水位 = 显存，涡轮泵转速 = 风扇。</div></div>
    </div>
    <div class="grid2" style="gap:12px">
      ${[['util', '推力 · 占用'], ['mem', '燃料 · 显存'], ['temp', '温度'], ['power', '功耗']].map(([k, t]) => `<div class="card sk" style="padding:8px 12px"><div class="head"><span class="h" style="font-size:1rem">${t}</span></div><canvas data-gc="${k}" style="width:100%;height:110px"></canvas></div>`).join('')}
    </div>
    <div class="card sk"><div class="head"><span class="kicker">Passengers</span><span class="h">这块卡上的进程</span><span class="spacer"></span>${btn('清点乘客', { act: 'procs', cls: 'chip' })}</div><div id="gprocs">${procHtml()}</div></div>`,
  {
    width: 980,
    onMount: (m, close) => {
      sketchAll(m);
      refresh(m);
      const cv = m.querySelector('#gscene');
      const loop = (t) => {
        if (!m.isConnected) { off?.(); return; }
        const g = gpu(); if (g) gpuDetailScene(cv, g, t / 1000);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      off = onChange((what) => { if (what === 'live') refresh(m); });
      delegate(m, { close: () => { cancelAnimationFrame(raf); off?.(); close(); }, procs: () => loadProcs(m) });
      loadProcs(m);
    },
  }).then(() => { cancelAnimationFrame(raf); off?.(); });
}
