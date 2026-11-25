import { invoke, openDialog, saveDialog, isTauri } from '../api.js';
import { say } from '../state.js';
import { btn, delegate, confirm, prompt } from '../ui.js';
import { C, sketchAll } from '../kit.js';
import { mountEditor } from '../editor.js';
import * as F from '../fmt.js';
import { esc, shq } from '../fmt.js';

const QUICK = ['~/.bashrc', '~/.profile', '~/.bash_aliases', '~/.zshrc', '/etc/hosts', '/etc/ssh/sshd_config', '/etc/docker/daemon.json', '/etc/fstab', '/etc/crontab', '/etc/environment'];
const cwdBy = {};

const glyph = (k) => k === 'd'
  ? `<svg width="22" height="18" viewBox="0 0 22 18"><path d="M2 4 H8 L10 6 H20 V16 H2 Z" fill="${C.tan}" stroke="${C.ink}" stroke-width="1.1" stroke-linejoin="round"/></svg>`
  : `<svg width="22" height="18" viewBox="0 0 22 18"><path d="M5 1 H13 L17 5 V17 H5 Z" fill="${k === 'l' ? C.sky : C.cream}" stroke="${C.ink}" stroke-width="1.1" stroke-linejoin="round"/><path d="M8 8 H14 M8 11 H14 M8 14 H12" stroke="${C.pencil}" stroke-width=".8"/></svg>`;

export function mount(el, { id }) {
  let cwd = cwdBy[id] || '', entries = [], filter = '', hidden = false, sel = null, editing = null, err = '';
  const full = (n) => (cwd === '/' ? '/' + n : cwd + '/' + n);

  const showList = () => {
    editing = null;
    el.innerHTML = `<div class="page" style="padding-top:18px;flex:1;min-height:0">
      <div class="card sk" id="fcard" style="flex:1;min-height:0">
        <div class="head"><span class="kicker">Files</span><span class="h">文件目录</span></div>
        <div class="row">${btn('⌂', { act: 'home', cls: 'chip', title: '主目录' })}${btn('↑', { act: 'up', cls: 'chip', title: '上一级' })}<div id="crumbs" class="row grow" style="overflow:auto;white-space:nowrap;font-family:var(--mono);font-weight:700"></div>${btn('↻', { act: 'reload', cls: 'chip', title: '刷新' })}</div>
        <div class="row"><input class="field sk mono" id="goto" placeholder="前往路径，例如 /var/log"><input class="field sk" id="flt" style="width:160px" placeholder="筛选…">
          <span id="hidBtn"></span>${btn('新建文件', { act: 'newfile', cls: 'chip' })}${btn('新建文件夹', { act: 'mkdir', cls: 'chip' })}${btn('上传…', { act: 'upload', cls: 'chip' })}</div>
        <div class="row" style="flex-wrap:wrap"><b class="red small">常用文件</b>${QUICK.map((p) => btn(p, { act: 'quick', cls: 'chip', data: `data-p="${p}"` })).join('')}</div>
        <div id="ferr" class="red"></div>
        <div style="overflow:auto;flex:1;min-height:240px" id="flist"></div>
        <div class="foot" id="ffoot"></div>
      </div></div>`;
    el.querySelector('#goto').addEventListener('keydown', (e) => { if (e.key === 'Enter') list(e.target.value.trim()); });
    el.querySelector('#flt').addEventListener('input', (e) => { filter = e.target.value.toLowerCase(); render(); });
    const fl = el.querySelector('#flist');
    // selecting only re-colours the rows: re-rendering the table on the first click would replace the row under
    // the pointer, and the browser then never fires the double-click on it
    const mark = (name) => {
      sel = name;
      fl.querySelectorAll('tr[data-n]').forEach((tr) => (tr.style.background = tr.dataset.n === name ? 'rgba(244,184,41,.5)' : ''));
    };
    fl.addEventListener('click', (e) => {
      const r = e.target.closest('[data-n]');
      if (!r) return;
      if (e.detail >= 2) open(entries.find((x) => x.name === r.dataset.n));
      else mark(r.dataset.n);
    });
    fl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && sel) open(entries.find((x) => x.name === sel)); });
    fl.tabIndex = 0;
    fl.addEventListener('contextmenu', (e) => { const r = e.target.closest('[data-n]'); if (!r) return; e.preventDefault(); mark(r.dataset.n); menu(entries.find((x) => x.name === sel), e.clientX, e.clientY); });
    // drag & drop upload (Tauri provides real paths through its own drop event)
    if (isTauri && window.__TAURI__.webview) {
      window.__TAURI__.webview.getCurrentWebview().onDragDropEvent((ev) => {
        if (editing || !el.isConnected) return;
        if (ev.payload.type === 'drop' && ev.payload.paths?.length) upload(ev.payload.paths);
      }).then((un) => { unlisten = un; });
    }
    render();
  };
  let unlisten = null;

  const render = () => {
    if (editing) return;
    const parts = cwd.split('/').filter(Boolean);
    el.querySelector('#crumbs').innerHTML = `<span data-act="crumb" data-p="/" style="cursor:pointer">/</span>` + parts.map((p, i) => `<span data-act="crumb" data-p="/${parts.slice(0, i + 1).join('/')}" style="cursor:pointer">${esc(p)}</span>`).join('<span class="muted">/</span>');
    el.querySelector('#hidBtn').innerHTML = btn(hidden ? '隐藏 .' : '显示 .', { act: 'hid', cls: 'chip' + (hidden ? ' active' : '') });
    el.querySelector('#ferr').textContent = err;
    const shown = entries.filter((e) => (hidden || !e.name.startsWith('.')) && (!filter || e.name.toLowerCase().includes(filter)));
    el.querySelector('#flist').innerHTML = `<table class="sheet"><tr><th style="width:26px"></th><th>名称</th><th class="r">大小</th><th>修改时间</th><th>权限</th><th>所有者</th></tr>` +
      shown.map((e) => `<tr data-n="${esc(e.name)}" style="cursor:default;${sel === e.name ? 'background:rgba(244,184,41,.5)' : ''}"><td>${glyph(e.isDir ? 'd' : e.kind === 'l' ? 'l' : 'f')}</td>
        <td class="hand" data-notr style="font-size:16px;${e.isDir ? 'font-weight:700' : ''}">${esc(e.name)}${e.kind === 'l' ? ' ↗' : ''}</td><td class="r">${e.isDir ? '—' : F.bytes(e.size)}</td><td>${F.date(e.mtime)}</td><td>${esc(e.perms)}</td><td>${esc(e.owner)}</td></tr>`).join('') + '</table>';
    el.querySelector('#ffoot').textContent = `${shown.length} 项 · 双击进入文件夹，或在可视化编辑器里打开文件 · 右键可下载、改名、删除` + (isTauri ? ' · 把资源管理器里的文件拖进来即上传' : '');
    sketchAll(el);
  };

  const list = async (target) => {
    const cd = !target ? 'cd' : target.startsWith('~') ? `cd -- "$HOME"${target.length > 1 ? '/' + shq(target.replace(/^~\/?/, '')) : ''}` : `cd -- ${shq(target)}`;
    const r = await invoke('run', { id, cmd: `${cd} && pwd && LC_ALL=C find . -mindepth 1 -maxdepth 1 -printf '%y\\t%Y\\t%s\\t%T@\\t%M\\t%u\\t%P\\n' 2>/dev/null | head -n 5000`, timeout: 30 });
    if (r.code !== 0) { err = `打不开 ${target || '主目录'}：${r.err.trim() || '退出码 ' + r.code}`; say(`还不行：${target} 打不开。`, 'refuse'); render(); return; }
    const lines = r.out.split('\n').filter(Boolean);
    cwd = cwdBy[id] = lines.shift();
    entries = lines.map((l) => l.split('\t')).filter((f) => f.length >= 7).map((f) => ({ kind: f[0], linkDir: f[1] === 'd', size: +f[2], mtime: +f[3], perms: f[4], owner: f[5], name: f.slice(6).join('\t') }))
      .map((e) => ({ ...e, isDir: e.kind === 'd' || (e.kind === 'l' && e.linkDir) }))
      .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, 'zh', { numeric: true })));
    err = ''; sel = null;
    if (!editing) { const g = el.querySelector('#goto'); if (g) g.value = cwd; render(); }
    say(`${cwd}：${entries.length} 项。`);
  };

  const open = (e) => {
    if (!e) return;
    if (e.isDir) { list(full(e.name)); return; }
    if (e.kind !== 'f' && e.kind !== 'l') { say(`「${e.name}」不是普通文件，不能打开。`, 'refuse'); return; }
    edit(full(e.name), e.name);
  };
  const edit = (path, name) => {
    el.innerHTML = '';
    const host = document.createElement('div');
    host.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0';
    el.appendChild(host);
    editing = mountEditor(host, { id, path, name, onClose: () => { showList(); list(cwd); } });
  };
  // list-page buttons only act while the list is showing (the editor has its own handlers)
  const guard = (h) => Object.fromEntries(Object.entries(h).map(([k, f]) => [k, (...a) => (editing ? undefined : f(...a))]));

  const menu = (e, x, y) => {
    document.querySelectorAll('.popover').forEach((p) => p.remove());
    const p = document.createElement('div');
    p.className = 'popover sk'; p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.width = '210px';
    p.innerHTML = [['open', e.isDir ? '打开' : '在编辑器里打开'], ['download', '下载到电脑…'], ['du', '计算大小'], ['copy', '复制路径'], ['rename', '重命名…'], ['delete', '删除…']]
      .map(([a, l]) => `<div class="menu-item ${a === 'delete' ? 'red' : ''}" data-act="${a}">${l}</div>`).join('');
    document.body.appendChild(p);
    const close = () => p.remove();
    setTimeout(() => document.addEventListener('mousedown', function off(ev) { if (!p.contains(ev.target)) { close(); document.removeEventListener('mousedown', off); } }));
    delegate(p, {
      open: () => { close(); open(e); },
      download: () => { close(); download(e); },
      du: async () => { close(); say(`正在计算 ${e.name} 的大小…`); const r = await invoke('run', { id, cmd: `du -sh -- ${shq(full(e.name))} 2>/dev/null | cut -f1`, timeout: 120 }); say(r.out.trim() ? `${e.name} 共占 ${r.out.trim()}。` : '没算出来（可能没有权限）。', r.out.trim() ? 'ok' : 'warn'); },
      copy: () => { close(); navigator.clipboard?.writeText(full(e.name)); say(`已复制：${full(e.name)}`); },
      rename: async () => {
        close();
        const n = await prompt('重命名', e.name, e.name, '改名');
        if (!n || n === e.name || n.includes('/')) return;
        const r = await invoke('run', { id, cmd: `mv -n -- ${shq(full(e.name))} ${shq(full(n))}` });
        say(r.code === 0 ? `「${e.name}」改名为「${n}」。` : '没改成：' + r.err.trim(), r.code === 0 ? 'ok' : 'refuse'); list(cwd);
      },
      delete: async () => {
        close();
        if (!await confirm(`永久删除「${e.name}」？`, e.isDir ? '这是一个文件夹，里面的内容会一起删除。服务器上没有回收站，删了就找不回来。' : '服务器上没有回收站，删了就找不回来。', '永久删除')) return;
        const r = await invoke('run', { id, cmd: (e.kind === 'd' ? 'rm -rf -- ' : 'rm -f -- ') + shq(full(e.name)), timeout: 120 });
        say(r.code === 0 ? `已删除 ${full(e.name)}。` : '没删掉：' + r.err.trim(), r.code === 0 ? 'ok' : 'refuse'); list(cwd);
      },
    });
  };

  const download = async (e) => {
    if (!isTauri) { say('浏览器预览里不能下载。', 'refuse'); return; }
    const local = await saveDialog({ defaultPath: e.isDir ? `${e.name}.tar.gz` : e.name, title: `把「${e.name}」保存到…` });
    if (!local) return;
    say(`正在下载 ${e.name}…`);
    try { say(await invoke('download', { id, remote: full(e.name), isDir: e.isDir, local }), 'ok'); } catch (x) { say('下载失败：' + x, 'refuse'); }
  };
  const upload = async (paths) => {
    if (!paths?.length) return;
    say(`正在上传 ${paths.length} 项到 ${cwd}…`);
    try { say(await invoke('upload', { id, locals: paths, remoteDir: cwd }), 'ok'); } catch (x) { say('上传失败：' + x, 'refuse'); }
    list(cwd);
  };

  showList();
  delegate(el, guard({
    home: () => list(''),
    up: () => { if (!cwd || cwd === '/') { say('已经在根目录了，没有上一级。', 'refuse'); return; } list(cwd.replace(/\/[^/]*$/, '') || '/'); },
    reload: () => list(cwd),
    crumb: (b) => list(b.dataset.p),
    hid: () => { hidden = !hidden; render(); },
    quick: (b) => edit(b.dataset.p, b.dataset.p.split('/').pop()),
    newfile: async () => { const n = await prompt('新建文件', `在 ${cwd} 里新建；保存时才真正写到服务器上。`, '', '在编辑器里打开'); if (n && !n.includes('/')) edit(full(n), n); },
    mkdir: async () => { const n = await prompt('新建文件夹', `在 ${cwd} 里新建。`, '', '创建'); if (!n || n.includes('/')) return; const r = await invoke('run', { id, cmd: `mkdir -- ${shq(full(n))}` }); say(r.code === 0 ? `建好了文件夹 ${n}。` : '没建成：' + r.err.trim(), r.code === 0 ? 'ok' : 'refuse'); list(cwd); },
    upload: async () => {
      if (!isTauri) { say('浏览器预览里不能上传。', 'refuse'); return; }
      const f = await openDialog({ multiple: true, title: `上传到 ${cwd}` });
      upload(Array.isArray(f) ? f : f ? [f] : []);
    },
  }));
  list(cwd);
  return { update() {}, destroy() { unlisten?.(); } };
}
