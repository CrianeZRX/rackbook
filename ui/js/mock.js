// A pretend fleet for previewing the UI in a browser (no Tauri). Never used in the real app.

const listeners = {};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2) + Date.now());
const acct = (user, privilege, auth = 'key', label = '') => ({ id: uid(), label, user, auth, keyPath: '', hasKeyPass: false, hasLoginPassword: auth === 'password', hasSudoPassword: false, privilege });

function mkServer(name, host, wash, accounts, opts = {}) {
  return { id: uid(), name, host, port: 22, accounts, activeAccount: accounts[0].id, wash, interval: 3, paused: !!opts.paused };
}

const servers = [
  mkServer('web-01', '10.0.0.11', 'sky', [acct('root', 'root', 'key', 'ops-captain'), acct('deploy', 'none', 'password', 'deploy-navigator')]),
  mkServer('gpu-lab', 'gpu.lab.local', 'pink', [acct('ubuntu', 'nopasswd')]),
  mkServer('db-02', '10.0.0.32', 'sage', [acct('dba', 'password', 'password')]),
  mkServer('edge-03', 'edge3.example.com', 'gold', [acct('admin', 'unknown')]),
  mkServer('backup', '10.0.0.90', 'tan', [acct('root', 'root')], { paused: true }),
];
const spec = {
  'web-01': { cores: 8, mem: 16, cpu: 28, disk: 0.61, gpus: 0, docker: true },
  'gpu-lab': { cores: 64, mem: 512, cpu: 74, disk: 0.48, gpus: 8, docker: true },
  'db-02': { cores: 4, mem: 32, cpu: 45, disk: 0.93, gpus: 0, docker: false },
  'edge-03': { cores: 2, mem: 2, cpu: 10, disk: 0.3, gpus: 0, docker: false },
  'backup': { cores: 4, mem: 8, cpu: 3, disk: 0.7, gpus: 0, docker: false },
};
let prefs = { backgroundOnClose: true, floatEnabled: true, floatMode: 'list', floatMetrics: ['cpu', 'mem', 'net'], floatServers: [], floatAlertsOnly: false, floatOpacity: 0.96 };
try {
  prefs.fontScale = Number(localStorage.getItem('rackbook.fontScale')) || 100;
  prefs.fleetName = localStorage.getItem('rackbook.fleetName') || '';
  prefs.shipClassThresholds = JSON.parse(localStorage.getItem('rackbook.shipClassThresholds'));
} catch {}
const live = {};
let t = 0;

function snap(s, k) {
  const sp = spec[s.name];
  const wav = (a, f) => a * Math.sin(t / f + s.name.length);
  const cpu = Math.max(1, Math.min(99, sp.cpu + wav(12, 3) + Math.random() * 6));
  const memT = sp.mem * 2 ** 30;
  const memU = memT * Math.min(0.95, 0.35 + sp.cpu / 160 + wav(0.04, 5));
  return {
    time: Date.now() / 1000, hostname: s.name, kernel: '6.8.0-49-generic', os: 'Ubuntu 24.04.1 LTS', cores: sp.cores,
    uptime: 86400 * 23 + 3600 * 5 + k * 3, load: [cpu / 100 * sp.cores * 0.9, cpu / 100 * sp.cores * 0.8, cpu / 100 * sp.cores * 0.7], procsRunning: '2/412',
    cpu, iowait: 1.2, perCore: Array.from({ length: sp.cores }, (_, i) => Math.max(0, Math.min(100, cpu + 25 * Math.sin(i * 1.7 + t / 2)))),
    memTotal: memT, memUsed: memU, memAvail: memT - memU, memCache: memT * 0.18, swapTotal: 2 * 2 ** 30, swapUsed: 2 ** 27,
    nets: [{ name: 'eth0', rx: 9.3e11, tx: 2.1e11, rxRate: 2.4e6 + wav(1.5e6, 2), txRate: 6e5 + wav(4e5, 3) }, { name: 'docker0', rx: 1e9, tx: 8e8, rxRate: 3e4, txRate: 2e4 }],
    rxRate: Math.max(0, 2.4e6 + wav(1.5e6, 2)), txRate: Math.max(0, 6e5 + wav(4e5, 3)),
    mounts: [
      { fs: '/dev/nvme0n1p2', type: 'ext4', mount: '/', size: 512e9, used: 512e9 * sp.disk, avail: 512e9 * (1 - sp.disk) },
      { fs: '/dev/sda1', type: 'xfs', mount: '/data', size: 4e12, used: 1.1e12, avail: 2.9e12 },
      { fs: '/dev/nvme0n1p1', type: 'vfat', mount: '/boot/efi', size: 5e8, used: 6e6, avail: 4.9e8 },
    ],
    ioRead: Math.max(0, 1.2e6 + wav(9e5, 2)), ioWrite: Math.max(0, 4e6 + wav(3e6, 4)),
    procs: [['nginx', 'www-data', 12.3, 1.2], ['postgres', 'postgres', 8.1, 6.3], ['python3', 'root', 5.5, 3.1], ['node', 'deploy', 4.2, 2.2], ['dockerd', 'root', 1.9, 1.4], ['sshd', 'root', 0.3, 0.1], ['systemd', 'root', 0.1, 0.2]]
      .map(([c, u, p, m], i) => ({ pid: 1000 + i * 37, user: u, cpu: p, mem: m, rss: m * 1.6e8, command: c })),
    tcp: 132, gpus: Array.from({ length: sp.gpus }, (_, i) => ({ index: i, name: 'NVIDIA A100-PCIE-40GB', util: Math.max(0, Math.min(100, 70 + wav(25, 2 + i))), memUsed: 2.6e10 + i * 1.2e9, memTotal: 4.0e10, temp: 58 + i * 4 + wav(3, 5 + i), power: 180 + i * 9 + wav(20, 3 + i), powerLimit: 250, fan: 35 + i * 6, clockSm: 1410 - i * 15, memUtil: Math.max(0, Math.min(100, 45 + wav(30, 4 + i))) })),
    users: mockUsers(sp, cpu, memU),
    hasDocker: sp.docker,
  };
}

// who's using the machine: a few busy users, a few idle ones; cores and memory add up to the machine's totals roughly
function mockUsers(sp, cpu, memU) {
  const busy = cpu / 100 * sp.cores;
  const shares = [['nova', 0.48], ['root', 0.14], ['www-data', 0.12], ['postgres', 0.1], ['deploy', 0.08], ['orion', 0.05], ['ml', 0.03]];
  return shares.map(([u, f], i) => {
    const cores = Math.max(0, busy * f * (1 + 0.35 * Math.sin(t / (3 + i) + i)));
    return { user: u, cores, cpu: (cores / sp.cores) * 100, rss: memU * f * (0.8 + 0.2 * Math.cos(t / 7 + i)), procs: [42, 121, 18, 9, 6, 3, 2][i] };
  }).sort((a, b) => b.cpu - a.cpu);
}

function tick() {
  t += 1;
  servers.forEach((s, k) => {
    const l = live[s.id] || (live[s.id] = { phase: 'connecting', error: '', snap: null, hist: { cpu: [], mem: [], rx: [], tx: [], ioR: [], ioW: [], load: [], gpu: [] }, lastUpdate: 0 });
    if (s.paused) { l.phase = 'parked'; }
    else if (s.name === 'edge-03') { l.phase = 'offline'; l.error = '连接超时'; }
    else {
      const sn = snap(s, k);
      l.snap = sn; l.phase = 'online'; l.lastUpdate = Date.now() / 1000;
      const h = l.hist; const push = (a, v) => { a.push(v); if (a.length > 150) a.shift(); };
      push(h.cpu, sn.cpu); push(h.mem, sn.memUsed / sn.memTotal * 100); push(h.rx, sn.rxRate); push(h.tx, sn.txRate);
      push(h.ioR, sn.ioRead); push(h.ioW, sn.ioWrite); push(h.load, sn.load[0]); push(h.gpu, sn.gpus.length ? sn.gpus.reduce((a, g) => a + g.util, 0) / sn.gpus.length : 0);
    }
    emit('live', { id: s.id, live: l });
  });
}
for (let i = 0; i < 60; i++) tick();
setInterval(tick, 1000);

function emit(ev, payload) { (listeners[ev] || []).forEach((cb) => cb(payload)); }
export async function listen(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return () => {}; }
const say = (text, tone = 'info') => emit('status', { text, tone });
const sv = (id) => servers.find((s) => s.id === id);
const userProxies = new Map();

const files = {
  '~/.bashrc': `# ~/.bashrc: executed by bash(1) for non-login shells.\ncase $- in\n    *i*) ;;\n      *) return;;\nesac\n\nexport EDITOR=vim\nexport PATH="$HOME/.local/bin:/usr/local/go/bin:$PATH"\nHISTSIZE=5000\n\nalias ll='ls -alF'\nalias gs='git status'\nalias dps="docker ps --format 'table {{.Names}}\\t{{.Status}}'"\n\nmkcd() {\n    mkdir -p "$1" && cd "$1"\n}\n\n[ -f ~/.bash_aliases ] && . ~/.bash_aliases\nsource /etc/bash_completion\n`,
  '/etc/docker/daemon.json': `{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "50m", "max-file": "3" },\n  "registry-mirrors": ["https://mirror.example.com"],\n  "default-address-pools": [\n    { "base": "172.30.0.0/16", "size": 24 }\n  ],\n  "live-restore": true\n}\n`,
  '/srv/app/docker-compose.yml': `services:\n  web:\n    image: nginx:1.27\n    ports:\n      - "80:80"\n    volumes:\n      - ./site:/usr/share/nginx/html:ro\n  api:\n    build: ./api\n    environment:\n      DATABASE_URL: postgres://app@db/app\n      DEBUG: false\n    depends_on: [db]\n  db:\n    image: postgres:16\n`,
};

const navigatorOn = (id) => { const s = servers.find((x) => x.id === id); const ac = s && s.accounts.find((x) => x.id === s.activeAccount); return ac?.privilege === 'none'; };
const activeUser = (id) => { const s = servers.find((x) => x.id === id); return s?.accounts.find((x) => x.id === s.activeAccount)?.user || ''; };
// ---- a pretend shell for the embedded terminal in the browser preview ----
const terms = {};
const enc = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const tout = (tid, str) => setTimeout(() => emit('term', { tid, data: enc(str) }), 0);
const prompt = (tid) => { const t = terms[tid]; return `\x1b[32m${t.user}@${t.host}\x1b[0m:\x1b[34m~\x1b[0m$ `; };
function termRun(tid, line) {
  const t = terms[tid], c = line.trim();
  const out = {
    '': '',
    help: '预览里的小 shell：ls、whoami、uptime、nvidia-smi、colors、clear、exit。真实版本连到服务器上的 bash。',
    whoami: t.user,
    uptime: ' 09:20:11 up 23 days,  5:02,  2 users,  load average: 2.31, 2.04, 1.98',
    pwd: t.image ? '/' : '/home/' + t.user,
    ls: t.image ? 'bin  dev  etc  home  proc  root  tmp  usr  var' : '\x1b[1;34mdata\x1b[0m  \x1b[1;34mlogs\x1b[0m  \x1b[1;34mprojects\x1b[0m  docker-compose.yml  notes.txt  \x1b[1;32mtrain.sh\x1b[0m',
    'nvidia-smi': '+---------------------------------------------------------------+\r\n| GPU  Name              Temp  Pwr:Usage/Cap |   Memory-Usage     |\r\n|  0   A100-PCIE-40GB     60C   185W / 250W  | 24200MiB / 40960MiB|\r\n|  1   A100-PCIE-40GB     62C   189W / 250W  | 25300MiB / 40960MiB|\r\n+---------------------------------------------------------------+',
    colors: [30, 31, 32, 33, 34, 35, 36, 37].map((n) => `\x1b[${n}m■ ${n}\x1b[0m \x1b[${n + 60}m■ ${n + 60}\x1b[0m`).join('  '),
  }[c];
  if (c === 'clear') return tout(tid, '\x1b[2J\x1b[H' + prompt(tid));
  if (c === 'exit') { tout(tid, 'logout\r\n'); setTimeout(() => emit('term', { tid, closed: true }), 30); delete terms[tid]; return; }
  tout(tid, (out === undefined ? `bash: ${c.split(' ')[0]}: command not found` : out) + (out === '' ? '' : '\r\n') + prompt(tid));
}
export async function invoke(cmd, a) {
  if (cmd === 'term_open') {
    if (a.image && navigatorOn(a.id)) throw new Error('没有权限：这个账户不能使用 Docker。');
    const tid = 'mock-' + Math.random().toString(36).slice(2);
    const s = servers.find((x) => x.id === a.id), ac = s?.accounts.find((x) => x.id === s.activeAccount);
    terms[tid] = { user: a.image ? 'root' : ac?.user || 'root', host: a.image ? 'image-preview' : s?.name || 'host', line: '', image: a.image };
    if (a.image) {
      tout(tid, `\x1b[90mDocker 镜像终端（浏览器预览）\x1b[0m\r\n` + prompt(tid));
      return tid;
    }
    tout(tid, `\x1b[90mWelcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-49-generic x86_64)\x1b[0m\r\n\r\n这是浏览器预览里的模拟终端，输入 help 看看能做什么。\r\n\r\n` + prompt(tid));
    return tid;
  }
  if (cmd === 'term_write') {
    const t = terms[a.tid]; if (!t) throw new Error('终端已关闭');
    for (const ch of a.data) {
      if (ch === '\r') { tout(a.tid, '\r\n'); const l = t.line; t.line = ''; termRun(a.tid, l); }
      else if (ch === '\x7f') { if (t.line) { t.line = t.line.slice(0, -1); tout(a.tid, '\b \b'); } }
      else if (ch >= ' ') { t.line += ch; tout(a.tid, ch); }
    }
    return;
  }
  if (cmd === 'term_resize') return;
  if (cmd === 'term_close') { delete terms[a.tid]; return; }
  switch (cmd) {
    case 'scan_configs': return a?.path ? [] : [
      { name: 'web-01', host: '10.0.0.11', port: 22, user: 'root', keyPath: '~/.ssh/id_ed25519', source: '~/.ssh/config', note: '' },
      { name: 'staging', host: 'staging.example.com', port: 2222, user: 'deploy', keyPath: '~/.ssh/deploy_key', source: '~/.ssh/config', note: '' },
      { name: 'build-box', host: '10.0.3.7', port: 22, user: 'ci', keyPath: '', source: '~/.ssh/config.d/lab', note: '' },
      { name: 'gpu.internal', host: 'gpu.internal', port: 22, user: 'ml', keyPath: '', source: '~/.ssh/config', note: '使用了 ProxyJump / ProxyCommand，Rackbook 暂不支持' },
      { name: 'nas', host: '192.168.1.20', port: 22, user: 'admin', keyPath: '', source: 'PuTTY', note: '' },
    ];
    case 'get_state': return { servers, live, prefs, backgrounded: false };
    case 'set_prefs':
      prefs = a.prefs;
      try {
        if (prefs.fontScale) localStorage.setItem('rackbook.fontScale', prefs.fontScale);
        localStorage.setItem('rackbook.fleetName', prefs.fleetName || '');
        localStorage.setItem('rackbook.shipClassThresholds', JSON.stringify(prefs.shipClassThresholds ?? null));
      } catch {}
      emit('prefs', prefs); return;
    case 'save_server': {
      const i = servers.findIndex((s) => s.id === a.cfg.id);
      if (i >= 0) servers[i] = a.cfg; else { servers.push(a.cfg); spec[a.cfg.name] = { cores: 4, mem: 8, cpu: 20, disk: 0.4, gpus: 0, docker: false }; }
      emit('servers', servers); say(`已保存「${a.cfg.name}」（预览模式）。`, 'ok'); return;
    }
    case 'delete_server': servers.splice(servers.findIndex((s) => s.id === a.id), 1); emit('servers', servers); say('已退出舰队（预览）。'); return;
    case 'move_server': return;
    case 'disconnect': sv(a.id).paused = true; emit('servers', servers); tick(); say('已主动断开（预览）。', 'ok'); return;
    case 'connect': sv(a.id).paused = false; emit('servers', servers); tick(); say('正在重新呼叫（预览）…'); return;
    case 'connect_all': servers.forEach((s) => (s.paused = false)); emit('servers', servers); return;
    case 'disconnect_all': servers.forEach((s) => (s.paused = true)); emit('servers', servers); tick(); return;
    case 'refresh': tick(); return;
    case 'switch_account': sv(a.id).activeAccount = a.account; emit('servers', servers); say('已切换登舰账户（预览）。'); return;
    case 'reprobe': case 'set_sudo_password': case 'forget_host_key': case 'open_terminal': case 'go_background': case 'show_main': case 'float_resize': case 'reset_float': case 'quit_app': return;
    case 'test_connection': return 'Linux 6.8.0 · web-01 · root · 舰长 (root)（预览）';
    case 'docker_via_sudo': return navigatorOn(a.id);
    case 'write_file': return { out: '', err: '', code: 0 };
    case 'download': case 'upload': return '预览模式：没有真的传输';
    // a navigator outside the docker group: refused, like the real backend
    case 'docker': return navigatorOn(a.id) ? { code: 1, out: '', err: `领航员 ${activeUser(a.id)} 没有 sudo 权限，这个操作需要舰长` } : mockDocker(a.args);
    case 'change_crew_account': return mockChangeCrew(a);
    case 'get_user_proxy': return userProxies.get(a.account) || { tools: 0, localPort: 0, connected: false };
    case 'set_user_proxy': {
      if (sv(a.id).activeAccount !== a.account) throw new Error('当前登舰账户已切换');
      const status = { tools: a.tools, localPort: a.localPort, connected: !!a.tools };
      userProxies.set(a.account, status);
      return status;
    }
    case 'sudo': case 'run': return mockRun(a.cmd, a.id);
  }
  return null;
}

function mockDocker(args) {
  if (args.startsWith('ps')) return { code: 0, err: '', out: [
    { ID: 'a1b2c3', Names: 'nginx-edge', Image: 'nginx:1.27', State: 'running', Status: 'Up 3 days', Ports: '0.0.0.0:80->80/tcp' },
    { ID: 'b2c3d4', Names: 'api', Image: 'registry.local/app/api:2.4.1', State: 'running', Status: 'Up 3 days (healthy)', Ports: '8080/tcp' },
    { ID: 'c3d4e5', Names: 'postgres', Image: 'postgres:16', State: 'running', Status: 'Up 12 days', Ports: '5432/tcp' },
    { ID: 'd4e5f6', Names: 'nightly-report', Image: 'python:3.12-slim', State: 'exited', Status: 'Exited (0) 7 hours ago', Ports: '' },
  ].map((x) => JSON.stringify(x)).join('\n') };
  if (args.startsWith('stats')) return { code: 0, err: '', out: [
    { Name: 'nginx-edge', CPUPerc: '0.42%', MemUsage: '12.1MiB / 15.5GiB', MemPerc: '0.08%', NetIO: '1.2GB / 3.4GB' },
    { Name: 'api', CPUPerc: '6.10%', MemUsage: '412MiB / 15.5GiB', MemPerc: '2.6%', NetIO: '820MB / 610MB' },
    { Name: 'postgres', CPUPerc: '3.30%', MemUsage: '1.9GiB / 15.5GiB', MemPerc: '12.2%', NetIO: '410MB / 1.1GB' },
  ].map((x) => JSON.stringify(x)).join('\n') };
  if (args.startsWith('images')) return { code: 0, err: '', out: [
    { Repository: 'nginx', Tag: '1.27', ID: '3b25b682ea82', Size: '192MB', CreatedSince: '3 weeks ago' },
    { Repository: 'postgres', Tag: '16', ID: 'f0e9b8a7c6d5', Size: '438MB', CreatedSince: '5 weeks ago' },
    { Repository: 'registry.local/app/api', Tag: '2.4.1', ID: '9a8b7c6d5e4f', Size: '211MB', CreatedSince: '4 days ago' },
  ].map((x) => JSON.stringify(x)).join('\n') };
  if (args.startsWith('version')) return { code: 0, err: '', out: '27.3.1' };
  if (args.startsWith('logs')) return { code: 0, err: '', out: '2026-11-25T08:00:01Z GET / 200\n2026-11-25T08:00:02Z GET /api/health 200\n' };
  return { code: 0, err: '', out: '' };
}

const crewByServer = new Map();
function demoCrew(id) {
  if (!crewByServer.has(id)) {
    const names = ['root', 'ubuntu', 'deploy', 'nova', 'orion', 'dba', 'ml', 'release', 'ci', 'backup', 'observer', activeUser(id)].filter(Boolean);
    crewByServer.set(id, new Map([...new Set(names)].map((name, i) => [name, i === 0 ? 0 : 1000 + i])));
  }
  return crewByServer.get(id);
}

function mockChangeCrew({ id, account, user, removeUid }) {
  const cfg = sv(id);
  const denied = (err) => ({ code: 1, out: '', err });
  if (cfg.activeAccount !== account || !['root', 'nopasswd', 'password'].includes(cfg.accounts.find((a) => a.id === account)?.privilege)) return denied('需要有可用 sudo 权限的舰长账户');
  const crew = demoCrew(id);
  if (removeUid == null) {
    if (crew.has(user)) return denied('这个用户已存在');
    crew.set(user, Math.max(1000, ...crew.values()) + 1);
  } else {
    if (removeUid < 1000 || crew.get(user) !== removeUid || cfg.accounts.some((a) => a.user === user)) return denied('不能删除这个用户');
    crew.delete(user);
  }
  return { code: 0, err: '', out: '' };
}

function mockCrew(id) {
  const now = Math.floor(Date.now() / 1000);
  const login = activeUser(id) || 'root';
  const crew = demoCrew(id);
  const records = [
    ['root', 1], ['ubuntu', 2], ['deploy', 4], ['nova', 0], ['orion', 41], ['dba', 6],
    ['ml', 14], ['release', 65], ['ci', 2], ['backup', 78],
  ];
  return {
    code: 0, err: '',
    out: ['@@ME', login, '@@U', ...Array.from(crew, ([user, uid]) =>
      `${user}:${uid}:${user === 'root' ? '/root' : '/home/' + user}:${user === 'backup' ? '/usr/sbin/nologin' : '/bin/bash'}:${uid}`),
    '@@G', 'sudo:x:27:ubuntu,dba', 'docker:x:999:ubuntu,deploy',
    '@@CLOCK', now, '@@PROCS', ...Array.from(crew, ([user, uid], i) =>
      ['root', 'nova', 'ci', 'dba', login].includes(user) ? `${uid} ${i + 2}` : '').filter(Boolean),
    '@@LAST', 'observer\t-', ...records.map(([user, days]) => `${user}\t${new Date((now - days * 86400) * 1000).toISOString()}`)].join('\n'),
  };
}

function mockRun(cmd, id) {
  const disk = cmd.match(/ rackbook '([\d,]+)'$/);
  if (cmd.includes('@@DISK') && disk) {
    const known = new Set([0, ...Array.from({ length: 10 }, (_, i) => 1001 + i)]);
    return { code: 0, err: '', out: '@@DISK\ncomplete 2\n' + disk[1].split(',').map((uid) =>
      `${uid} ${known.has(Number(uid)) ? (3 + (Number(uid) * 7) % 71) * 104857600 : 0}`).join('\n') + '\n' };
  }
  if (cmd.includes('query-compute-apps')) {
    const uu = (i) => `GPU-0000${i}-aaaa`;
    return { code: 0, err: '', out: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `${i}, ${uu(i)}`).join('\n') + '\n@@\n' +
      [0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [`${uu(i)}, ${23450 + i * 3}, ${18000 + i * 900}, python`, ...(i % 3 === 0 ? [`${uu(i)}, ${30111 + i}, 2100, /usr/bin/python3 -m vllm.entrypoints.api_server`] : [])]).join('\n') };
  }
  if (cmd.startsWith('ps -o pid=,user= -p')) {
    const pids = cmd.match(/-p ([\d,]+)/)[1].split(',');
    return { code: 0, err: '', out: pids.map((p, i) => `${p} ${i % 3 === 2 ? 'orion' : 'nova'}`).join('\n') };
  }
  if (cmd.includes('find . -mindepth 1')) {
    const now = Date.now() / 1000;
    const rows = [['d', 'd', 4096, '.config'], ['d', 'd', 4096, 'projects'], ['d', 'd', 4096, 'logs'], ['f', 'f', 3771, '.bashrc'], ['f', 'f', 807, '.profile'],
      ['f', 'f', 1452, 'docker-compose.yml'], ['f', 'f', 233, 'daemon.json'], ['f', 'f', 52113, 'notes.txt'], ['l', 'd', 9, 'data -> /data']];
    return { code: 0, err: '', out: '/root\n' + rows.map(([y, Y, s, n]) => `${y}\t${Y}\t${s}\t${now - s * 40}\t${y === 'd' ? 'drwxr-xr-x' : '-rw-r--r--'}\troot\t${n}`).join('\n') + '\n' };
  }
  if (cmd.includes('@@BODY')) {
    const m = cmd.match(/F=(.*?); printf/);
    let p = m ? m[1].replace(/"\$HOME"\//, '~/').replace(/'/g, '') : '';
    if (p.endsWith('daemon.json')) p = '/etc/docker/daemon.json';
    if (p.endsWith('docker-compose.yml')) p = '/srv/app/docker-compose.yml';
    const body = files[p] ?? files[p.replace('/root/', '~/')] ?? `# ${p}\nHello from the preview.\n`;
    return { code: 0, err: '', out: `${p.replace('~', '/root')}\n${Math.floor(Date.now() / 1000)} ${body.length} root 644\nW\n@@BODY\n${body}` };
  }
  if (cmd.startsWith('systemctl list-units')) return { code: 0, err: '', out: 'cron.service loaded active running Regular background program processing daemon\ndocker.service loaded active running Docker Application Container Engine\nnginx.service loaded active running A high performance web server\nssh.service loaded active running OpenBSD Secure Shell server\n' };
  if (cmd.includes('getent passwd')) return mockCrew(id);
  if (cmd.startsWith('stat -c')) return { code: 0, err: '', out: `${Math.floor(Date.now() / 1000)}\n` };
  return { code: 0, err: '', out: `$ ${cmd}\n（预览模式：命令没有真的执行）\n` };
}
