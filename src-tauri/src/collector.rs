//! One shell script per poll, read straight from /proc. Nothing is installed on the server.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;

use crate::model::*;

pub const SCRIPT: &str = r#"export LC_ALL=C
echo @@HOST; hostname 2>/dev/null; uname -r 2>/dev/null
echo @@OS; ( . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" ) || uname -s
echo @@NPROC; nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo
echo @@UPTIME; cat /proc/uptime 2>/dev/null
echo @@LOAD; cat /proc/loadavg 2>/dev/null
echo @@STAT; grep '^cpu' /proc/stat 2>/dev/null
echo @@MEM; cat /proc/meminfo 2>/dev/null
echo @@NET; cat /proc/net/dev 2>/dev/null
echo @@IO; cat /proc/diskstats 2>/dev/null
if [ "${1:-}" = quick ]; then echo @@END; exit 0; fi
echo @@DF; df -PkT 2>/dev/null || df -Pk 2>/dev/null
echo @@PROCESSES
getconf CLK_TCK 2>/dev/null || echo 100
cat /proc/uptime 2>/dev/null || echo unknown
ps -e -o pid=,uid=,rss=,user:128=,comm= 2>/dev/null | awk -v probe="$$" '
  $1 ~ /^[0-9]+$/ && $1 != probe {
    path="/proc/" $1 "/stat"
    ok=(getline line < path); close(path)
    if (ok != 1 || !sub(/^.*\) /,"",line)) next
    if (split(line,f," ") < 22) next
    # After the last ") ", fields 12/13 are CPU ticks and field 20 is process start time.
    comm=$0; for (i=1; i<=4; i++) sub(/^[[:space:]]*[^[:space:]]+[[:space:]]*/, "", comm)
    printf "%s\t%s\t%s\t%.0f\t%s\t%s\t%s\n", $1, $2, f[20], f[12]+f[13], $3, $4, comm
  }'
echo @@TCP; cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '$4=="01"{n++} END{print n+0}'
echo @@GPU; command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,clocks.sm,utilization.memory --format=csv,noheader,nounits 2>/dev/null
echo @@AMD; for d in /sys/class/drm/card*/device; do [ -r "$d/gpu_busy_percent" ] && echo "$(basename "$(dirname "$d")") $(cat "$d/gpu_busy_percent") $(cat "$d/mem_info_vram_used" 2>/dev/null || echo 0) $(cat "$d/mem_info_vram_total" 2>/dev/null || echo 0)"; done
echo @@DOCKER; command -v docker >/dev/null 2>&1 && echo yes
echo @@END
"#;

#[derive(Clone, Debug, Default)]
pub struct Raw {
    pub time: f64,
    pub uptime: Option<f64>,
    pub cpu: HashMap<String, Vec<u64>>,
    pub net: HashMap<String, (u64, u64)>,
    pub io: HashMap<String, (u64, u64)>,
    /// Share the previous detailed sample across lightweight host polls.
    processes: Arc<HashMap<i64, ProcessCounter>>,
    processes_at: f64,
    processes_uptime: Option<f64>,
}

#[derive(Clone, Copy, Debug)]
struct ProcessCounter {
    uid: u32,
    start: u64,
    ticks: u64,
}

const PROCESS_LIMIT: usize = 80;

fn sample_processes(lines: &[&str], s: &mut Snapshot, prev: Option<&Raw>) -> (Arc<HashMap<i64, ProcessCounter>>, f64, Option<f64>) {
    let clk: f64 = lines.first().and_then(|x| x.trim().parse().ok()).filter(|v: &f64| *v > 0.0 && v.is_finite()).unwrap_or(100.0);
    let uptime: Option<f64> = lines.get(1).and_then(|x| x.split_whitespace().next()).and_then(|x| x.parse().ok());
    let at = uptime.unwrap_or(s.time);
    let base = prev.filter(|p| !p.processes.is_empty() && p.processes_uptime.is_some() == uptime.is_some() && at > p.processes_at);
    let dt = base.map_or(0.0, |p| at - p.processes_at);
    let cores = s.cores.max(1) as f64;
    let mut processes = HashMap::new();
    let mut users: HashMap<&str, UserUse> = HashMap::new();
    for line in lines.iter().skip(2) {
        let fields: Vec<&str> = line.splitn(7, '\t').collect();
        let [pid, uid, start, ticks, rss, name, command] = fields.as_slice() else { continue };
        let (Ok(pid), Ok(uid), Ok(start), Ok(ticks), Ok(rss)) = (
            pid.parse::<i64>(), uid.parse::<u32>(), start.parse::<u64>(), ticks.parse::<u64>(), rss.parse::<u64>(),
        ) else { continue };
        if processes.insert(pid, ProcessCounter { uid, start, ticks }).is_some() { continue; }
        let delta = base.map_or(0, |p| match p.processes.get(&pid) {
            Some(old) if old.start == start && old.uid == uid => ticks.saturating_sub(old.ticks),
            // A process born inside this window contributes its lifetime ticks so far.
            _ if p.processes_uptime.is_some_and(|before| start as f64 / clk >= before) => ticks,
            _ => 0,
        });
        let core_used = if dt > 0.0 { delta as f64 / clk / dt } else { 0.0 };
        let rss = rss as f64 * 1024.0;
        let user = users.entry(*name).or_insert_with(|| UserUse { user: name.to_string(), ..Default::default() });
        user.cores += core_used;
        user.rss += rss;
        user.procs += 1;
        s.procs.push(ProcRow {
            pid, user: name.to_string(), command: command.to_string(), cpu: core_used * 100.0,
            mem: if s.mem_total > 0.0 { rss / s.mem_total * 100.0 } else { 0.0 }, rss,
        });
    }
    s.process_cpu_ready = base.is_some() && !processes.is_empty();
    s.users = users.into_values().map(|mut u| { u.cpu = (u.cores / cores * 100.0).min(100.0); u }).collect();
    s.users.sort_by(|a, b| b.cores.total_cmp(&a.cores).then(b.rss.total_cmp(&a.rss)).then(a.user.cmp(&b.user)));

    // Retain the leaders for both UI sort modes, not just the CPU leaders.
    s.procs.sort_by(|a, b| b.rss.total_cmp(&a.rss).then(a.pid.cmp(&b.pid)));
    let memory_top: std::collections::HashSet<i64> = s.procs.iter().take(PROCESS_LIMIT).map(|p| p.pid).collect();
    s.procs.sort_by(|a, b| b.cpu.total_cmp(&a.cpu).then(b.rss.total_cmp(&a.rss)).then(a.pid.cmp(&b.pid)));
    let mut rank = 0;
    s.procs.retain(|p| { rank += 1; rank <= PROCESS_LIMIT || memory_top.contains(&p.pid) });
    (Arc::new(processes), at, uptime)
}

pub fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn sections(out: &str) -> HashMap<String, Vec<&str>> {
    let mut d: HashMap<String, Vec<&str>> = HashMap::new();
    let mut cur = String::new();
    for line in out.split('\n') {
        if let Some(name) = line.strip_prefix("@@") {
            cur = name.trim().to_string();
            d.entry(cur.clone()).or_default();
            continue;
        }
        if !cur.is_empty() {
            d.entry(cur.clone()).or_default().push(line);
        }
    }
    d
}

fn ws(s: &str) -> Vec<&str> {
    s.split_whitespace().collect()
}

const SKIP_TYPES: &[&str] = &[
    "tmpfs", "devtmpfs", "squashfs", "overlay", "efivarfs", "proc", "sysfs", "cgroup", "cgroup2", "nsfs",
    "fuse.lxcfs", "ramfs", "autofs", "devpts", "mqueue", "tracefs", "debugfs", "securityfs", "pstore", "bpf",
    "configfs", "fusectl", "hugetlbfs", "binfmt_misc", "rpc_pipefs", "shm",
];
const SKIP_MOUNTS: &[&str] = &["/snap/", "/run", "/dev", "/sys", "/proc", "/var/lib/docker", "/var/lib/kubelet"];
const VIRTUAL_IF: &[&str] = &["docker", "br-", "virbr", "cni", "flannel", "cali", "tun", "wg", "vnet", "kube"];

pub fn build(out: &str, prev: Option<&Raw>) -> Option<(Snapshot, Raw)> {
    let d = sections(out);
    if !d.contains_key("END") || !d.contains_key("STAT") {
        return None;
    }
    let t = now();
    let get = |k: &str| d.get(k).cloned().unwrap_or_default();
    let uptime: Option<f64> = get("UPTIME").first().and_then(|line| ws(line).first().and_then(|v| v.parse().ok()));
    let prev = prev.filter(|p| p.uptime.zip(uptime).map_or(true, |(before, current)| current >= before));
    let dt = prev.map(|p| p.uptime.zip(uptime).map_or(t - p.time, |(before, current)| current - before)).unwrap_or(0.0);
    let full = d.contains_key("DF");
    let mut s = Snapshot { time: t, details_time: if full { t } else { 0.0 }, uptime: uptime.unwrap_or(0.0), ..Default::default() };

    let host = get("HOST");
    s.hostname = host.first().map(|x| x.to_string()).unwrap_or_default();
    s.kernel = host.get(1).map(|x| x.to_string()).unwrap_or_default();
    s.os = get("OS").first().map(|x| x.to_string()).unwrap_or_default();
    s.cores = get("NPROC").first().and_then(|x| x.trim().parse().ok()).unwrap_or(1);
    if let Some(l) = get("LOAD").first() {
        let f = ws(l);
        s.load = f.iter().take(3).map(|v| v.parse().unwrap_or(0.0)).collect();
        s.procs_running = f.get(3).map(|x| x.to_string()).unwrap_or_default();
    }

    // CPU
    let mut cpu: HashMap<String, Vec<u64>> = HashMap::new();
    for line in get("STAT") {
        let f = ws(line);
        if f.len() > 4 {
            cpu.insert(f[0].to_string(), f[1..].iter().map(|v| v.parse().unwrap_or(0)).collect());
        }
    }
    let busy = |key: &str| -> Option<(f64, f64)> {
        let a = cpu.get(key)?;
        let b = prev?.cpu.get(key)?;
        if a.len() < 5 || b.len() < 5 { return None; }
        let ta: f64 = a.iter().take(8).map(|&x| x as f64).sum();
        let tb: f64 = b.iter().take(8).map(|&x| x as f64).sum();
        let total = ta - tb;
        if total <= 0.0 { return None; }
        let idle = (a[3] as f64 + a[4] as f64) - (b[3] as f64 + b[4] as f64);
        Some((((total - idle) / total * 100.0).clamp(0.0, 100.0), ((a[4] as f64 - b[4] as f64).max(0.0) / total * 100.0)))
    };
    if let Some((c, w)) = busy("cpu") { s.cpu = c; s.iowait = w; }
    let mut cores: Vec<&String> = cpu.keys().filter(|k| k.len() > 3 && k.starts_with("cpu")).collect();
    cores.sort_by_key(|k| k[3..].parse::<i64>().unwrap_or(0));
    if !cores.is_empty() { s.cores = cores.len() as i64; }
    s.per_core = cores.iter().map(|k| busy(k).map(|x| x.0).unwrap_or(0.0)).collect();

    // Memory
    let mut m: HashMap<String, f64> = HashMap::new();
    for line in get("MEM") {
        let f = ws(line);
        if f.len() >= 2 {
            m.insert(f[0].trim_end_matches(':').to_string(), f[1].parse::<f64>().unwrap_or(0.0) * 1024.0);
        }
    }
    let g = |k: &str| *m.get(k).unwrap_or(&0.0);
    s.mem_total = g("MemTotal");
    let cached = g("Cached") + g("SReclaimable");
    s.mem_avail = m.get("MemAvailable").copied().unwrap_or(g("MemFree") + g("Buffers") + cached);
    s.mem_used = (s.mem_total - s.mem_avail).max(0.0);
    s.mem_cache = g("Buffers") + cached;
    s.swap_total = g("SwapTotal");
    s.swap_used = (s.swap_total - g("SwapFree")).max(0.0);

    // Network
    let mut net = HashMap::new();
    for line in get("NET") {
        let Some((name, rest)) = line.split_once(':') else { continue };
        let name = name.trim().to_string();
        let f = ws(rest);
        if f.len() < 9 { continue; }
        let rx: u64 = f[0].parse().unwrap_or(0);
        let tx: u64 = f[8].parse().unwrap_or(0);
        net.insert(name.clone(), (rx, tx));
        if name == "lo" || name.starts_with("veth") { continue; }
        let mut i = NetIface { name: name.clone(), rx, tx, ..Default::default() };
        if dt > 0.0 {
            if let Some(&(prx, ptx)) = prev.and_then(|p| p.net.get(&name)) {
                i.rx_rate = if rx >= prx { (rx - prx) as f64 / dt } else { 0.0 };
                i.tx_rate = if tx >= ptx { (tx - ptx) as f64 / dt } else { 0.0 };
            }
        }
        s.nets.push(i);
    }
    s.nets.sort_by(|a, b| (b.rx + b.tx).cmp(&(a.rx + a.tx)));
    for n in &s.nets {
        if VIRTUAL_IF.iter().any(|p| n.name.starts_with(p)) { continue; }
        s.rx_rate += n.rx_rate;
        s.tx_rate += n.tx_rate;
    }

    // Filesystems
    let df = get("DF");
    let has_type = df.first().map(|l| l.contains("Type")).unwrap_or(false);
    let o = if has_type { 1 } else { 0 };
    for line in df.iter().skip(1) {
        let f = ws(line);
        if f.len() < 6 + o { continue; }
        let fs = f[0].to_string();
        let kind = if has_type { f[1].to_string() } else { String::new() };
        let size = f[1 + o].parse::<f64>().unwrap_or(0.0) * 1024.0;
        let used = f[2 + o].parse::<f64>().unwrap_or(0.0) * 1024.0;
        let avail = f[3 + o].parse::<f64>().unwrap_or(0.0) * 1024.0;
        let mount = f[5 + o..].join(" ");
        if SKIP_TYPES.contains(&kind.as_str()) || size <= 0.0 || fs == "none" || fs == "tmpfs" { continue; }
        if SKIP_MOUNTS.iter().any(|p| mount.starts_with(p)) { continue; }
        if fs.starts_with("/dev/") && s.mounts.iter().any(|m| m.fs == fs) { continue; }
        s.mounts.push(Mount { fs, kind, mount, size, used, avail });
    }

    // Disk I/O
    let disk_re = Regex::new(r"^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme[0-9]+n[0-9]+|mmcblk[0-9]+)$").unwrap();
    let mut io = HashMap::new();
    for line in get("IO") {
        let f = ws(line);
        if f.len() < 10 || !disk_re.is_match(f[2]) { continue; }
        let r = f[5].parse::<u64>().unwrap_or(0).wrapping_mul(512);
        let w = f[9].parse::<u64>().unwrap_or(0).wrapping_mul(512);
        io.insert(f[2].to_string(), (r, w));
        if dt > 0.0 {
            if let Some(&(pr, pw)) = prev.and_then(|p| p.io.get(f[2])) {
                if r >= pr { s.io_read += (r - pr) as f64 / dt; }
                if w >= pw { s.io_write += (w - pw) as f64 / dt; }
            }
        }
    }

    let (processes, processes_at, processes_uptime) = if full {
        sample_processes(&get("PROCESSES"), &mut s, prev)
    } else {
        prev.map(|p| (p.processes.clone(), p.processes_at, p.processes_uptime)).unwrap_or_default()
    };
    s.tcp = get("TCP").first().and_then(|x| x.trim().parse().ok()).unwrap_or(0);

    // GPUs
    for line in get("GPU") {
        let f: Vec<&str> = line.split(',').map(|x| x.trim()).collect();
        if f.len() < 5 { continue; }
        let Ok(index) = f[0].parse() else { continue };
        s.gpus.push(Gpu {
            index,
            name: f[1].to_string(),
            util: f[2].parse().unwrap_or(0.0),
            mem_used: f[3].parse::<f64>().unwrap_or(0.0) * 1_048_576.0,
            mem_total: f[4].parse::<f64>().unwrap_or(0.0) * 1_048_576.0,
            temp: f.get(5).and_then(|v| v.parse().ok()),
            power: f.get(6).and_then(|v| v.parse().ok()),
            power_limit: f.get(7).and_then(|v| v.parse().ok()),
            fan: f.get(8).and_then(|v| v.parse().ok()),
            clock_sm: f.get(9).and_then(|v| v.parse().ok()),
            mem_util: f.get(10).and_then(|v| v.parse().ok()),
        });
    }
    if s.gpus.is_empty() {
        for (i, line) in get("AMD").iter().enumerate() {
            let f = ws(line);
            if f.len() < 4 { continue; }
            s.gpus.push(Gpu {
                index: i as i64,
                name: format!("AMD {}", f[0]),
                util: f[1].parse().unwrap_or(0.0),
                mem_used: f[2].parse().unwrap_or(0.0),
                mem_total: f[3].parse().unwrap_or(0.0),
                ..Default::default()
            });
        }
    }
    s.has_docker = get("DOCKER").iter().any(|l| l.trim() == "yes");

    Some((s, Raw { time: t, uptime, cpu, net, io, processes, processes_at, processes_uptime }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn poll(uptime: u64, procs: Option<&str>, prev: Option<&Raw>) -> (Snapshot, Raw) {
        let mut out = format!("@@NPROC\n4\n@@UPTIME\n{uptime}.0 0.0\n@@STAT\ncpu 100 0 200 600 50 0 0 0\n@@MEM\nMemTotal: 102400 kB\n");
        if let Some(procs) = procs {
            out.push_str(&format!("@@DF\n@@PROCESSES\n100\n{uptime}.0 0.0\n{procs}\n"));
        }
        out.push_str("@@END\n");
        build(&out, prev).unwrap()
    }

    #[test]
    fn process_exit_and_pid_reuse_do_not_hide_other_cpu_use() {
        let (first, before) = poll(100, Some(concat!(
            "11\t1000\t3200\t900\t512\talice\tlong (worker)\n",
            "12\t1000\t4500\t4500\t1024\talice\tsoon-exited\n",
            "13\t1001\t1300\t600\t768\tbob\told-pid",
        )), None);
        assert!(!first.process_cpu_ready);
        let (_, quick) = poll(101, None, Some(&before));
        assert!(Arc::ptr_eq(&before.processes, &quick.processes));
        let (after, _) = poll(103, Some(concat!(
            "11\t1000\t3200\t1050\t2048\talice\tlong (worker)\n",
            "13\t1001\t10100\t75\t768\tbob\tnew-pid\n",
            "14\t1000\t9000\t550\t1024\talice\tpreviously-unseen",
        )), Some(&quick));
        assert!(after.process_cpu_ready);
        let alice = after.users.iter().find(|u| u.user == "alice").unwrap();
        assert_eq!((alice.cores, alice.cpu, alice.rss, alice.procs), (0.5, 12.5, 3_145_728.0, 2));
        assert_eq!(after.procs.iter().find(|p| p.pid == 11).unwrap().command, "long (worker)");
        assert_eq!(after.procs.iter().find(|p| p.pid == 13).unwrap().cpu, 25.0);
        assert_eq!(after.procs.iter().find(|p| p.pid == 14).unwrap().cpu, 0.0);
        assert!(!poll(1, Some("11\t1000\t10\t5\t512\talice\tnew-boot"), Some(&quick)).0.process_cpu_ready);
    }

    #[test]
    fn keeps_memory_leaders_outside_the_top_cpu_pids() {
        let processes = (1..=100).map(|pid| format!("{pid}\t1000\t1000\t0\t{pid}\talice\tworker")).collect::<Vec<_>>().join("\n");
        let (_, before) = poll(100, Some(&processes), None);
        let processes = (1..=100).map(|pid| format!("{pid}\t1000\t1000\t{}\t{pid}\talice\tworker", 100 - pid)).collect::<Vec<_>>().join("\n");
        let (after, _) = poll(102, Some(&processes), Some(&before));
        assert_eq!(after.procs.first().unwrap().pid, 1);
        assert!(after.procs.iter().any(|p| p.pid == 100));
        assert_eq!(after.users[0].procs, 100);
    }
}
