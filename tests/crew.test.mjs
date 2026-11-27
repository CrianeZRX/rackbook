import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

let bridge;
globalThis.window = { __TAURI__: { core: { invoke: (...args) => bridge(...args) } } };
globalThis.document = { documentElement: {} };
globalThis.ResizeObserver = globalThis.MutationObserver = class { observe() {} };
const { readCrewDisk } = await import('../ui/js/crew-status.js');
const { advanceOrbit, newOrbit } = await import('../ui/js/rockets.js');

test('similar CPU ranks, load changes and resuming from sleep keep a rocket on its lane', () => {
  const scene = newOrbit();
  const alice = { user: 'alice', cpu: 40, rss: 400 };
  const bob = { user: 'bob', cpu: 5, rss: 100 };
  const [first] = advanceOrbit(scene, [alice, bob], 1000);
  const [, next] = advanceOrbit(scene, [{ ...bob, cpu: 50 }, { ...alice, cpu: 1, rss: 25 }], 1000.02);
  assert.equal(first.lane, next.lane);
  assert.ok(next.angle > first.angle && next.angle - first.angle < 0.02);
  assert.ok(next.size > 50 && next.size < first.size);
  const [afterSleep] = advanceOrbit(scene, [alice], 1500);
  assert.equal(afterSleep.lane, first.lane);
  assert.ok(afterSleep.angle > next.angle && afterSleep.angle - next.angle < 0.1);
});

test('disk scan deduplicates hard links and bind mounts and reports unreadable data as partial', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rackbook-crew-'));
  const mounts = join(dir, 'mounts');
  try {
    writeFileSync(mounts, String.raw`20 1 8:1 / / rw - ext4 /dev/sda1 rw
21 20 8:1 /home/alice /mnt/alice\040alias rw - ext4 /dev/sda1 rw
22 20 8:2 / /mnt/data rw - xfs /dev/sdb rw
23 20 0:41 / /mnt/network rw - nfs4 server:/data rw
`);
    writeFileSync(join(dir, 'timeout'), String.raw`#!/bin/sh
shift 5
script=$(printf '%s' "$1" | sed 's|/proc/self/mountinfo|"$RACKBOOK_TEST_MOUNTS"|')
shift
exec sh -c "$script" "$@"
`, { mode: 0o700 });
    writeFileSync(join(dir, 'find'), String.raw`#!/bin/sh
emit() { printf '%s %s\n' "$kind" "$1"; }
target=$2
kind=$(printf '%s' "$6" | cut -d' ' -f1)
case "$target" in
  /) emit '101 19 1 1000 24'; emit '101 20 2 1000 8'; emit '101 20 2 1000 8' ;;
  '/mnt/alice alias') emit '101 19 1 1000 24' ;;
  /mnt/data) emit '102 67 1 1000 12'; test "$RACKBOOK_TEST_PARTIAL" = no ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });

    let partial = 'no';
    bridge = async (method, { cmd, timeout }) => {
      assert.equal(method, 'sudo');
      assert.equal(timeout, 100);
      const out = execFileSync('sh', ['-c', cmd], { encoding: 'utf8', env: {
        ...process.env, PATH: dir + ':' + process.env.PATH, RACKBOOK_TEST_MOUNTS: mounts, RACKBOOK_TEST_PARTIAL: partial,
      } });
      return { code: 0, out, err: '' };
    };
    const users = [{ uid: 1000 }, { uid: 1001 }, { uid: 1000 }];
    const first = await readCrewDisk('test', users, true);
    assert.equal(first.partial, false);
    assert.equal(first.bytes.get(1000), 44 * 512);
    assert.equal(first.bytes.get(1001), 0);
    partial = 'yes';
    assert.equal((await readCrewDisk('test', users, true)).partial, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unprivileged scans are labeled as lower bounds and failed scans do not become zeroes', async () => {
  bridge = async (method) => {
    assert.equal(method, 'run');
    return { code: 0, out: '@@DISK\ncomplete 1\n1000 0\n', err: '' };
  };
  assert.equal((await readCrewDisk('test', [{ uid: 1000 }], false)).partial, true);
  bridge = async () => ({ code: 124, out: '', err: '' });
  await assert.rejects(readCrewDisk('test', [{ uid: 1000 }], false), /90 秒/);
});

test('Linux process sampler reads CPU ticks even for names with spaces and closing parentheses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rackbook-procs-'));
  try {
    const pid = 987654321;
    const fields = Array(22).fill('0');
    fields[0] = 'R'; fields[11] = '15'; fields[12] = '25'; fields[19] = '3456';
    mkdirSync(join(dir, String(pid)));
    writeFileSync(join(dir, String(pid), 'stat'), `${pid} (worker ) pool) ${fields.join(' ')}\n`);
    writeFileSync(join(dir, 'uptime'), '42.00 97.00\n');
    writeFileSync(join(dir, 'ps'), `#!/bin/sh\nprintf '  ${pid} 1000 2048 alice worker ) pool\\n'\n`, { mode: 0o700 });
    const rust = readFileSync(new URL('../src-tauri/src/collector.rs', import.meta.url), 'utf8');
    const script = rust.slice(rust.indexOf('echo @@PROCESSES'), rust.indexOf('echo @@TCP')).replaceAll('/proc/', dir + '/');
    const out = execFileSync('sh', ['-c', script], { encoding: 'utf8', env: { ...process.env, PATH: dir + ':' + process.env.PATH } });
    assert.ok(out.includes(`${pid}\t1000\t3456\t40\t2048\talice\tworker ) pool\n`), out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
