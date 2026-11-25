// Runtime translation. The UI is written in Simplified Chinese; every string shown (DOM text, placeholders,
// titles, canvas labels, status messages) is mapped through tr() into the chosen language.
import DICT from './i18n-dict.js';

export const LANGS = [['en', 'English'], ['ja', '日本語'], ['es', 'Español'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['ko', '한국어']];
const COL = { en: 0, ja: 1, es: 2, ko: 3, 'zh-TW': 4 };
const CJK = /[㐀-鿿、-〿！-｠]/;
let lang = 'zh-CN';
let memo = new Map();

export function detectLang() {
  const n = (navigator.language || 'en').toLowerCase();
  if (n.startsWith('zh')) return /tw|hk|mo|hant/.test(n) ? 'zh-TW' : 'zh-CN';
  for (const l of ['ja', 'ko', 'es']) if (n.startsWith(l)) return l;
  return 'en';
}
export const getLang = () => lang;
export function setLang(l) {
  lang = LANGS.some((x) => x[0] === l) ? l : detectLang();
  memo = new Map();
  document.documentElement.lang = lang;
  try { localStorage.setItem('rackbook.lang', lang); } catch {}
}

// patterns for strings with values: "正在呼叫 {0} 艘舰船…" -> /^正在呼叫 (.+?) 艘舰船…$/
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERNS = Object.keys(DICT).filter((k) => /\{\d+\}/.test(k)).map((k) => {
  const order = [];
  const src = esc(k).replace(/\\\{(\d+)\\\}/g, (_, n) => { order.push(+n); return '([\\s\\S]+?)'; });
  return { k, re: new RegExp('^' + src + '$'), order, lit: k.replace(/\{\d+\}/g, '').length };
}).filter((p) => p.lit > 0).sort((a, b) => b.lit - a.lit);
// glue pieces: "没保存成功：" + error, text + "，只读"
const PREFIX = Object.keys(DICT).filter((k) => !/\{\d+\}/.test(k) && /[：（:]$/.test(k)).sort((a, b) => b.length - a.length);
const SUFFIX = Object.keys(DICT).filter((k) => !/\{\d+\}/.test(k) && /^[，；。（）、]/.test(k)).sort((a, b) => b.length - a.length);

function core(t, depth) {
  const hit = DICT[t];
  if (hit) return hit[COL[lang]];
  if (depth > 4) return t;
  for (const p of PATTERNS) {
    const m = p.re.exec(t);
    if (!m) continue;
    let out = DICT[p.k][COL[lang]];
    p.order.forEach((n, i) => { out = out.split(`{${n}}`).join(tr(m[i + 1], depth + 1)); });
    return out;
  }
  if (t.includes(' · ')) return t.split(' · ').map((x) => tr(x, depth + 1)).join(' · ');
  let g = /^([★✦●○◆◇▲▼·•+＋\-–→←↑↓✓✗⚠]+ ?)([\s\S]+)$/.exec(t);
  if (g) return g[1] + tr(g[2], depth + 1);
  g = /^([\s\S]*?[\u3000-\u9fff\uff00-\uffef])( [\x21-\x7e][\x20-\x7e]*)$/.exec(t);
  if (g && DICT[g[1]]) return tr(g[1], depth + 1) + g[2];
  g = /^([\x21-\x7e][\x20-\x7e]* )([\s\S]*[\u3000-\u9fff][\s\S]*)$/.exec(t);
  if (g && DICT[g[2]]) return g[1] + tr(g[2], depth + 1);
  for (const k of PREFIX) if (t.length > k.length && t.startsWith(k)) return DICT[k][COL[lang]] + tr(t.slice(k.length), depth + 1);
  for (const k of SUFFIX) if (t.length > k.length && t.endsWith(k)) return tr(t.slice(0, -k.length), depth + 1) + DICT[k][COL[lang]];
  return t;
}

export function tr(s, depth = 0) {
  if (lang === 'zh-CN' || s == null) return s;
  s = String(s);
  if (!CJK.test(s)) return s;
  const c = memo.get(s);
  if (c !== undefined) return c;
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const out = m[1] + core(m[2].replace(/\s+/g, ' '), depth) + m[3];
  if (memo.size > 5000) memo.clear();
  memo.set(s, out);
  return out;
}

// ---------- apply to the DOM ----------
const SKIP = 'textarea, script, style, [data-notr], .editor';
function trText(n) {
  const p = n.parentElement;
  if (!p || p.closest(SKIP)) return;
  const v = n.nodeValue, o = tr(v);
  if (o !== v) n.nodeValue = o;
}
function trAttrs(el) {
  for (const a of ['placeholder', 'title', 'aria-label']) {
    const v = el.getAttribute && el.getAttribute(a);
    if (v) { const o = tr(v); if (o !== v) el.setAttribute(a, o); }
  }
}
function trTree(root) {
  if (lang === 'zh-CN') return;
  if (root.nodeType === 3) { trText(root); return; }
  if (root.nodeType !== 1 || root.closest?.(SKIP)) return;
  trAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let n;
  while ((n = w.nextNode())) (n.nodeType === 3 ? trText(n) : trAttrs(n));
}
export function startDomTranslation() {
  if (lang === 'zh-CN') return;
  trTree(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') trText(m.target);
      else if (m.type === 'attributes') trAttrs(m.target);
      else m.addedNodes.forEach(trTree);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title'] });
  if (document.title) document.title = tr(document.title);
}
