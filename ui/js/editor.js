// Visual file editor: highlighted source with line numbers + a structure outline, validation, safe save.
import { invoke } from './api.js';
import { say, privilege, canSudo, roleName } from './state.js';
import { btn, delegate, confirm, check } from './ui.js';
import { sketchAll } from './kit.js';
import { esc, shq } from './fmt.js';
import * as F from './fmt.js';

export const KINDS = [['json', 'JSON'], ['yaml', 'YAML'], ['shell', 'Shell'], ['ini', '配置'], ['text', '文本']];

export function detect(name, content) {
  const n = name.toLowerCase(), ext = n.includes('.') ? n.split('.').pop() : '';
  if (['json', 'jsonc', 'geojson', 'json5'].includes(ext) || ['.babelrc', '.prettierrc'].includes(n)) return 'json';
  if (['yml', 'yaml'].includes(ext)) return 'yaml';
  const sh = ['.bashrc', '.bash_profile', '.bash_login', '.bash_logout', '.bash_aliases', '.profile', '.zshrc', '.zprofile', '.zshenv', '.zlogin', '.kshrc', 'bashrc', 'profile', 'bash.bashrc'];
  if (['sh', 'bash', 'zsh', 'ksh'].includes(ext) || sh.includes(n)) return 'shell';
  const first = content.slice(0, 200).split('\n')[0];
  if (first.startsWith('#!') && first.includes('sh')) return 'shell';
  const ini = ['sshd_config', 'ssh_config', '.env', '.gitconfig', '.npmrc', '.editorconfig', 'hosts', 'fstab', 'crontab', 'sysctl.conf', 'my.cnf', 'environment'];
  if (['ini', 'conf', 'cfg', 'env', 'toml', 'properties', 'service', 'timer', 'socket', 'mount', 'desktop', 'cnf', 'network'].includes(ext) || ini.includes(n)) return 'ini';
  const t = content.trimStart();
  if (t.startsWith('{') || (t.startsWith('[') && !ext)) return 'json';
  if (t.startsWith('---')) return 'yaml';
  return 'text';
}

// ---------- highlighting (per line, regex tokenizers) ----------
const span = (cls, s) => `<span class="hl-${cls}">${esc(s)}</span>`;
function tokenize(line, re, classify) {
  let out = '', last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(line))) {
    if (m[0] === '') { re.lastIndex++; continue; }
    out += esc(line.slice(last, m.index)) + classify(m);
    last = m.index + m[0].length;
  }
  return out + esc(line.slice(last));
}
const H = {
  json: (l) => tokenize(l, /("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b/g,
    (m) => (m[1] ? (m[2] ? span('k', m[1]) + esc(m[2]) : span('s', m[1])) : m[3] ? span('n', m[3]) : span('l', m[4]))),
  yaml: (l) => {
    const cm = l.match(/(^|\s)(#.*)$/);
    let code = cm ? l.slice(0, cm.index + cm[1].length) : l;
    const tail = cm ? span('c', cm[2]) : '';
    if (/^(---|\.\.\.)\s*$/.test(code)) return span('n', code) + tail;
    const km = code.match(/^(\s*(?:-\s+)?)([^\s#'"\-][^:#]*?|'[^']*'|"[^"]*")(:)(\s|$)/);
    let head = '';
    if (km) { head = esc(km[1]).replace('-', '<span class="hl-n">-</span>') + span('k', km[2]) + esc(km[3]); code = code.slice(km[0].length - km[4].length); }
    else { const dm = code.match(/^(\s*)(-)(\s)/); if (dm) { head = esc(dm[1]) + span('n', '-') + esc(dm[3]); code = code.slice(dm[0].length); } }
    return head + tokenize(code, /('[^']*'|"(?:\\.|[^"\\])*")|(-?\b\d+(?:\.\d+)?\b)|\b(true|false|null|yes|no|on|off|True|False|Yes|No)\b|([&*][\w-]+)/g,
      (m) => (m[1] ? span('s', m[1]) : m[2] ? span('n', m[2]) : m[3] ? span('l', m[3]) : span('l', m[4]))) + tail;
  },
  shell: (l) => {
    if (/^\s*#/.test(l)) return span('c', l);
    return tokenize(l, /('[^']*'|"(?:\\.|[^"\\])*")|(\$\{[^}]*\}|\$[A-Za-z_]\w*|\$[0-9@#?*!$-]|\$\()|\b(if|then|else|elif|fi|for|while|until|do|done|case|esac|function|return|export|alias|source|local|readonly|unset|in|select)\b|(^\s*[A-Za-z_]\w*(?==))|(\s#.*$)/g,
      (m) => (m[1] ? span('s', m[1]) : m[2] ? span('v', m[2]) : m[3] ? span('k', m[3]) : m[4] ? span('k', m[4]) : span('c', m[5])));
  },
  ini: (l) => {
    if (/^\s*[#;]/.test(l)) return span('c', l);
    if (/^\s*\[.*\]\s*$/.test(l)) return span('sec', l);
    const m = l.match(/^(\s*)([^\s=:#;][^=]*?)(\s*=\s*)(.*)$/) || l.match(/^(\s*)([A-Za-z][\w.\-]*)(\s+)(.*)$/);
    if (m) return esc(m[1]) + span('k', m[2]) + esc(m[3]) + tokenize(m[4], /('[^']*'|"(?:\\.|[^"\\])*")|(-?\b\d+(?:\.\d+)?\b)/g, (x) => (x[1] ? span('s', x[1]) : span('n', x[2])));
    return esc(l);
  },
  text: (l) => esc(l),
};
export const highlight = (text, kind) => text.split('\n').map(H[kind] || H.text).join('\n') + '\n';

// ---------- ordered JSON with line/column errors ----------
export class JSONProblem extends Error { constructor(line, col, msg) { super(msg); this.line = line; this.col = col; } }
export function parseJSON(src) {
  let i = 0, line = 1, ls = 0;
  const err = (m) => new JSONProblem(line, i - ls + 1, m);
  const skip = () => { while (i < src.length) { const c = src[i]; if (c === '\n') { line++; i++; ls = i; } else if (c === ' ' || c === '\t' || c === '\r') i++; else break; } };
  const str = () => {
    i++; let out = '';
    while (i < src.length) {
      const c = src[i];
      if (c === '"') { i++; return out; }
      if (c === '\n') throw err('字符串里不能直接换行（少了右引号？）');
      if (c === '\\') {
        const e = src[++i];
        const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e in map) { out += map[e]; i++; continue; }
        if (e === 'u') { const h = src.slice(i + 1, i + 5); if (!/^[0-9a-fA-F]{4}$/.test(h)) throw err('\\u 后面要跟 4 位十六进制'); out += String.fromCharCode(parseInt(h, 16)); i += 5; continue; }
        throw err(`不认识的转义 \\${e}`);
      }
      out += c; i++;
    }
    throw err('字符串没有结束（少了右引号）');
  };
  const value = () => {
    if (i >= src.length) throw err('文件意外结束');
    const c = src[i];
    if (c === '{') {
      i++; const items = []; skip();
      if (src[i] === '}') { i++; return { t: 'obj', items }; }
      for (;;) {
        skip(); if (src[i] !== '"') throw err('这里应该是带双引号的键');
        const kl = line, k = str(); skip();
        if (src[i] !== ':') throw err(`键 "${k}" 后面少了冒号`);
        i++; skip(); const v = value(); items.push({ k, v, line: kl }); skip();
        if (i >= src.length) throw err('对象没有闭合（少了 }）');
        if (src[i] === ',') { i++; skip(); if (src[i] === '}') throw err('} 前面多了一个逗号'); continue; }
        if (src[i] === '}') { i++; return { t: 'obj', items }; }
        throw err('少了逗号或 }');
      }
    }
    if (c === '[') {
      i++; const items = []; skip();
      if (src[i] === ']') { i++; return { t: 'arr', items }; }
      for (;;) {
        skip(); const l = line, v = value(); items.push({ v, line: l }); skip();
        if (i >= src.length) throw err('数组没有闭合（少了 ]）');
        if (src[i] === ',') { i++; skip(); if (src[i] === ']') throw err('] 前面多了一个逗号'); continue; }
        if (src[i] === ']') { i++; return { t: 'arr', items }; }
        throw err('少了逗号或 ]');
      }
    }
    if (c === '"') return { t: 'str', v: str() };
    for (const [w, v] of [['true', true], ['false', false], ['null', null]]) if (src.startsWith(w, i)) { i += w.length; return { t: v === null ? 'null' : 'bool', v }; }
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i, i + 64));
    if (m) { i += m[0].length; return { t: 'num', v: m[0] }; }
    throw err(`这里不该出现 “${c}”`);
  };
  skip(); const v = value(); skip();
  if (i < src.length) throw err('后面还有多余的内容');
  return v;
}
export function writeJSON(n, pretty, ind = 0) {
  const pad = pretty ? '  '.repeat(ind + 1) : '', close = pretty ? '  '.repeat(ind) : '', nl = pretty ? '\n' : '';
  switch (n.t) {
    case 'obj': return n.items.length ? '{' + nl + n.items.map((x) => pad + JSON.stringify(x.k) + (pretty ? ': ' : ':') + writeJSON(x.v, pretty, ind + 1)).join(',' + nl) + nl + close + '}' : '{}';
    case 'arr': return n.items.length ? '[' + nl + n.items.map((x) => pad + writeJSON(x.v, pretty, ind + 1)).join(',' + nl) + nl + close + ']' : '[]';
    case 'str': return JSON.stringify(n.v);
    case 'num': return n.v;
    case 'bool': return n.v ? 'true' : 'false';
    default: return 'null';
  }
}

// ---------- outlines ----------
const prev = (s) => { s = String(s).trim(); return s.length > 70 ? s.slice(0, 70) + '…' : s; };
function tree(items) {
  const roots = [], stack = [];
  for (const [d, n] of items) {
    n.children = [];
    while (stack.length && stack[stack.length - 1][0] >= d) stack.pop();
    (stack.length ? stack[stack.length - 1][1].children : roots).push(n);
    stack.push([d, n]);
  }
  const fix = (n) => { n.children.forEach(fix); if (n.children.length && !n.tag) n.tag = `${n.children.length} 项`; };
  roots.forEach(fix);
  return roots;
}
export function outlineJSON(n) {
  const node = (v, key, path, line) => {
    if (v.t === 'obj') return { id: path, key, value: '{ … }', tag: `对象 · ${v.items.length} 键`, line, children: v.items.map((x, i) => node(x.v, x.k, `${path}/${i}`, x.line)) };
    if (v.t === 'arr') return { id: path, key, value: '[ … ]', tag: `数组 · ${v.items.length} 项`, line, children: v.items.map((x, i) => node(x.v, `[${i}]`, `${path}/${i}`, x.line)) };
    const tag = { str: '字符串', num: '数字', bool: '布尔', null: '空' }[v.t];
    return { id: path, key, value: v.t === 'str' ? prev(JSON.stringify(v.v)) : String(v.v), tag, line, children: [] };
  };
  const r = node(n, '根', 'r', 1);
  return r.children.length ? r.children : [r];
}
export function outlineYAML(text) {
  const items = [], issues = [];
  let block = null;
  text.split('\n').forEach((raw, i) => {
    const line = i + 1, lead = raw.match(/^[ \t]*/)[0];
    if (lead.includes('\t')) issues.push([line, `第 ${line} 行：缩进里有 Tab，YAML 只允许空格`]);
    const indent = lead.length, body = raw.slice(indent).trim();
    if (!body || body.startsWith('#')) return;
    if (block !== null) { if (indent > block) return; block = null; }
    if (body === '---' || body === '...') { items.push([0, { id: 'l' + line, key: '— 文档 —', value: '', tag: '', line }]); return; }
    let depth = indent, content = body, isItem = false;
    if (content === '-' || content.startsWith('- ')) { isItem = true; content = content.slice(1).trim(); }
    const m = content.match(/^([^\s#'"][^:#]*?|'[^']*'|"[^"]*"):(?:\s+(.*))?$/);
    if (m) {
      const v = m[2] || '';
      if (isItem) { items.push([depth, { id: 'i' + line, key: '•', value: '', tag: '列表项', line }]); depth += 2; }
      items.push([depth, { id: 'l' + line, key: m[1], value: prev(v), tag: v ? '值' : '', line }]);
      if (/^[|>]/.test(v)) block = depth;
    } else if (isItem) items.push([depth, { id: 'l' + line, key: '•', value: prev(content), tag: '列表项', line }]);
  });
  return { roots: tree(items), issues };
}
export function outlineShell(text) {
  const env = [], path = [], alias = [], fns = [], src = [];
  text.split('\n').forEach((raw, i) => {
    const line = i + 1, t = raw.trim();
    if (!t || t.startsWith('#')) return;
    let m;
    if ((m = raw.match(/^\s*alias\s+([^=\s]+)=(.*)$/))) alias.push({ id: 'a' + line, key: m[1], value: prev(m[2]), tag: '别名', line });
    else if ((m = raw.match(/^\s*(export\s+)?([A-Za-z_]\w*)=(.*)$/))) {
      env.push({ id: 'e' + line, key: m[2], value: prev(m[3]), tag: m[1] ? 'export' : '变量', line });
      if (m[2] === 'PATH') m[3].replace(/^["' ]+|["' ]+$/g, '').split(':').forEach((p, j) => path.push({ id: `p${line}-${j}`, key: p, value: '', tag: `第 ${line} 行`, line }));
    } else if ((m = raw.match(/^\s*function\s+([\w.:-]+)/) || raw.match(/^\s*([\w.:-]+)\s*\(\s*\)/))) fns.push({ id: 'f' + line, key: m[1] + '()', value: '', tag: '函数', line });
    else if ((m = raw.match(/^\s*(?:source|\.)\s+(\S+)/))) src.push({ id: 's' + line, key: m[1], value: '', tag: '引用', line });
  });
  return [['g-env', '环境变量', env], ['g-path', 'PATH 搜索路径', path], ['g-alias', '别名 alias', alias], ['g-fn', '函数', fns], ['g-src', '引用的文件 source', src]]
    .filter((g) => g[2].length).map(([id, key, kids]) => ({ id, key, value: '', tag: `${kids.length} 项`, line: kids[0].line, children: kids.map((k) => ({ ...k, children: [] })) }));
}
export function outlineINI(text) {
  const items = []; let inSec = false;
  text.split('\n').forEach((raw, i) => {
    const line = i + 1, t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith(';')) return;
    if (t.startsWith('[') && t.endsWith(']')) { items.push([0, { id: 's' + line, key: t, value: '', tag: '节', line }]); inSec = true; return; }
    let k = t, v = '';
    const eq = t.indexOf('=');
    if (eq >= 0) { k = t.slice(0, eq).trim(); v = t.slice(eq + 1).trim(); }
    else { const sp = t.search(/\s/); if (sp > 0) { k = t.slice(0, sp); v = t.slice(sp).trim(); } }
    items.push([inSec ? 1 : 0, { id: 'k' + line, key: k, value: prev(v), tag: '', line }]);
  });
  return tree(items);
}

// ---------- the editor view ----------
export function remoteExpr(p) {
  if (p === '~') return '"$HOME"';
  if (p.startsWith('~/')) return '"$HOME"/' + shq(p.slice(2));
  return shq(p);
}

export function mountEditor(el, { id, path, name, onClose }) {
  const st = { abs: '', text: '', orig: '', kind: 'text', auto: true, loading: true, ro: false, note: '', writable: true, elevated: false, exists: true,
    mtime: '', owner: '', perms: '', size: 0, mode: 'split', outline: [], check: null, backup: true, collapsed: new Set(), saving: false };
  el.innerHTML = `<div class="page" style="padding-top:16px;flex:1;min-height:0;gap:12px">
    <div class="row" style="align-items:flex-end" id="eh"></div>
    <div class="row top" style="flex:1;min-height:0;gap:14px;align-items:stretch">
      <div class="sk" id="ebox" style="flex:1;min-width:0;display:flex;padding:2px;background-color:#fffdf6;min-height:calc(100vh - 330px)">
        <div class="editor"><div class="gutter" id="gut"></div><div class="stack"><pre id="hl"></pre><textarea id="ta" spellcheck="false" wrap="off"></textarea></div></div>
      </div>
      <div class="card sk" id="ostruct" style="width:380px;flex:none;min-height:calc(100vh - 330px);max-height:calc(100vh - 330px)"><div class="head"><span class="kicker">Structure</span><span class="h" id="otitle"></span></div><div id="obody" style="flex:1;min-height:0;display:flex;flex-direction:column"></div></div>
    </div>
    <div class="row" id="ef"></div></div>`;
  const ta = el.querySelector('#ta'), hl = el.querySelector('#hl'), gut = el.querySelector('#gut');
  const dirty = () => st.text !== st.orig;
  let hlTimer = 0, obTimer = 0;

  const paint = () => {
    hl.innerHTML = highlight(st.text, st.kind);
    const n = st.text.split('\n').length;
    gut.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n') + '\n';
    syncScroll();
  };
  const syncScroll = () => { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; };
  ta.addEventListener('scroll', syncScroll);
  ta.addEventListener('input', () => {
    st.text = ta.value;
    clearTimeout(hlTimer); hlTimer = setTimeout(paint, st.text.length > 200000 ? 600 : 60);
    clearTimeout(obTimer); obTimer = setTimeout(() => { rebuild(); renderStruct(); renderFoot(); }, st.text.length > 200000 ? 900 : 300);
    renderHead();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, st.kind === 'yaml' ? '  ' : '    '); }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); save(); }
  });

  const goto = (line) => {
    if (st.mode === 'visual') { st.mode = 'split'; layout(); }
    const lines = st.text.split('\n');
    let pos = 0; for (let i = 0; i < Math.min(line - 1, lines.length); i++) pos += lines[i].length + 1;
    ta.focus(); ta.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
    ta.scrollTop = Math.max(0, (line - 6) * parseFloat(getComputedStyle(ta).lineHeight));
    syncScroll();
  };

  const rebuild = () => {
    if (st.kind === 'json') {
      try { st.outline = outlineJSON(parseJSON(st.text)); st.check = { ok: true, msg: 'JSON 结构正确' }; }
      catch (e) { st.check = e instanceof JSONProblem ? { ok: false, msg: `第 ${e.line} 行第 ${e.col} 列：${e.message}`, line: e.line } : { ok: false, msg: String(e) }; }
    } else if (st.kind === 'yaml') {
      const r = outlineYAML(st.text); st.outline = r.roots;
      st.check = r.issues.length ? { ok: false, msg: r.issues[0][1] + (r.issues.length > 1 ? `（另有 ${r.issues.length - 1} 处）` : ''), line: r.issues[0][0] } : { ok: true, msg: '缩进没发现问题（点「服务器校验」做完整检查）' };
    } else if (st.kind === 'shell') { st.outline = outlineShell(st.text); if (!st.check?.remote) st.check = null; }
    else if (st.kind === 'ini') { st.outline = outlineINI(st.text); st.check = null; }
    else { st.outline = []; st.check = null; }
  };

  const renderHead = () => {
    const p = privilege(id), sudoMode = st.elevated || !st.writable;
    el.querySelector('#eh').innerHTML = `${btn('← 返回目录', { act: 'back' })}
      <div class="col grow" style="gap:1px;min-width:0">
        <div class="row"><span class="kicker">Editor · ${KINDS.find((k) => k[0] === st.kind)[1]}</span>${sudoMode ? `<b class="woodc small">· ${canSudo(p) ? '以舰长身份（sudo）' : '只读：没有写权限'}</b>` : ''}</div>
        <div class="row"><span class="title" style="font-size:1.5rem">${esc(name)}</span>${dirty() ? '<b class="red">● 未保存</b>' : ''}</div>
        <div class="mono muted sel" style="font-size:0.6875rem">${esc(st.abs || path)}</div></div>
      <div class="col" style="align-items:flex-end;gap:6px">
        <div class="row"><b class="small">语法</b>${KINDS.map(([k, l]) => btn(l, { act: 'kind', cls: 'chip' + (st.kind === k ? ' active' : ''), data: `data-k="${k}"` })).join('')}</div>
        <div class="row">${[['source', '源码'], ['split', '源码 + 结构'], ['visual', '结构']].map(([m, l]) => btn(l, { act: 'mode', cls: 'chip' + (st.mode === m ? ' active' : ''), data: `data-m="${m}"` })).join('')}
          ${st.kind === 'json' ? btn('格式化', { act: 'fmt', cls: 'chip', disabled: st.ro }) + btn('压缩', { act: 'min', cls: 'chip', disabled: st.ro }) : ''}
          ${st.kind === 'shell' || st.kind === 'yaml' ? btn('服务器校验', { act: 'rcheck', cls: 'chip' }) : ''}
          ${btn('重新读取', { act: 'reload', cls: 'chip' })}
          ${btn(st.saving ? '保存中…' : sudoMode ? '以舰长身份保存 Ctrl+S' : '保存 Ctrl+S', { act: 'save', cls: 'solid', disabled: st.saving || st.ro || st.loading || (!dirty() && st.exists) })}</div></div>`;
    sketchAll(el);
  };
  const renderFoot = () => {
    const c = st.check;
    el.querySelector('#ef').innerHTML = (c ? `<b class="${c.ok ? 'okc' : 'red'}" style="font-size:0.9375rem">${c.ok ? '✓' : '✗'} ${esc(c.msg)}</b>${c.line ? btn(`跳到第 ${c.line} 行`, { act: 'goto', cls: 'chip', data: `data-l="${c.line}"` }) : ''}` : '') +
      (st.note ? `<span class="woodc small">${esc(st.note)}</span>` : '') + '<span class="spacer"></span>' +
      `<span class="mono muted" style="font-size:0.625rem">${[st.size ? F.bytes(st.size) : '', st.owner, st.perms].filter(Boolean).join(' · ')}</span>` + check('保存前备份为 .rackbook.bak', st.backup, 'backup');
    sketchAll(el);
  };
  const renderStruct = () => {
    el.querySelector('#otitle').textContent = { json: 'JSON 树', yaml: 'YAML 大纲', shell: '这个脚本设置了什么', ini: '配置项', text: '文本概况' }[st.kind];
    const ob = el.querySelector('#obody');
    if (st.kind === 'text') {
      const ls = st.text.split('\n');
      const row = (k, v) => `<div class="row"><b style="color:#5d6c9c;font-size:0.9375rem">${k}</b><span class="spacer"></span><span class="mono small">${esc(v)}</span></div>`;
      ob.innerHTML = row('行数', ls.length) + row('词数', st.text.split(/\s+/).filter(Boolean).length) + row('字符', st.text.length) + row('最长一行', Math.max(...ls.map((l) => l.length)) + ' 字符') +
        row('换行符', st.text.includes('\r\n') ? 'Windows (CRLF)' : 'Unix (LF)') + row('行尾多余空白', ls.filter((l) => /[ \t]$/.test(l)).length + ' 行') + row('结尾换行', st.text.endsWith('\n') ? '有' : '没有');
      return;
    }
    if (!st.outline.length) { ob.innerHTML = `<div class="muted">${st.check && !st.check.ok ? '先修好语法错误，结构才画得出来。' : '这个文件里没有可以列出的结构。'}</div>`; return; }
    const rows = [];
    const walk = (ns, d) => { for (const n of ns) { if (rows.length > 4000) return; rows.push([n, d]); if (n.children.length && !st.collapsed.has(n.id)) walk(n.children, d + 1); } };
    walk(st.outline, 0);
    ob.innerHTML = `<div class="row"><span class="muted small">点任意一项跳到源码</span><span class="spacer"></span>${btn('全部展开', { act: 'expand', cls: 'chip' })}${btn('全部收起', { act: 'collapse', cls: 'chip' })}</div>
      <div style="overflow:auto;flex:1;min-height:0;margin-top:6px">${rows.map(([n, d]) => `<div class="outline-row" data-act="jump" data-l="${n.line}">
        <span class="indent" style="width:${d * 16}px;background:repeating-linear-gradient(to right, transparent 0 7px, rgba(127,157,179,.8) 7px 8px, transparent 8px 16px)"></span>
        <span class="tw" ${n.children.length ? `data-act="tog" data-id="${esc(n.id)}"` : ''}>${n.children.length ? (st.collapsed.has(n.id) ? '▸' : '▾') : '·'}</span>
        <span class="k"${/^g-/.test(n.id) || n.key === '根' || n.key === '•' || n.key === '— 文档 —' ? '' : ' data-notr'}>${esc(n.key)}</span>${n.value ? `<span class="v" data-notr>${esc(n.value)}</span>` : ''}<span class="t">${esc(n.tag)}</span><span class="ln">${n.line}</span></div>`).join('')}</div>`;
    sketchAll(el);
  };
  const layout = () => {
    el.querySelector('#ebox').classList.toggle('hidden', st.mode === 'visual');
    const os = el.querySelector('#ostruct');
    os.classList.toggle('hidden', st.mode === 'source');
    os.style.width = st.mode === 'visual' ? 'auto' : '380px';
    os.style.flex = st.mode === 'visual' ? '1' : 'none';
    renderHead();
  };
  const all = () => { ta.value = st.text; ta.readOnly = st.ro; paint(); rebuild(); renderHead(); renderStruct(); renderFoot(); layout(); };

  const load = async () => {
    st.loading = true; st.note = ''; st.elevated = false; renderHead();
    const rp = remoteExpr(path);
    const cmd = `F=${rp}; printf '%s\\n' "$F"; if [ -e "$F" ]; then stat -c '%Y %s %U %a' -- "$F"; ([ -w "$F" ] && echo W) || echo RO; else echo NONE; ([ -w "$(dirname -- "$F")" ] && echo W) || echo RO; fi; echo @@BODY; if [ -e "$F" ]; then head -c 1048577 -- "$F"; fi`;
    let r = await invoke('run', { id, cmd, timeout: 60 });
    const at = r.out.indexOf('@@BODY\n');
    if (at < 0) { st.loading = false; st.ro = true; st.note = '读不到：' + (r.err.trim() || `退出码 ${r.code}`); say(`还不行：${path} 读不出来。`, 'refuse'); all(); return; }
    const head = r.out.slice(0, at).split('\n').filter(Boolean);
    let body = r.out.slice(at + 7);
    st.abs = head[0] || path;
    st.writable = (head[2] || 'RO') === 'W';
    if ((head[1] || 'NONE') === 'NONE') { st.exists = false; st.size = 0; st.mtime = st.owner = st.perms = ''; st.note = '文件还不存在，保存时会新建。'; }
    else { st.exists = true; const f = head[1].split(' '); st.mtime = f[0]; st.size = +f[1] || 0; st.owner = f[2] || ''; st.perms = f[3] || ''; }
    const p = privilege(id);
    if (st.exists && r.code !== 0 && r.err.includes('Permission denied')) {
      if (canSudo(p)) { r = await invoke('sudo', { id, cmd: `head -c 1048577 -- ${shq(st.abs)}`, timeout: 60 }); if (r.code === 0) { body = r.out; st.elevated = true; st.note = '以舰长身份（sudo）读取。'; } }
      if (!st.elevated) { st.loading = false; st.ro = true; st.text = st.orig = ''; st.note = '没有读权限' + (canSudo(p) ? '（sudo 也失败了）' : '；需要舰长账户'); say(`还不行：${st.abs} 没有读权限。${canSudo(p) ? '' : '你是领航员，可以在右上角换成舰长账户。'}`, 'refuse'); all(); return; }
    }
    st.ro = false;
    if (new TextEncoder().encode(body).length > 1048576) { st.ro = true; st.note = '超过 1 MB：只读，显示前 1 MB。'; }
    if (body.includes('\u0000')) { st.ro = true; body = '（这是一个二进制文件，不能在这里编辑。可以回到目录里下载到电脑。）'; st.note = '二进制文件'; }
    else if (body.includes('\uFFFD')) { st.ro = true; st.note = '不是 UTF-8 编码：只读，避免保存时损坏内容。'; }
    if (!st.writable && !st.elevated && !canSudo(p)) { st.ro = true; st.note = (st.note ? st.note + ' ' : '') + `没有写权限：${roleName(p)}只能查看。`; }
    if (st.auto) st.kind = detect(name, body);
    st.text = st.orig = body; st.loading = false;
    all();
    say(`打开 ${st.abs}（${KINDS.find((k) => k[0] === st.kind)[1]}${st.ro ? '，只读' : ''}）。`);
  };

  const remoteCheck = async (announce) => {
    let cmd;
    if (st.kind === 'shell') cmd = `${name.includes('zsh') ? 'zsh' : 'bash'} -n 2>&1`;
    else if (st.kind === 'yaml') cmd = `python3 -c 'import sys,yaml; list(yaml.safe_load_all(sys.stdin))' 2>&1 || echo '@@FAIL'`;
    else return null;
    const r = await invoke('run', { id, cmd, stdin: st.text, timeout: 30 });
    const out = r.out.replace('@@FAIL', '').trim();
    let c;
    if (st.kind === 'yaml' && out.includes('No module named')) c = { ok: true, msg: '服务器上没有 PyYAML，只做了本地缩进检查' };
    else if (r.code === 0 && !r.out.includes('@@FAIL') && !out) c = { ok: true, msg: st.kind === 'shell' ? 'bash 语法检查通过' : 'YAML 校验通过（PyYAML）' };
    else { const msg = out || r.err.trim() || `退出码 ${r.code}`; const m = msg.match(/line (\d+)/); c = { ok: false, msg: msg.split('\n')[0], line: m ? +m[1] : null }; }
    c.remote = true; st.check = c; renderFoot();
    if (announce) say(c.ok ? c.msg + '。' : '校验没通过：' + c.msg, c.ok ? 'ok' : 'refuse');
    return c;
  };

  const save = async (force = false) => {
    if (st.ro) { say(`还不行：这个文件是只读的（${st.note}）。`, 'refuse'); return; }
    if (st.saving || (!dirty() && st.exists)) return;
    if (!force) {
      if (st.exists) {
        const r = await invoke('run', { id, cmd: `stat -c %Y -- ${shq(st.abs)}`, timeout: 15 });
        if (r.code === 0 && r.out.trim() && r.out.trim() !== st.mtime) {
          if (!await confirm('服务器上的文件被改过了', `你打开以后，${st.abs} 在服务器上被修改过。保存会覆盖那些改动。`, '仍然保存')) return;
        }
      }
      if (st.kind === 'json') { try { parseJSON(st.text); } catch (e) { if (e instanceof JSONProblem && !await confirm('JSON 有错误', `第 ${e.line} 行第 ${e.col} 列：${e.message}。保存后，读取这个文件的程序可能会出错。`, '仍然保存')) return; } }
      if (st.kind === 'shell') { const c = await remoteCheck(false); if (c && !c.ok && !await confirm('bash 语法检查没通过', c.msg + '。保存后，新开的终端可能会报错。', '仍然保存')) return; }
    }
    const p = privilege(id), useSudo = st.elevated || !st.writable;
    if (useSudo && !canSudo(p)) { say(`还不行：没有写权限，而你是${roleName(p)}。在右上角换成舰长账户再保存。`, 'refuse'); return; }
    st.saving = true; renderHead();
    let backed = false;
    if (st.backup && st.exists) {
      const cmd = `cp -p -- ${shq(st.abs)} ${shq(st.abs + '.rackbook.bak')}`;
      const r = await invoke(useSudo ? 'sudo' : 'run', { id, cmd });
      backed = r.code === 0;
    }
    const content = st.text;
    const r = await invoke('write_file', { id, path: st.abs, content, elevated: useSudo });
    st.saving = false;
    if (r.code === 0) {
      st.orig = content; st.exists = true; st.note = '';
      const s = await invoke('run', { id, cmd: `stat -c '%Y %s %U %a' -- ${shq(st.abs)}`, timeout: 15 });
      const f = s.out.trim().split(' '); if (f.length >= 4) { [st.mtime] = f; st.size = +f[1]; st.owner = f[2]; st.perms = f[3]; }
      say(`已保存 ${st.abs}` + (backed ? `，旧版本备份在 ${name}.rackbook.bak` : '') + (useSudo ? '（以舰长身份）' : '') + '。', 'ok');
    } else if (!useSudo && r.err.includes('Permission denied')) {
      st.writable = false;
      say(canSudo(p) ? '没有写权限。按钮已变成「以舰长身份保存」，再按一次即可。' : '没有写权限，而你是领航员。换成舰长账户再保存。', 'refuse');
    } else say('没保存成功：' + (r.err.trim() || `退出码 ${r.code}`), 'refuse');
    renderHead(); renderFoot();
  };

  delegate(el, {
    back: async () => { if (dirty() && !await confirm('放弃未保存的修改？', '返回目录后，这次的修改会丢失。', '放弃修改')) return; onClose(); },
    kind: (b) => { st.auto = false; st.kind = b.dataset.k; st.check = null; all(); },
    mode: (b) => { st.mode = b.dataset.m; layout(); },
    fmt: () => fmt(true), min: () => fmt(false),
    rcheck: () => remoteCheck(true),
    reload: () => { if (dirty()) { say('还不行：有未保存的修改。先保存，或者返回后再打开。', 'refuse'); return; } load(); },
    save: () => save(),
    goto: (b) => goto(+b.dataset.l),
    jump: (b, e) => { if (e.target.closest('[data-act="tog"]')) return; goto(+b.dataset.l); },
    tog: (b) => { const k = b.dataset.id; st.collapsed.has(k) ? st.collapsed.delete(k) : st.collapsed.add(k); renderStruct(); },
    expand: () => { st.collapsed.clear(); renderStruct(); },
    collapse: () => { const w = (ns) => ns.forEach((n) => { if (n.children.length) { st.collapsed.add(n.id); w(n.children); } }); w(st.outline); renderStruct(); },
    backup: () => { st.backup = !st.backup; renderFoot(); },
  });
  // nested toggles: clicks on the chevron should not also jump
  el.querySelector('#obody').addEventListener('click', (e) => {
    const t = e.target.closest('[data-act="tog"]');
    if (t) { e.stopPropagation(); const k = t.dataset.id; st.collapsed.has(k) ? st.collapsed.delete(k) : st.collapsed.add(k); renderStruct(); }
  }, true);
  function fmt(pretty) {
    try { st.text = writeJSON(parseJSON(st.text), pretty) + (pretty ? '\n' : ''); ta.value = st.text; paint(); rebuild(); renderStruct(); renderFoot(); renderHead(); say(pretty ? '已格式化（两个空格缩进，键的顺序不变）。' : '已压缩成一行。'); }
    catch { say('还不行：JSON 里有错误，先修好再格式化。', 'refuse'); }
  }
  load();
  return { dirty };
}
