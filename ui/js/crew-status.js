import { invoke } from './api.js';

// Return only account details, process counts and timestamps. Login hosts and TTYs stay on the server.
const command = String.raw`export LC_ALL=C TZ=UTC
me=$(id -un) || exit 1
accounts=$(getent passwd) || exit 1
printf '@@ME\n%s\n@@U\n' "$me"
printf '%s\n' "$accounts" | awk -F: -v me="$me" '$1==me || $3==0 || ($3>=1000 && $3<65534) {print $1":"$3":"$6":"$7":"$4}'
printf '@@G\n'
for g in sudo wheel admin docker; do getent group "$g"; done
printf '@@CLOCK\n'
date +%s
if processes=$(exec ps -eo uid=,pid=,ppid= 2>/dev/null); then
  printf '@@PROCS\n'
  printf '%s\n' "$processes" | awk -v probe="$$" '
    $1 ~ /^[0-9]+$/ && $2 != probe && $3 != probe { count[$1]++ }
    END { for (uid in count) print uid, count[uid] }'
fi
printf '@@LAST\n'
lastlog 2>/dev/null | awk '
  BEGIN { split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", names); for (i in names) month[names[i]]=i }
  /\*\*Never logged in\*\*/ {print $1 "\t-"; next}
  NF >= 6 && $NF ~ /^[0-9][0-9][0-9][0-9]$/ && $(NF-1) == "+0000" && $(NF-4) in month {
    printf "%s\t%04d-%02d-%02dT%sZ\n", $1, $NF, month[$(NF-4)], $(NF-3), $(NF-2)
  }'
`;

export const INACTIVE_DAYS = 30;
export const CREW_STATUS = {
  online: '在线活跃',
  offline: '离线',
  inactive: '长期不活跃',
  unknown: '状态未知',
};

export async function readCrew(id) {
  const { code, out, err } = await invoke('run', { id, cmd: command, timeout: 20 });
  if (code !== 0) throw new Error(err.trim() || String(code));

  let section = '', login = '', clock = 0, hasProcesses = false;
  const accounts = [], groups = [], procs = new Map(), logins = new Map();
  for (const line of out.split('\n').map((line) => line.trim()).filter(Boolean)) {
    if (line.startsWith('@@')) {
      section = line;
      if (section === '@@PROCS') hasProcesses = true;
      continue;
    }
    switch (section) {
      case '@@ME': login = line; break;
      case '@@U': {
        const [name, uid, home, shell, gid] = line.split(':');
        if (name && /^\d+$/.test(uid) && shell != null) accounts.push({ name, uid: Number(uid), home, shell, gid });
        break;
      }
      case '@@G': {
        const [name, , gid, members] = line.split(':');
        if (members != null) groups.push({ name, gid, members: new Set(members.split(',').filter(Boolean)) });
        break;
      }
      case '@@CLOCK': clock = Number(line); break;
      case '@@PROCS': {
        const [uid, count] = line.split(/\s+/).map(Number);
        procs.set(uid, count);
        break;
      }
      case '@@LAST': {
        const [name, value] = line.split('\t');
        const last = value === '-' ? 0 : Date.parse(value) / 1000;
        if (Number.isFinite(last) && last >= 0) logins.set(name, last);
        break;
      }
    }
  }

  const users = accounts.map((user) => {
    const belongs = (group) => group.gid === user.gid || group.members.has(user.name);
    const last = logins.get(user.name);
    const count = hasProcesses ? (procs.get(user.uid) || 0) : null;
    const status = count === null ? 'unknown' : count > 0 ? 'online'
      : last > 0 && clock - last >= INACTIVE_DAYS * 86400 ? 'inactive' : 'offline';
    return {
      ...user, last, count, status,
      captain: user.uid === 0 || groups.some((group) => group.name !== 'docker' && belongs(group)),
      docker: groups.some((group) => group.name === 'docker' && belongs(group)),
    };
  });
  return { login, users };
}
