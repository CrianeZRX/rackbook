// Small HTML builders and dialogs in the sketch style.
import { esc } from './fmt.js';
import { loadColor } from './kit.js';
import { healthColor, roleName, privDetail, isCaptain } from './state.js';

export const h = (strings, ...vals) => strings.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ''), '');

export function meter(label, value, textVal, color) {
  const v = Math.max(0, Math.min(1, isFinite(value) ? value : 0));
  return `<div class="meter"><span class="lab">${esc(label)}</span><span class="bar"><i style="width:${(v * 100).toFixed(1)}%;background:${color || loadColor(v * 100)}"></i></span><span class="val">${esc(textVal)}</span></div>`;
}
export function bar(value, color, height = 9) {
  const v = Math.max(0, Math.min(1, isFinite(value) ? value : 0));
  return `<span class="bar" style="height:${height}px"><i style="width:${(v * 100).toFixed(1)}%;background:${color || loadColor(v * 100)}"></i></span>`;
}
export const dot = (health, size = 12) => `<span class="dot" style="width:${size}px;height:${size}px;background:${healthColor[health] || '#c6ccce'}${health === 'down' ? ';border-color:#c8372f' : ''}"></span>`;
export function badge(priv, small = false) {
  const cls = priv === 'unknown' ? 'unk' : isCaptain(priv) ? 'cap' : 'nav';
  const mark = isCaptain(priv) ? '★ ' : priv === 'none' ? '✦ ' : '';
  return `<span class="badge ${cls}${small ? ' small' : ''}" title="${esc(privDetail(priv))}">${mark}${roleName(priv)}</span>`;
}
export function titleBlock(kicker, title, sub, rawTitle = false) {
  return `<div class="col" style="gap:2px;min-width:0"><div class="kicker">${esc(kicker)}</div><div class="title"${rawTitle ? ' data-notr' : ''}>${esc(title)}</div><div class="underline rule-h" data-ink="#c8372f" data-width="2"></div>${sub ? `<div class="subtitle">${esc(sub)}</div>` : ''}</div>`;
}
export function card(inner, { kicker, title, lit = false, cls = '', style = '', attrs = '' } = {}) {
  const head = kicker || title ? `<div class="head">${kicker ? `<span class="kicker">${esc(kicker)}</span>` : ''}${title ? `<span class="h">${esc(title)}</span>` : ''}</div>` : '';
  return `<div class="card sk${lit ? ' lit' : ''} ${cls}" style="${style}" ${attrs}>${head}${inner}</div>`;
}
export const btn = (label, { cls = '', act = '', data = '', title = '', disabled = false } = {}) =>
  `<button class="btn sk ${cls}" ${act ? `data-act="${act}"` : ''} ${data} ${title ? `title="${esc(title)}"` : ''} ${disabled ? 'disabled' : ''}>${esc(label)}</button>`;
export function check(label, on, act = '', data = '') {
  return `<div class="check" data-act="${act}" ${data}><svg class="box" viewBox="0 0 17 17"><rect x="1.5" y="1.5" width="14" height="14" fill="${on ? '#f4b829' : 'none'}" stroke="#231e16" stroke-width="1.2" rx="1"/>${on ? '<path d="M4 9 L7.5 13 L15.5 1.5" fill="none" stroke="#c8372f" stroke-width="2" stroke-linecap="round"/>' : ''}</svg><span>${esc(label)}</span></div>`;
}

// ---------- event delegation ----------
export function delegate(root, handlers) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el) || el.disabled) return;
    const fn = handlers[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
}

// ---------- dialogs ----------
export function modal(inner, { width = 560, onMount } = {}) {
  return new Promise((resolve) => {
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = `<div class="modal sk" style="width:${width}px">${inner}</div>`;
    document.body.appendChild(scrim);
    const m = scrim.firstChild;
    const close = (v) => { scrim.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', key);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(null); });
    onMount?.(m, close);
  });
}

export function confirm(titleText, message, okLabel = '确定', danger = true) {
  return modal(`
    <div class="kicker">请确认</div>
    <div class="h" style="font-size:22px">${esc(titleText)}</div>
    <div style="font-size:16px">${esc(message)}</div>
    <div class="row" style="justify-content:flex-end;margin-top:6px">
      ${btn('取消', { act: 'no' })}${btn(okLabel, { act: 'yes', cls: danger ? 'danger' : 'solid' })}
    </div>`, { width: 480, onMount: (m, close) => delegate(m, { yes: () => close(true), no: () => close(false) }) });
}

export function prompt(titleText, message, value = '', okLabel = '确定') {
  return modal(`
    <div class="h" style="font-size:22px">${esc(titleText)}</div>
    <div class="muted">${esc(message)}</div>
    <input class="field sk" id="pv" value="${esc(value)}">
    <div class="row" style="justify-content:flex-end">${btn('取消', { act: 'no' })}${btn(okLabel, { act: 'yes', cls: 'solid' })}</div>`,
  { width: 460, onMount: (m, close) => {
    const i = m.querySelector('#pv'); i.focus(); i.select();
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(i.value); });
    delegate(m, { yes: () => close(i.value), no: () => close(null) });
  } });
}

export function textSheet(kicker, titleText, body) {
  return modal(`${titleBlock(kicker, titleText)}
    <div class="card sk" style="max-height:60vh;overflow:auto"><pre data-notr class="mono sel" style="margin:0;font-size:12px;white-space:pre-wrap">${esc(body)}</pre></div>
    <div class="row" style="justify-content:flex-end">${btn('合上', { act: 'no', cls: 'solid' })}</div>`,
  { width: 900, onMount: (m, close) => delegate(m, { no: () => close() }) });
}

export function popover(anchor, inner, { width = 340, onMount } = {}) {
  document.querySelectorAll('.popover').forEach((p) => p.remove());
  const r = anchor.getBoundingClientRect();
  const p = document.createElement('div');
  p.className = 'popover sk';
  p.style.width = width + 'px';
  p.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width)) + 'px';
  p.style.top = r.bottom + 6 + 'px';
  p.innerHTML = inner;
  document.body.appendChild(p);
  const off = (e) => { if (!p.contains(e.target) && e.target !== anchor) { p.remove(); document.removeEventListener('mousedown', off); } };
  setTimeout(() => document.addEventListener('mousedown', off));
  const close = () => { p.remove(); document.removeEventListener('mousedown', off); };
  onMount?.(p, close);
  return close;
}
