// The embedded terminal: a real interactive shell (a PTY over the ship's SSH connection), drawn on the notebook's
// paper instead of a black or white slab: ink-coloured text, a red cursor, a marker-yellow selection, and ANSI colours
// mixed from the app's own palette so `ls --color`, vim and htop still read on cream.
import { invoke, listen, isTauri } from '../api.js';
import { say, server, active } from '../state.js';
import { btn, delegate } from '../ui.js';
import { sketchAll, scaledFontSize } from '../kit.js';
import { esc } from '../fmt.js';

export const THEME = {
  background: 'rgba(0,0,0,0)', // the paper shows through
  foreground: '#231e16', cursor: '#c8372f', cursorAccent: '#fffdf6',
  selectionBackground: 'rgba(244,184,41,.45)', selectionInactiveBackground: 'rgba(244,184,41,.25)',
  black: '#231e16', red: '#c8372f', green: '#2f7a54', yellow: '#9a6a0c', blue: '#3d63a8', magenta: '#a5487a', cyan: '#2a7a82', white: '#8a8274',
  brightBlack: '#6f665a', brightRed: '#e0523f', brightGreen: '#3f9e6b', brightYellow: '#bf8a17', brightBlue: '#5d7fd0', brightMagenta: '#c0609a', brightCyan: '#3d9aa3', brightWhite: '#a49c8b',
};

const b64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

export function mount(el, { id, image, onBack }) {
  const acct = active(server(id));
  const title = image ? '镜像终端' : '终端 · 交互式';
  const target = image?.repo || (acct?.user || '') + '@' + (server(id)?.host || '');
  const note = image
    ? '通过 /bin/sh 访问镜像。终端关闭时，临时容器会清理。'
    : '真正的交互式 shell，跑在这艘船现有的 SSH 连接上：vim、htop、tmux 都能用。Ctrl+Shift+C / V 复制粘贴；窗口大小会自动同步给服务器。';
  el.innerHTML = `<div class="page" style="padding-top:18px;flex:1;min-height:0">
    <div class="card sk" style="flex:1;min-height:0">
      <div class="head"><span class="kicker">Terminal</span><span class="h">${title}</span>
        <span class="mono muted small terminal-target" data-notr>${esc(target)}</span><span id="tstate" class="small"></span><span class="spacer"></span>
        <span id="tbtns" class="row"></span></div>
      <div class="termbox"><div id="term"></div></div>
      <div class="foot">${note}</div>
    </div></div>`;

  let term = null, fit = null, tid = null, unlisten = null, alive = true, ro = null, state = 'connecting';
  let starting = false;
  const pending = [];
  const setState = (s) => {
    state = s;
    const t = el.querySelector('#tstate');
    t.textContent = s === 'open' ? '● 已接通' : s === 'connecting' ? '… 正在接通' : '○ 已断开';
    t.className = 'small ' + (s === 'open' ? 'okc' : s === 'closed' ? 'red' : 'muted');
    el.querySelector('#tbtns').innerHTML = btn('清屏', { act: 'clear', cls: 'chip' }) + btn(s === 'open' ? '重新开一个' : '重新连接', { act: 'reopen', cls: 'chip' }) +
      (onBack ? btn('返回镜像', { act: 'back', cls: 'chip' }) :
        isTauri ? btn('在系统终端打开', { act: 'external', cls: 'chip', title: '用 Windows Terminal / macOS 终端 / gnome-terminal 打开 ssh' }) : '');
    sketchAll(el);
  };

  const open = async () => {
    if (starting || !term) return;
    starting = true;
    setState('connecting');
    try {
      if (tid) {
        const previous = tid; tid = null;
        await invoke('term_close', { tid: previous });
      }
      if (!alive) return;
      const opened = await invoke('term_open', { id, cols: term.cols, rows: term.rows, ...(image && { image: image.id }) });
      if (!alive) { invoke('term_close', { tid: opened }); return; }
      tid = opened;
      setState('open');
      for (const event of pending.splice(0)) { if (event.tid === opened) onTerm(event); }
      term.focus();
    } catch (e) {
      if (!alive) return;
      setState('closed');
      term.write(`\r\n\x1b[31m没接通：${e}\x1b[0m\r\n按 Enter 重试。\r\n`);
    } finally {
      pending.length = 0;
      starting = false;
    }
  };

  const onTerm = (event) => {
    if (!alive) return;
    if (event.tid !== tid) { if (!tid && starting) pending.push(event); return; }
    if (event.data) term.write(b64(event.data));
    if (event.closed) {
      tid = null;
      setState('closed');
      term.write('\r\n\x1b[90m── 会话结束 · 按 Enter 重新连接 ──\x1b[0m\r\n');
    }
  };

  const start = async () => {
    if (!window.Terminal) { el.querySelector('#term').innerHTML = '<div class="red">终端组件没有加载。</div>'; return; }
    await Promise.all([document.fonts.load('15px "Courier Prime"'), document.fonts.load('700 15px "Courier Prime"')]).catch(() => {});
    if (!alive) return;
    term = new window.Terminal({
      theme: THEME, allowTransparency: true, cursorBlink: true, cursorStyle: 'bar', cursorWidth: 2,
      fontFamily: '"Courier Prime", "LXGW WenKai TC", "ZCOOL KuaiLe", monospace', fontSize: scaledFontSize(15), lineHeight: 1.18,
      scrollback: 5000, convertEol: false, macOptionIsMeta: true, rightClickSelectsWord: true,
    });
    fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(el.querySelector('#term'));
    fit.fit();
    // copy / paste with Ctrl+Shift+C / V (plain Ctrl+C must reach the shell)
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true;
      if (e.code === 'KeyC') { navigator.clipboard?.writeText(term.getSelection()); return false; }
      if (e.code === 'KeyV') { navigator.clipboard?.readText().then((t) => t && tid && invoke('term_write', { tid, data: t })); return false; }
      return true;
    });
    term.onData((d) => {
      if (tid && state === 'open') invoke('term_write', { tid, data: d }).catch(() => {});
      else if (d === '\r') open();
    });
    term.onResize(({ cols, rows }) => { if (tid) invoke('term_resize', { tid, cols, rows }); });
    unlisten = await listen('term', onTerm);
    if (!alive) { unlisten(); return; }
    ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
    ro.observe(el.querySelector('.termbox'));
    open();
  };

  delegate(el, {
    back: onBack,
    clear: () => term?.clear(),
    reopen: () => { term?.reset(); open(); },
    external: () => invoke('open_terminal', { id }).catch((e) => say('打不开系统终端：' + e, 'refuse')),
  });
  setState('connecting');
  start();

  return {
    update() {
      const size = scaledFontSize(15);
      if (term && term.options.fontSize !== size) { term.options.fontSize = size; fit.fit(); }
    },
    destroy() {
      alive = false;
      ro?.disconnect();
      if (tid) invoke('term_close', { tid });
      unlisten?.();
      term?.dispose();
    },
  };
}
