import { invoke } from '../api.js';
import { active, liveOf, server } from '../state.js';
import { btn, delegate } from '../ui.js';

const apps = [[1, 'Git'], [2, 'pip'], [4, 'Conda']];
const all = apps.reduce((mask, [bit]) => mask | bit, 0);

export function mountUserProxy(el, id) {
  el.innerHTML = `<section class="card sk crew-proxy">
    <div class="head"><span class="kicker">User proxy</span><span class="h">当前用户 VPN</span></div>
    <label class="col muted small">本机 HTTP / Mixed 代理端口
      <input class="field sk mono" type="number" min="1" max="65535" step="1" placeholder="7890" data-proxy-port>
    </label>
    <div class="crew-proxy-tools" role="group" aria-label="选择使用本机 VPN 的应用">
      <label><input type="checkbox" data-proxy-bit="${all}"> 全部</label>
      ${apps.map(([bit, label]) => `<label><input type="checkbox" data-proxy-bit="${bit}"> ${label}</label>`).join('')}
    </div>
    <div class="row">${btn('接通代理', { act: 'connect-proxy', cls: 'chip' })}</div>
    <div class="muted small" data-proxy-status role="status"></div>
    <details class="muted small"><summary>生效范围</summary>
      <p>当前 SSH 用户在任意终端重新运行应用即生效。Git 适用于 HTTP(S) 远程仓库。</p>
      <p>应用通过 Rackbook 的 SSH 隧道连接本机代理。关闭开关会恢复该工具此前的用户配置。</p>
    </details>
  </section>`;

  const input = el.querySelector('[data-proxy-port]');
  const message = el.querySelector('[data-proxy-status]');
  const reconnect = el.querySelector('[data-act="connect-proxy"]');
  const switches = [...el.querySelectorAll('[data-proxy-bit]')];
  let account = null, context = null, status = null, pending = false, error = '';
  let token = 0, destroyed = false;

  const port = () => input.value !== '' && input.validity.valid ? Number(input.value) : 0;

  const render = () => {
    input.disabled = !account || pending;
    const mask = status?.tools || 0;
    for (const toggle of switches) {
      const bit = Number(toggle.dataset.proxyBit);
      toggle.checked = (mask & bit) === bit;
      toggle.indeterminate = bit === all && mask !== 0 && mask !== all;
      toggle.disabled = !status || pending;
    }
    const retry = !status && !!error;
    reconnect.disabled = !account || pending || (!retry && (!mask || !port() || (status.connected && port() === status.localPort)));
    reconnect.textContent = retry ? '重新读取' : status?.connected ? '应用端口' : '接通代理';
    const detail = pending ? '正在更新代理设置…' : error || (!account ? '接通服务器后可管理。' : !status ? '正在读取设置…'
      : !mask ? '代理已关闭。' : status.connected ? 'SSH 代理隧道已接通。'
        : '应用选项已保存。请接通代理后使用。');
    if (message.textContent !== detail) message.textContent = detail;
  };

  const load = async (background = false) => {
    const request = token;
    try {
      const result = await invoke('get_user_proxy', { id, account });
      if (destroyed || request !== token) return;
      status = result;
      if (!background) input.value = result.localPort || '';
    } catch (e) {
      if (destroyed || request !== token) return;
      if (background) {
        if (status) status = { ...status, connected: false };
      } else {
        error = e.message || String(e);
      }
    }
    if (!destroyed && request === token) render();
  };

  const apply = async (tools) => {
    if (!account || !status || pending) return;
    const localPort = port() || (tools === 0 ? status.localPort : 0);
    if (tools && !localPort) {
      error = '请填写本机 VPN 的 HTTP / Mixed 代理端口。';
      input.focus();
      render();
      return;
    }
    const request = ++token;
    pending = true; error = ''; render();
    try {
      const result = await invoke('set_user_proxy', { id, account, localPort, tools });
      if (destroyed || request !== token) return;
      status = result;
      input.value = result.localPort || '';
    } catch (e) {
      if (destroyed || request !== token) return;
      error = e.message || String(e);
    } finally {
      if (!destroyed && request === token) { pending = false; render(); }
    }
  };

  const update = () => {
    const config = server(id), login = active(config);
    const next = liveOf(id).phase === 'online' && login ? JSON.stringify([config.host, config.port, login.id, login.user]) : null;
    if (next !== context) {
      context = next; ++token;
      account = next ? login.id : null;
      status = null; pending = false; error = ''; input.value = '';
      if (account) load();
    }
    render();
  };

  el.addEventListener('change', (event) => {
    const bit = Number(event.target.dataset.proxyBit);
    if (bit && status) {
      const tools = event.target.checked ? status.tools | bit : status.tools & ~bit;
      apply(tools);
    }
  });
  input.addEventListener('input', () => { error = ''; render(); });
  delegate(el, { 'connect-proxy': () => {
    if (status) apply(status.tools);
    else { error = ''; render(); load(); }
  } });
  const timer = setInterval(() => {
    if (account && !pending && status?.tools) load(true);
  }, 15_000);
  update();
  return { update, destroy() { destroyed = true; clearInterval(timer); } };
}
