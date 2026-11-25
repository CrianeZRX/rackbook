export function bytes(v) {
  if (!isFinite(v) || v <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  if (i === 0) return `${Math.round(v)} B`;
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u[i]}`;
}
export const rate = (v) => bytes(v) + '/s';
export const pct = (v) => `${Math.round(isFinite(v) ? v : 0)}%`;
export const num = (v, d = 2) => (isFinite(v) ? v : 0).toFixed(d);
export function uptime(s) {
  const t = Math.floor(s), d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}
export const clock = (d = new Date()) => d.toTimeString().slice(0, 8);
export function date(sec) {
  const d = new Date(sec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
