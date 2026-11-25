import { invoke } from '../api.js';
import { say, liveOf } from '../state.js';
import { btn, delegate } from '../ui.js';
import { sketchAll } from '../kit.js';
import { esc } from '../fmt.js';
import * as F from '../fmt.js';

const SNIPS = ['uptime', 'free -h', 'df -h', 'top -bn1 | head -n 20', 'ss -tunlp | head -n 30', 'docker ps', 'journalctl -n 60 --no-pager', 'last -n 10', 'systemctl --failed'];
const runsBy = {};   // keep the receipt per ship while the app runs

export function mount(el, { id }) {
  const runs = runsBy[id] || (runsBy[id] = []);
  const hist = []; let hi = -1;
  el.innerHTML = `<div class="page" style="padding-top:18px;flex:1;min-height:0">
    <div class="card sk"><div class="head"><span class="kicker">Console</span><span class="h">在这艘船上执行命令</span></div>
      <div class="row"><b class="mono red" style="font-size:1rem">$</b><input class="field sk mono" id="cmd" placeholder="输入命令后回车（非交互式；需要交互的程序请用「终端」）">${btn('执行', { act: 'run', cls: 'solid' })}${btn('在终端打开', { act: 'term' })}</div>
      <div class="row" style="flex-wrap:wrap">${SNIPS.map((s) => btn(s, { act: 'snip', cls: 'chip', data: `data-s="${esc(s)}"` })).join('')}</div></div>
    <div class="receipt sk" id="rc"></div>
    <div class="row"><span class="foot">每条命令单独开一个 SSH 通道（复用连接），超时 120 秒。↑↓ 翻历史。</span><span class="spacer"></span>${btn('清空', { act: 'clear', cls: 'chip' })}</div></div>`;
  const input = el.querySelector('#cmd');
  const render = () => {
    const rc = el.querySelector('#rc');
    rc.innerHTML = !runs.length ? '<div class="muted" style="font-size:1.0625rem">这里像一卷收据纸：每条命令和它的输出依次往下记。</div>'
      : runs.map((r) => `<div style="margin-bottom:14px"><div class="row"><b class="mono sel" data-notr style="font-size:0.8125rem">$ ${esc(r.cmd)}</b><span class="spacer"></span><span class="mono muted" style="font-size:0.625rem">${r.at}</span></div>
        ${r.out ? `<pre data-notr>${esc(r.out)}</pre>` : ''}${r.err?.trim() ? `<pre data-notr class="red">${esc(r.err)}</pre>` : ''}
        <div class="${r.code == null ? 'woodc' : r.code === 0 ? 'okc' : 'red'} small">${r.code == null ? '运行中…' : `退出码 ${r.code} · ${r.secs.toFixed(2)} 秒`}</div>
        <div class="rule-h" style="height:4px;margin-top:4px" data-ink="#7f9db3" data-width="0.8"></div></div>`).join('');
    sketchAll(rc);
    rc.scrollTop = rc.scrollHeight;
  };
  const run = async (c) => {
    c = (c ?? input.value).trim(); if (!c) return;
    if (liveOf(id).phase !== 'online') { say('还不行：这艘船现在没接通，命令发不出去。', 'refuse'); return; }
    hist.push(c); hi = hist.length; input.value = '';
    const r = { cmd: c, at: F.clock(), out: '', err: '', code: null, secs: 0 }; runs.push(r); render();
    say(`正在执行：${c}`);
    const t0 = performance.now();
    const o = await invoke('run', { id, cmd: c, timeout: 120 });
    Object.assign(r, { out: o.out.slice(0, 200000), err: o.err, code: o.code, secs: (performance.now() - t0) / 1000 });
    render(); say(`「${c}」结束，退出码 ${o.code}。`, o.code === 0 ? 'ok' : 'warn');
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') run();
    if (e.key === 'ArrowUp' && hist.length) { hi = Math.max(0, hi - 1); input.value = hist[hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown' && hist.length) { hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ''; e.preventDefault(); }
  });
  delegate(el, {
    run: () => run(),
    snip: (b) => run(b.dataset.s),
    term: () => invoke('open_terminal', { id }),
    clear: () => { runs.length = 0; render(); say('收据纸撕掉了。'); },
  });
  render(); input.focus();
  return { update() {}, destroy() {} };
}
