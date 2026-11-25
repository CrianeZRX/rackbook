//! Finds servers the user already has configured elsewhere, so they can be added in one go:
//! OpenSSH's `~/.ssh/config` (with `Include`), and PuTTY's saved sessions on Windows.
//! Wildcard hosts (`Host *`, `Host *.corp`) are templates, not servers: their settings fill in the
//! concrete hosts they match, the same way `ssh` resolves them, and they're not listed themselves.

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub key_path: String,
    pub source: String,
    /// things Rackbook can't do for this host (e.g. ProxyJump), shown as a warning
    pub note: String,
}

#[derive(Clone, Debug, Default)]
struct Block {
    patterns: Vec<String>,
    opts: Vec<(String, String)>,
    file: String,
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_default()
}

fn expand(p: &str, base: &Path) -> PathBuf {
    let p = p.trim_matches('"');
    if let Some(rest) = p.strip_prefix("~/") {
        home().join(rest)
    } else if p == "~" {
        home()
    } else if Path::new(p).is_absolute() {
        PathBuf::from(p)
    } else {
        base.join(p)
    }
}

/// a tiny glob: `*` and `?` in the last path component only (enough for `Include config.d/*`)
fn glob(path: PathBuf) -> Vec<PathBuf> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if !name.contains('*') && !name.contains('?') {
        return vec![path];
    }
    let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let mut out: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_file() && wild(&name, &p.file_name().unwrap().to_string_lossy())).collect())
        .unwrap_or_default();
    out.sort();
    out
}

/// OpenSSH pattern match: `*` any run, `?` one character
fn wild(pat: &str, s: &str) -> bool {
    let (p, s): (Vec<char>, Vec<char>) = (pat.chars().collect(), s.chars().collect());
    let (mut i, mut j, mut star, mut mark) = (0, 0, None, 0);
    while j < s.len() {
        if i < p.len() && (p[i] == '?' || p[i].eq_ignore_ascii_case(&s[j])) {
            i += 1;
            j += 1;
        } else if i < p.len() && p[i] == '*' {
            star = Some(i);
            mark = j;
            i += 1;
        } else if let Some(st) = star {
            i = st + 1;
            mark += 1;
            j = mark;
        } else {
            return false;
        }
    }
    while i < p.len() && p[i] == '*' {
        i += 1;
    }
    i == p.len()
}

fn parse_file(path: &Path, out: &mut Vec<Block>, seen: &mut HashSet<PathBuf>, depth: usize) {
    if depth > 8 || !seen.insert(path.to_path_buf()) {
        return;
    }
    let Ok(text) = std::fs::read_to_string(path) else { return };
    let base = home().join(".ssh");
    let file = path.display().to_string();
    // options before the first Host line apply to every host
    let mut cur = Block { patterns: vec!["*".into()], opts: vec![], file: file.clone() };
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (k, v) = match line.split_once(|c: char| c.is_whitespace() || c == '=') {
            Some((k, v)) => (k.trim().to_ascii_lowercase(), v.trim().trim_start_matches('=').trim().to_string()),
            None => continue,
        };
        match k.as_str() {
            "host" => {
                out.push(std::mem::take(&mut cur));
                cur = Block { patterns: v.split_whitespace().map(String::from).collect(), opts: vec![], file: file.clone() };
            }
            "match" => {
                // Match blocks depend on runtime conditions; skip their options
                out.push(std::mem::take(&mut cur));
                cur = Block { patterns: vec![], opts: vec![], file: file.clone() };
            }
            "include" => {
                for inc in v.split_whitespace() {
                    for p in glob(expand(inc, &base)) {
                        // an Include inside a Host block still contributes whole blocks; flush first
                        out.push(std::mem::take(&mut cur));
                        cur = Block { patterns: vec![], opts: vec![], file: file.clone() };
                        parse_file(&p, out, seen, depth + 1);
                    }
                }
            }
            _ => cur.opts.push((k, v)),
        }
    }
    out.push(cur);
}

fn matches(b: &Block, alias: &str) -> bool {
    let mut hit = false;
    for p in &b.patterns {
        if let Some(neg) = p.strip_prefix('!') {
            if wild(neg, alias) {
                return false;
            }
        } else if wild(p, alias) {
            hit = true;
        }
    }
    hit
}

/// ssh's rule: for each option, the first value found wins, reading blocks top to bottom
fn resolve(blocks: &[Block], alias: &str) -> Vec<(String, String)> {
    let mut got: Vec<(String, String)> = vec![];
    for b in blocks.iter().filter(|b| matches(b, alias)) {
        for (k, v) in &b.opts {
            if k != "identityfile" && got.iter().any(|(gk, _)| gk == k) {
                continue;
            }
            got.push((k.clone(), v.clone()));
        }
    }
    got
}

pub fn scan_ssh_config(path: Option<PathBuf>) -> Vec<Found> {
    let path = path.unwrap_or_else(|| home().join(".ssh").join("config"));
    let mut blocks = vec![];
    parse_file(&path, &mut blocks, &mut HashSet::new(), 0);
    let mut out = vec![];
    let mut names = HashSet::new();
    for b in &blocks {
        for alias in &b.patterns {
            if alias.contains('*') || alias.contains('?') || alias.starts_with('!') || !names.insert(alias.clone()) {
                continue;
            }
            let opts = resolve(&blocks, alias);
            let get = |k: &str| opts.iter().find(|(ok, _)| ok == k).map(|(_, v)| v.clone());
            let host = get("hostname").map(|h| h.replace("%h", alias)).unwrap_or_else(|| alias.clone());
            let key = get("identityfile").map(|k| expand(&k.replace("%d", &home().display().to_string()), &home()).display().to_string()).unwrap_or_default();
            let mut note = vec![];
            if get("proxyjump").is_some() || get("proxycommand").is_some() {
                note.push("使用了 ProxyJump / ProxyCommand，Rackbook 暂不支持");
            }
            out.push(Found {
                name: alias.clone(),
                host,
                port: get("port").and_then(|p| p.parse().ok()).unwrap_or(22),
                user: get("user").unwrap_or_default(),
                key_path: key,
                source: b.file.clone(),
                note: note.join("; "),
            });
        }
    }
    out
}

/// PuTTY keeps sessions in the registry; `reg query` saves a dependency
#[cfg(windows)]
pub fn scan_putty() -> Vec<Found> {
    use std::os::windows::process::CommandExt;
    let root = r"HKCU\Software\SimonTatham\PuTTY\Sessions";
    let Ok(o) = std::process::Command::new("reg").args(["query", root, "/s"]).creation_flags(0x08000000).output() else { return vec![] };
    let text = String::from_utf8_lossy(&o.stdout);
    let mut out = vec![];
    let mut cur: Option<Found> = None;
    let decode = |s: &str| {
        // PuTTY percent-encodes session names
        let mut r = String::new();
        let b = s.as_bytes();
        let mut i = 0;
        while i < b.len() {
            if b[i] == b'%' && i + 2 < b.len() {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    r.push(v as char);
                    i += 3;
                    continue;
                }
            }
            r.push(b[i] as char);
            i += 1;
        }
        r
    };
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix(&format!("{root}\\")) {
            if let Some(f) = cur.take() {
                if !f.host.is_empty() {
                    out.push(f);
                }
            }
            cur = Some(Found { name: decode(rest), port: 22, source: "PuTTY".into(), ..Default::default() });
            continue;
        }
        let parts: Vec<&str> = line.trim().splitn(3, "    ").collect();
        if parts.len() < 3 {
            continue;
        }
        let (k, v) = (parts[0], parts[2].trim());
        if let Some(f) = cur.as_mut() {
            match k {
                "HostName" => {
                    if let Some((u, h)) = v.split_once('@') {
                        f.user = u.into();
                        f.host = h.into();
                    } else {
                        f.host = v.into();
                    }
                }
                "UserName" if !v.is_empty() => f.user = v.into(),
                "PortNumber" => f.port = u16::from_str_radix(v.trim_start_matches("0x"), 16).unwrap_or(22),
                "PublicKeyFile" if !v.is_empty() => {
                    f.key_path = v.into();
                    if v.to_ascii_lowercase().ends_with(".ppk") {
                        f.note = "PuTTY 的 .ppk 私钥需要先用 PuTTYgen 转成 OpenSSH 格式".into();
                    }
                }
                "Protocol" if v != "ssh" => f.host.clear(),
                _ => {}
            }
        }
    }
    if let Some(f) = cur {
        if !f.host.is_empty() {
            out.push(f);
        }
    }
    out.retain(|f| f.name != "Default Settings");
    out
}
#[cfg(not(windows))]
pub fn scan_putty() -> Vec<Found> {
    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_config_with_wildcards_and_include() {
        let dir = std::env::temp_dir().join(format!("rb-ssh-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("conf.d")).unwrap();
        // relative Includes resolve against ~/.ssh, like ssh itself; the test uses an absolute one
        std::fs::write(
            dir.join("config"),
            format!("User fallback\nInclude {}/conf.d/*\n\nHost web-01 web-02\n  HostName %h.example.com\n  Port 2222\n\nHost db\n  HostName 10.0.0.5\n  User postgres\n  IdentityFile ~/.ssh/db_key\n\nHost *.internal !skip.internal\n  ProxyJump bastion\n\nHost *\n  User everyone\n  IdentityFile ~/.ssh/id_ed25519\n", dir.display()),
        )
        .unwrap();
        std::fs::write(dir.join("conf.d/extra"), "Host gpu.internal\n  User ml\n").unwrap();
        let f = scan_ssh_config(Some(dir.join("config")));
        let by = |n: &str| f.iter().find(|x| x.name == n).unwrap().clone();
        assert_eq!(f.len(), 4, "{f:#?}");
        assert_eq!(by("web-01").host, "web-01.example.com");
        assert_eq!(by("web-02").port, 2222);
        assert_eq!(by("web-01").user, "fallback");
        assert_eq!(by("db").user, "fallback"); // first value wins: the top-level User comes first
        assert!(by("db").key_path.ends_with(".ssh/db_key"));
        assert_eq!(by("gpu.internal").user, "fallback");
        assert!(by("gpu.internal").note.contains("ProxyJump"));
        assert!(!f.iter().any(|x| x.name.contains('*')));
    }
}
