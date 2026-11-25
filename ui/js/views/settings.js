import { invoke, isTauri } from '../api.js';
import { S, say, title, display, SHIP_CLASS_TIERS, shipClassThreshold } from '../state.js';
import { card, btn, check, delegate, titleBlock } from '../ui.js';
import { sketchAll, TEXT_SCALES } from '../kit.js';
import { esc } from '../fmt.js';
import { LANGS, getLang, tr } from '../i18n.js';
import { setLanguage } from '../app.js';

const METRICS = [['cpu', 'CPU'], ['mem', '内存'], ['net', '网络'], ['disk', '磁盘'], ['gpu', '显卡'], ['load', '负载']];

export function mount(el) {
  const set = (patch) => {
    S.prefs = { ...S.prefs, ...patch };
    const saved = invoke('set_prefs', { prefs: S.prefs });
    render();
    return saved;
  };
  let rendered, classDraft = null, savingClasses = false, alive = true;
  const saveClasses = async (thresholds, message) => {
    if (savingClasses) return;
    const previous = S.prefs.shipClassThresholds, draft = classDraft;
    savingClasses = true;
    classDraft = null;
    try {
      await set({ shipClassThresholds: thresholds });
      say(message, 'ok');
    } catch (error) {
      S.prefs = { ...S.prefs, shipClassThresholds: previous };
      classDraft = draft;
      say('没保存成功：' + error, 'refuse');
    } finally {
      savingClasses = false;
      if (alive) render();
    }
  };

  const render = () => {
    const p = S.prefs, all = !p.floatServers?.length;
    const fontScale = TEXT_SCALES.includes(p.fontScale) ? p.fontScale : 100;
    const markup = `<div class="page settings-page">
      ${titleBlock('Settings', '设置', '改动立即生效')}
      ${card(`<form id="fleet-name-form" class="row settings-name">
        <label for="fleet-name"><b>舰队名称</b></label>
        <input class="field sk" id="fleet-name" maxlength="48" value="${esc(p.fleetName || '')}" placeholder="第一舰队">
        <button class="btn sk chip" type="submit">保存名称</button>
        </form>
        <label class="row settings-font">
        <b>字体大小</b>
        <select class="field sk mono" id="font-scale">${TEXT_SCALES.map((size) =>
          `<option value="${size}"${size === fontScale ? ' selected' : ''}>${size}%</option>`).join('')}</select>
        </label>
        <div class="row">${LANGS.map(([k, n]) => `<button class="btn sk chip${getLang() === k ? ' active' : ''}" data-act="lang" data-l="${k}" data-notr>${n}</button>`).join('')}</div>
        <div class="foot" data-notr>Language · 言語 · Idioma · 语言 · 語言 · 언어</div>`, { title: '界面显示' })}
      ${card(`<form id="ship-class-form" class="col">
        <div class="foot">按舰级从高到低匹配，核数或内存任一项达标即可。其余归为侦察艇。</div>
        <div class="ship-class-fields">${SHIP_CLASS_TIERS.map((tier) => {
          const min = shipClassThreshold(tier);
          const coresId = `${tier.key}-cores`, memoryId = `${tier.key}-memory`;
          return `<fieldset class="ship-class-tier"${savingClasses ? ' disabled' : ''}>
            <legend>${tier.name}</legend>
            <label for="${coresId}"><span>CPU 核数</span><input class="field sk mono" id="${coresId}" name="${coresId}" type="number" min="1" max="4294967295" step="1" required value="${esc(classDraft?.[coresId] ?? min.cores)}"></label>
            <label for="${memoryId}"><span>内存（GiB）</span><input class="field sk mono" id="${memoryId}" name="${memoryId}" type="number" min="0" step="any" required value="${esc(classDraft?.[memoryId] ?? min.memoryGib)}"></label>
          </fieldset>`;
        }).join('')}</div>
        <div class="row">
          <button type="submit" class="btn sk solid chip"${savingClasses ? ' disabled' : ''}>保存舰级标准</button>
          ${btn('恢复默认', { act: 'resetClasses', cls: 'chip', disabled: savingClasses })}
        </div>
        </form>`, { title: '舰级判定' })}
      ${card(`${check('关闭主窗口时转入后台，继续监控（任务栏右下角出现舰船图标）', p.backgroundOnClose, 'bg')}
        <div class="foot">不勾选时，关闭主窗口就是退出。随时可以用 Ctrl+Shift+B 或侧栏的「转入后台」手动转入后台；点托盘图标回到主窗口，右键托盘图标有更多选项。</div>
        <div>${btn('立即转入后台', { act: 'goBg' })}</div>`, { kicker: 'Background', title: '后台运行' })}
      ${card(`${check('转入后台时弹出悬浮窗（回到主窗口时自动收起）', p.floatEnabled, 'float')}
        <div class="kicker" style="margin-top:4px">样式</div>
        <div class="row">${btn('列表', { act: 'mode', cls: 'chip' + (p.floatMode === 'list' ? ' active' : ''), data: 'data-m="list"' })}${btn('小舰船', { act: 'mode', cls: 'chip' + (p.floatMode === 'ships' ? ' active' : ''), data: 'data-m="ships"' })}</div>
        <div class="kicker" style="margin-top:4px">显示哪些指标</div>
        <div class="row">${METRICS.map(([k, l]) => btn(l, { act: 'metric', cls: 'chip' + (p.floatMetrics?.includes(k) ? ' active' : ''), data: `data-k="${k}"` })).join('')}</div>
        <div class="kicker" style="margin-top:4px">显示哪些舰船</div>
        ${check('全部舰船', all, 'allShips')}
        ${S.servers.map((s) => `<div style="margin-left:22px">${check(`${title(s)}  ·  ${display(s)}`, all || p.floatServers.includes(s.id), 'ship', `data-id="${s.id}"`)}</div>`).join('')}
        ${check('只显示需要留意或失联的舰船（一切正常时只剩标题）', p.floatAlertsOnly, 'alerts')}
        <div class="kicker" style="margin-top:4px">纸张不透明度 ${Math.round((p.floatOpacity ?? 0.96) * 100)}%</div>
        <input type="range" min="50" max="100" value="${Math.round((p.floatOpacity ?? 0.96) * 100)}" id="op" style="width:260px;accent-color:#c8372f">
        <div class="row">${btn('把悬浮窗放回右上角', { act: 'reset', cls: 'chip' })}<span class="foot">悬浮窗按住任意位置可以拖动，位置会被记住；双击某艘舰船即可登舰。</span></div>`, { kicker: 'Floating window', title: '悬浮窗' })}
      ${card(`<div>Rackbook ${isTauri ? 'for Windows' : '（浏览器预览）'} · 星际舰队 v2.0</div>
        <div class="foot">配置在 %APPDATA%\\local.rackbook.app\\servers.json；所有密码、私钥口令和 sudo 密码只存在 Windows 凭据管理器（名称以 Rackbook 开头）。主机指纹首次连接时记录，变化时会拒绝连接。</div>
        <div>${btn('退出 Rackbook', { act: 'quit', cls: 'danger' })}</div>`, { kicker: 'About', title: '关于' })}
    </div>`;
    if (markup === rendered) return;
    const focused = el.contains(document.activeElement) && document.activeElement.id;
    el.innerHTML = rendered = markup;
    el.querySelector('#op').addEventListener('change', (e) => set({ floatOpacity: +e.target.value / 100 }));
    el.querySelector('#font-scale').addEventListener('change', (e) => set({ fontScale: Number(e.target.value) }));
    el.querySelector('#fleet-name-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fleetName = el.querySelector('#fleet-name').value.trim();
      set({ fleetName });
    });
    const shipClassForm = el.querySelector('#ship-class-form');
    shipClassForm.addEventListener('input', ({ target }) => {
      classDraft ??= {};
      classDraft[target.name] = target.value;
      target.setCustomValidity('');
    });
    shipClassForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const thresholds = {};
      for (const { key } of SHIP_CLASS_TIERS) {
        const cores = shipClassForm.elements.namedItem(`${key}-cores`).valueAsNumber;
        const memory = shipClassForm.elements.namedItem(`${key}-memory`);
        if (!(memory.valueAsNumber > 0)) {
          memory.setCustomValidity(tr('内存门槛必须大于 0。'));
          memory.reportValidity();
          return;
        }
        thresholds[key] = { cores, memoryGib: memory.valueAsNumber };
      }
      saveClasses(thresholds, '已保存舰级判定标准。');
    });
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
    sketchAll(el);
  };
  delegate(el, {
    lang: (b) => { if (b.dataset.l !== getLang()) setLanguage(b.dataset.l); },
    resetClasses: () => saveClasses(null, '已恢复默认舰级标准。'),
    bg: () => set({ backgroundOnClose: !S.prefs.backgroundOnClose }),
    float: () => set({ floatEnabled: !S.prefs.floatEnabled }),
    mode: (b) => set({ floatMode: b.dataset.m }),
    metric: (b) => {
      const k = b.dataset.k, cur = S.prefs.floatMetrics || [];
      set({ floatMetrics: METRICS.map((m) => m[0]).filter((x) => (x === k ? !cur.includes(k) : cur.includes(x))) });
    },
    allShips: () => set({ floatServers: S.prefs.floatServers?.length ? [] : S.servers.slice(0, 1).map((s) => s.id) }),
    ship: (b) => {
      let ids = S.prefs.floatServers?.length ? [...S.prefs.floatServers] : S.servers.map((s) => s.id);
      ids = ids.includes(b.dataset.id) ? ids.filter((x) => x !== b.dataset.id) : [...ids, b.dataset.id];
      set({ floatServers: ids.length === S.servers.length ? [] : ids });
    },
    alerts: () => set({ floatAlertsOnly: !S.prefs.floatAlertsOnly }),
    reset: () => { invoke('reset_float'); say('悬浮窗位置已重置到右上角。', 'ok'); },
    goBg: () => (isTauri ? invoke('go_background') : say('浏览器预览里没有后台模式。', 'refuse')),
    quit: () => invoke('quit_app'),
  });
  render();
  return { update: (what) => { if (what === 'prefs' || what === 'servers') render(); }, destroy() { alive = false; } };
}
