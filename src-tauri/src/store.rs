//! The fleet: configs, live state, polling loops, connections and everything that needs a password.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde::Deserialize;
use serde_json::json;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::collector::{self, Raw};
use crate::model::*;
use crate::secrets;
use crate::ssh::{Auth, Conn, Endpoint, KnownHosts};

pub type Emit = Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>;

/// A secret typed in the editor, to be stored in the credential manager.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SecretInput {
    pub account_id: Uuid,
    /// "login" | "keypass" | "sudo"
    pub kind: String,
    /// None / empty = delete
    pub value: Option<String>,
}

pub fn shq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub struct Store {
    pub data_dir: PathBuf,
    pub servers: RwLock<Vec<ServerConfig>>,
    pub live: RwLock<HashMap<Uuid, Live>>,
    pub prefs: RwLock<Prefs>,
    pub backgrounded: RwLock<bool>,
    prev: Mutex<HashMap<Uuid, Raw>>,
    conns: tokio::sync::Mutex<HashMap<Uuid, Arc<Conn>>>,
    dial_locks: Mutex<HashMap<Uuid, Arc<tokio::sync::Mutex<()>>>>,
    loops: Mutex<HashMap<Uuid, JoinHandle<()>>>,
    pub known: Arc<KnownHosts>,
    emit: Emit,
    /// open embedded terminals: id -> the shell channel's write half
    terms: tokio::sync::Mutex<HashMap<String, Arc<russh::ChannelWriteHalf<russh::client::Msg>>>>,
}

impl Store {
    pub fn new(data_dir: PathBuf, emit: Emit) -> Arc<Store> {
        let _ = std::fs::create_dir_all(&data_dir);
        let servers: Vec<ServerConfig> = std::fs::read(data_dir.join("servers.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let prefs: Prefs = std::fs::read(data_dir.join("prefs.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let mut live = HashMap::new();
        for s in &servers {
            live.insert(s.id, Live { phase: if s.paused { "parked".into() } else { "idle".into() }, ..Default::default() });
        }
        Arc::new(Store {
            known: Arc::new(KnownHosts::load(data_dir.join("known_hosts.json"))),
            data_dir,
            servers: RwLock::new(servers),
            live: RwLock::new(live),
            prefs: RwLock::new(prefs),
            backgrounded: RwLock::new(false),
            prev: Mutex::new(HashMap::new()),
            conns: tokio::sync::Mutex::new(HashMap::new()),
            dial_locks: Mutex::new(HashMap::new()),
            loops: Mutex::new(HashMap::new()),
            emit,
            terms: Default::default(),
        })
    }

    // ---------- events & persistence ----------

    // ---------- embedded terminal ----------

    /// Opens a server or image shell and streams its output as "term" events.
    pub async fn term_open(self: &Arc<Self>, id: Uuid, cols: u32, rows: u32, image: Option<&str>) -> Result<String, String> {
        use base64::Engine;
        let tid = Uuid::new_v4().to_string();
        let (command, auth) = match image {
            Some(image) => {
                let (cmd, auth) = self.image_shell(id, image, &tid).await?;
                (Some(cmd), auth)
            }
            None => (None, None),
        };
        let c = self.conn(id).await?;
        let (mut rd, wr) = c.shell(cols, rows, command.as_deref(), auth.as_ref().map(|(prompt, ready, password)| (prompt.as_str(), ready.as_str(), password.as_str())))
            .await.map_err(|e| crate::ssh::friendly(&e.to_string()))?;
        self.terms.lock().await.insert(tid.clone(), Arc::new(wr));
        let me = self.clone();
        let t2 = tid.clone();
        tokio::spawn(async move {
            let b64 = base64::engine::general_purpose::STANDARD;
            while let Some(msg) = rd.wait().await {
                match msg {
                    russh::ChannelMsg::Data { ref data } | russh::ChannelMsg::ExtendedData { ref data, .. } => {
                        (me.emit)("term", json!({ "tid": t2, "data": b64.encode(&data[..]) }));
                    }
                    russh::ChannelMsg::ExitStatus { exit_status } => {
                        (me.emit)("term", json!({ "tid": t2, "exit": exit_status }));
                    }
                    russh::ChannelMsg::Eof | russh::ChannelMsg::Close => break,
                    _ => {}
                }
            }
            me.terms.lock().await.remove(&t2);
            (me.emit)("term", json!({ "tid": t2, "closed": true }));
        });
        Ok(tid)
    }

    async fn image_shell(&self, id: Uuid, image: &str, tid: &str) -> Result<(String, Option<(String, String, String)>), String> {
        let digest = image.strip_prefix("sha256:").unwrap_or(image);
        if !(12..=64).contains(&digest.len()) || !digest.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("无法识别 Docker 镜像 ID".into());
        }
        let acct = self.server(id).and_then(|s| s.active().cloned()).ok_or("没有登舰账户")?;
        let check = self.docker(id, "version --format '{{.Server.Version}}'", 15).await;
        if !check.ok() { return Err(format!("Docker：{}", if check.err.trim().is_empty() { check.code.to_string() } else { check.err.trim().to_owned() })); }
        if self.server(id).and_then(|s| s.active().map(|a| a.id)) != Some(acct.id) {
            return Err("登舰账户已切换，请重新打开终端".into());
        }
        let name = format!("rackbook-shell-{tid}");
        let cmd = format!(
            "trap 'docker rm -f {name} >/dev/null 2>&1' EXIT; trap 'exit 129' HUP; trap 'exit 143' TERM; \
             docker run --rm --pull=never --name {name} -it --entrypoint /bin/sh {} -i", shq(image)
        );
        if !self.docker_via_sudo(id) || acct.privilege == Privilege::Root { return Ok((cmd, None)); }
        if acct.privilege == Privilege::Nopasswd { return Ok((format!("sudo -n sh -c {}", shq(&cmd)), None)); }
        let password = self.sudo_password(&acct).filter(|_| acct.privilege == Privilege::Password)
            .ok_or("Docker 终端需要可用的 sudo 密码")?;
        let prompt = format!("__rackbook_password_{tid}__");
        let ready = format!("__rackbook_ready_{tid}__");
        // Wait for sudo's own prompt before sending the secret, with echo disabled on the outer PTY.
        let privileged = format!("stty echo; printf %s {}; {cmd}", shq(&ready));
        let script = format!(
            "stty -echo || exit 1; sudo -k -S -p {} sh -c {}; status=$?; stty echo; exit \"$status\"",
            shq(&prompt), shq(&privileged)
        );
        Ok((script, Some((prompt, ready, password))))
    }

    pub async fn term_write(&self, tid: &str, data: &[u8]) -> Result<(), String> {
        let w = self.terms.lock().await.get(tid).cloned().ok_or("终端已关闭")?;
        w.data(data).await.map_err(|e| e.to_string())
    }

    pub async fn term_resize(&self, tid: &str, cols: u32, rows: u32) {
        if let Some(w) = self.terms.lock().await.get(tid).cloned() {
            let _ = w.window_change(cols.max(20), rows.max(5), 0, 0).await;
        }
    }

    pub async fn term_close(&self, tid: &str) {
        if let Some(w) = self.terms.lock().await.remove(tid) {
            let _ = w.eof().await;
            let _ = w.close().await;
        }
    }

    pub fn say(&self, text: impl Into<String>, tone: &str) {
        (self.emit)("status", json!({ "text": text.into(), "tone": tone }));
    }

    fn emit_live(&self, id: Uuid) {
        let l = self.live.read().unwrap().get(&id).cloned();
        if let Some(l) = l {
            (self.emit)("live", json!({ "id": id, "live": l }));
        }
    }

    pub fn emit_servers(&self) {
        let s = self.servers.read().unwrap().clone();
        (self.emit)("servers", json!(s));
    }

    pub fn persist(&self) {
        let s = self.servers.read().unwrap().clone();
        if let Ok(b) = serde_json::to_vec_pretty(&s) {
            let _ = std::fs::write(self.data_dir.join("servers.json"), b);
        }
    }

    pub fn save_prefs(&self, p: Prefs) {
        *self.prefs.write().unwrap() = p.clone();
        if let Ok(b) = serde_json::to_vec_pretty(&p) {
            let _ = std::fs::write(self.data_dir.join("prefs.json"), b);
        }
        (self.emit)("prefs", json!(p));
    }

    pub fn server(&self, id: Uuid) -> Option<ServerConfig> {
        self.servers.read().unwrap().iter().find(|s| s.id == id).cloned()
    }

    pub fn privilege(&self, id: Uuid) -> Privilege {
        self.server(id).and_then(|s| s.active().map(|a| a.privilege)).unwrap_or_default()
    }

    fn set_live(&self, id: Uuid, f: impl FnOnce(&mut Live)) {
        {
            let mut m = self.live.write().unwrap();
            let l = m.entry(id).or_default();
            f(l);
        }
        self.emit_live(id);
    }

    // ---------- connections ----------

    fn endpoint(cfg: &ServerConfig) -> Result<Endpoint, String> {
        let a = cfg.active().ok_or("这艘船还没有登舰账户")?;
        let auth = if a.auth == "password" {
            Auth::Password(secrets::get(&a.key("login")).ok_or("这个账户用密码登录，但凭据管理器里还没有密码（在「编辑」里填上）")?)
        } else {
            Auth::Key {
                path: if a.key_path.trim().is_empty() { None } else { Some(a.key_path.clone()) },
                pass: if a.has_key_pass { secrets::get(&a.key("keypass")) } else { None },
            }
        };
        Ok(Endpoint { host: cfg.host.trim().to_string(), port: cfg.port, user: a.user.trim().to_string(), auth })
    }

    async fn conn(&self, id: Uuid) -> Result<Arc<Conn>, String> {
        {
            let m = self.conns.lock().await;
            if let Some(c) = m.get(&id) {
                if c.alive() {
                    return Ok(c.clone());
                }
            }
        }
        let lock = self.dial_locks.lock().unwrap().entry(id).or_default().clone();
        let _g = lock.lock().await;
        {
            let m = self.conns.lock().await;
            if let Some(c) = m.get(&id) {
                if c.alive() {
                    return Ok(c.clone());
                }
            }
        }
        let cfg = self.server(id).ok_or("这艘舰船已退出舰队")?;
        if cfg.paused {
            return Err("已断开（停泊中），先点「接通」".into());
        }
        let ep = Self::endpoint(&cfg)?;
        let c = Arc::new(Conn::connect(&ep, self.known.clone()).await.map_err(|e| e.to_string())?);
        self.conns.lock().await.insert(id, c.clone());
        Ok(c)
    }

    pub async fn drop_conn(&self, id: Uuid) {
        let c = self.conns.lock().await.remove(&id);
        if let Some(c) = c {
            c.close().await;
        }
    }

    pub async fn close_all(&self) {
        let all: Vec<Arc<Conn>> = self.conns.lock().await.drain().map(|(_, c)| c).collect();
        for c in all {
            c.close().await;
        }
    }

    pub async fn run_bytes(&self, id: Uuid, cmd: &str, stdin: Option<&[u8]>, timeout: u64) -> Result<crate::ssh::ExecOut, String> {
        let c = self.conn(id).await?;
        match c.exec(cmd, stdin, Duration::from_secs(timeout)).await {
            Ok(o) => Ok(o),
            Err(e) => {
                if !c.alive() {
                    self.conns.lock().await.remove(&id);
                }
                Err(e.to_string())
            }
        }
    }

    pub async fn run(&self, id: Uuid, cmd: &str, stdin: Option<&[u8]>, timeout: u64) -> RunOut {
        match self.run_bytes(id, cmd, stdin, timeout).await {
            Ok(o) => RunOut {
                out: String::from_utf8_lossy(&o.out).into_owned(),
                err: String::from_utf8_lossy(&o.err).into_owned(),
                code: o.code,
            },
            Err(e) => RunOut::fail(e),
        }
    }

    // ---------- roles ----------

    /// Who are we on this server? root / passwordless sudo / sudo with stored password / nothing.
    pub async fn probe(&self, id: Uuid) {
        let Some(cfg) = self.server(id) else { return };
        let Some(acct) = cfg.active().cloned() else { return };
        let cmd = r#"echo "U=$(id -un)"; echo "G=$(id -Gn)"; if [ "$(id -u)" -eq 0 ]; then echo P=root; elif sudo -n true 2>/dev/null; then echo P=nopasswd; else echo P=no; fi"#;
        let r = self.run(id, cmd, None, 15).await;
        if !r.ok() {
            return;
        }
        let mut kv = HashMap::new();
        for line in r.out.lines() {
            if let Some((k, v)) = line.split_once('=') {
                kv.insert(k.to_string(), v.to_string());
            }
        }
        let p = match kv.get("P").map(|s| s.as_str()) {
            Some("root") => Privilege::Root,
            Some("nopasswd") => Privilege::Nopasswd,
            _ => {
                let groups = kv.get("G").cloned().unwrap_or_default();
                if groups.split_whitespace().any(|g| g == "sudo" || g == "wheel" || g == "admin") {
                    let mut p = Privilege::NeedsPassword;
                    if let Some(pw) = self.sudo_password(&acct) {
                        let v = self.run(id, "sudo -S -p '' true", Some(format!("{pw}\n").as_bytes()), 15).await;
                        if v.ok() {
                            p = Privilege::Password;
                        }
                    }
                    p
                } else {
                    Privilege::None
                }
            }
        };
        let changed = acct.privilege != p;
        {
            let mut ss = self.servers.write().unwrap();
            if let Some(s) = ss.iter_mut().find(|s| s.id == id) {
                if let Some(a) = s.accounts.iter_mut().find(|a| a.id == acct.id) {
                    a.privilege = p;
                }
            }
        }
        self.set_live(id, |l| l.probed = Some(acct.id));
        if changed {
            self.persist();
            self.emit_servers();
            self.say(
                format!("「{}」上的 {} 是{}：{}。", cfg.title(), kv.get("U").cloned().unwrap_or(acct.title()), p.role_name(), p.detail()),
                if p.can_sudo() { "ok" } else { "info" },
            );
        }
    }

    fn sudo_password(&self, a: &Account) -> Option<String> {
        if a.has_sudo_password {
            if let Some(p) = secrets::get(&a.key("sudo")) {
                return Some(p);
            }
        }
        if a.auth == "password" && a.has_login_password {
            return secrets::get(&a.key("login"));
        }
        None
    }

    /// Run with root power the way the active account is allowed to; navigators are refused.
    pub async fn sudo(&self, id: Uuid, cmd: &str, stdin: Option<&[u8]>, timeout: u64) -> RunOut {
        let Some(acct) = self.server(id).and_then(|s| s.active().cloned()) else { return RunOut::fail("没有登舰账户") };
        match acct.privilege {
            Privilege::Root => self.run(id, cmd, stdin, timeout).await,
            Privilege::Nopasswd => self.run(id, &format!("sudo -n sh -c {}", shq(cmd)), stdin, timeout).await,
            Privilege::Password => {
                let Some(pw) = self.sudo_password(&acct) else { return RunOut::fail("凭据管理器里找不到 sudo 密码") };
                let mut input = format!("{pw}\n").into_bytes();
                if let Some(s) = stdin {
                    input.extend_from_slice(s);
                }
                self.run(id, &format!("sudo -S -p '' sh -c {}", shq(cmd)), Some(&input), timeout).await
            }
            Privilege::NeedsPassword => RunOut::fail(format!("{} 是舰长，但还没存可用的 sudo 密码（在「船员」里补上）", acct.title())),
            Privilege::None => RunOut::fail(format!("领航员 {} 没有 sudo 权限，这个操作需要舰长", acct.title())),
            Privilege::Unknown => RunOut::fail(format!("还没查验 {} 的权限", acct.title())),
        }
    }

    pub async fn docker(&self, id: Uuid, args: &str, timeout: u64) -> RunOut {
        let via_sudo = self.live.read().unwrap().get(&id).map(|l| l.docker_sudo).unwrap_or(false);
        if !via_sudo {
            let r = self.run(id, &format!("docker {args}"), None, timeout).await;
            if r.ok() || !r.err.to_lowercase().contains("permission denied") {
                return r;
            }
            self.live.write().unwrap().entry(id).or_default().docker_sudo = true;
        }
        self.sudo(id, &format!("docker {args}"), None, timeout).await
    }

    pub fn docker_via_sudo(&self, id: Uuid) -> bool {
        self.live.read().unwrap().get(&id).map(|l| l.docker_sudo).unwrap_or(false)
    }

    pub async fn write_file(&self, id: Uuid, path: &str, content: &[u8], elevated: bool) -> RunOut {
        let p = shq(path);
        if elevated {
            self.sudo(id, &format!("cat > {p}"), Some(content), 60).await
        } else {
            self.run(id, &format!("cat > {p}"), Some(content), 60).await
        }
    }

    // ---------- polling ----------

    pub fn start(self: &Arc<Self>) {
        let ids: Vec<Uuid> = self.servers.read().unwrap().iter().filter(|s| !s.paused).map(|s| s.id).collect();
        for id in ids {
            self.start_loop(id);
        }
    }

    pub fn start_loop(self: &Arc<Self>, id: Uuid) {
        if let Some(h) = self.loops.lock().unwrap().remove(&id) {
            h.abort();
        }
        let me = self.clone();
        let h = tokio::spawn(async move {
            loop {
                let Some(cfg) = me.server(id) else { return };
                if cfg.paused {
                    return;
                }
                me.poll(id).await;
                let l = me.live.read().unwrap().get(&id).cloned().unwrap_or_default();
                let wait = if l.phase == "offline" {
                    cfg.interval.max(15.0)
                } else if l.hist.cpu.is_empty() {
                    1.0
                } else {
                    cfg.interval.max(1.0)
                };
                tokio::time::sleep(Duration::from_secs_f64(wait)).await;
            }
        });
        self.loops.lock().unwrap().insert(id, h);
    }

    fn stop_loop(&self, id: Uuid) {
        if let Some(h) = self.loops.lock().unwrap().remove(&id) {
            h.abort();
        }
    }

    pub async fn poll(&self, id: Uuid) {
        let Some(cfg) = self.server(id) else { return };
        if cfg.paused {
            return;
        }
        {
            let mut m = self.live.write().unwrap();
            let l = m.entry(id).or_default();
            if l.polling {
                return;
            }
            l.polling = true;
            if l.snap.is_none() && l.phase != "offline" {
                l.phase = "connecting".into();
            }
        }
        self.emit_live(id);

        let probed = self.live.read().unwrap().get(&id).and_then(|l| l.probed);
        let res: Result<(), String> = async {
            self.conn(id).await?;
            if probed != cfg.active().map(|a| a.id) {
                self.probe(id).await;
            }
            let o = self.run_bytes(id, "sh -s", Some(collector::SCRIPT.as_bytes()), 25).await?;
            let out = String::from_utf8_lossy(&o.out);
            let prev = self.prev.lock().unwrap().get(&id).cloned();
            let (snap, raw) = collector::build(&out, prev.as_ref()).ok_or_else(|| {
                let e = String::from_utf8_lossy(&o.err).trim().to_string();
                if e.is_empty() { "没读到完整数据（目标是 Linux 吗？）".to_string() } else { e }
            })?;
            self.prev.lock().unwrap().insert(id, raw);
            let was_down;
            {
                let mut m = self.live.write().unwrap();
                let l = m.entry(id).or_default();
                was_down = l.phase != "online";
                if prev.is_some() {
                    History::push(&mut l.hist.cpu, snap.cpu);
                    History::push(&mut l.hist.mem, if snap.mem_total > 0.0 { snap.mem_used / snap.mem_total * 100.0 } else { 0.0 });
                    History::push(&mut l.hist.rx, snap.rx_rate);
                    History::push(&mut l.hist.tx, snap.tx_rate);
                    History::push(&mut l.hist.io_r, snap.io_read);
                    History::push(&mut l.hist.io_w, snap.io_write);
                    History::push(&mut l.hist.load, snap.load.first().copied().unwrap_or(0.0));
                    let g = if snap.gpus.is_empty() { 0.0 } else { snap.gpus.iter().map(|g| g.util).sum::<f64>() / snap.gpus.len() as f64 };
                    History::push(&mut l.hist.gpu, g);
                    l.snap = Some(snap.clone());
                } else if l.snap.is_none() {
                    l.snap = Some(snap.clone());
                }
                l.phase = "online".into();
                l.error.clear();
                l.last_update = collector::now();
            }
            if was_down {
                let role = self.privilege(id).role_name();
                self.say(format!("「{}」接通了：{} 核{}。以{}身份登舰。", cfg.title(), snap.cores,
                    if snap.gpus.is_empty() { String::new() } else { format!("，{} 块显卡", snap.gpus.len()) }, role), "ok");
            }
            Ok(())
        }
        .await;

        let still_active = self.server(id).map(|s| !s.paused).unwrap_or(false);
        if let Err(e) = res {
            if still_active {
                let was = self.live.read().unwrap().get(&id).map(|l| l.phase == "offline").unwrap_or(false);
                self.drop_conn(id).await;
                self.set_live(id, |l| {
                    l.phase = "offline".into();
                    l.error = e.clone();
                    l.polling = false;
                });
                if !was {
                    self.say(format!("「{}」失联：{e}", cfg.title()), "warn");
                }
                return;
            }
        }
        self.set_live(id, |l| l.polling = false);
    }

    // ---------- fleet operations ----------

    fn apply_secrets(&self, cfg: &mut ServerConfig, secrets_in: &[SecretInput]) {
        for s in secrets_in {
            let Some(a) = cfg.accounts.iter_mut().find(|a| a.id == s.account_id) else { continue };
            let key = a.key(&s.kind);
            let has = match &s.value {
                Some(v) if !v.is_empty() => secrets::set(&key, v).is_ok(),
                _ => {
                    secrets::delete(&key);
                    false
                }
            };
            match s.kind.as_str() {
                "login" => a.has_login_password = has,
                "keypass" => a.has_key_pass = has,
                "sudo" => a.has_sudo_password = has,
                _ => {}
            }
            a.privilege = Privilege::Unknown;
        }
    }

    pub async fn save_server(self: &Arc<Self>, mut cfg: ServerConfig, secrets_in: Vec<SecretInput>) {
        self.apply_secrets(&mut cfg, &secrets_in);
        if cfg.name.trim().is_empty() {
            cfg.name = cfg.host.clone();
        }
        if cfg.active_account.is_none() || !cfg.accounts.iter().any(|a| Some(a.id) == cfg.active_account) {
            cfg.active_account = cfg.accounts.first().map(|a| a.id);
        }
        cfg.paused = false;
        let existed;
        {
            let mut ss = self.servers.write().unwrap();
            if let Some(old) = ss.iter_mut().find(|s| s.id == cfg.id) {
                // forget secrets of removed accounts
                for a in &old.accounts {
                    if !cfg.accounts.iter().any(|b| b.id == a.id) {
                        for k in ["login", "keypass", "sudo"] {
                            secrets::delete(&a.key(k));
                        }
                    }
                }
                *old = cfg.clone();
                existed = true;
            } else {
                ss.push(cfg.clone());
                existed = false;
            }
        }
        self.drop_conn(cfg.id).await;
        self.prev.lock().unwrap().remove(&cfg.id);
        self.set_live(cfg.id, |l| {
            l.phase = "connecting".into();
            l.probed = None;
            l.docker_sudo = false;
            l.error.clear();
        });
        self.persist();
        self.emit_servers();
        self.say(if existed { format!("已更新「{}」，重新呼叫中。", cfg.title()) } else { format!("新舰船入列：{}。正在第一次呼叫…", cfg.title()) }, "info");
        self.start_loop(cfg.id);
    }

    pub async fn delete_server(&self, id: Uuid) {
        self.stop_loop(id);
        self.drop_conn(id).await;
        let removed = {
            let mut ss = self.servers.write().unwrap();
            let pos = ss.iter().position(|s| s.id == id);
            pos.map(|p| ss.remove(p))
        };
        if let Some(cfg) = removed {
            for a in &cfg.accounts {
                for k in ["login", "keypass", "sudo"] {
                    secrets::delete(&a.key(k));
                }
            }
            self.live.write().unwrap().remove(&id);
            self.persist();
            self.emit_servers();
            self.say(format!("「{}」已退出舰队（服务器本身没有任何改动）。", cfg.title()), "info");
        }
    }

    pub fn move_server(&self, id: Uuid, delta: i32) {
        {
            let mut ss = self.servers.write().unwrap();
            let Some(i) = ss.iter().position(|s| s.id == id) else { return };
            let j = (i as i32 + delta).clamp(0, ss.len() as i32 - 1) as usize;
            ss.swap(i, j);
        }
        self.persist();
        self.emit_servers();
    }

    fn set_paused(&self, id: Uuid, paused: bool) {
        let mut ss = self.servers.write().unwrap();
        if let Some(s) = ss.iter_mut().find(|s| s.id == id) {
            s.paused = paused;
        }
    }

    /// Actively hang up: stop polling and close the SSH connection. Remembered across launches.
    pub async fn disconnect(&self, id: Uuid, quiet: bool) {
        let Some(cfg) = self.server(id) else { return };
        self.stop_loop(id);
        self.set_paused(id, true);
        self.drop_conn(id).await;
        self.prev.lock().unwrap().remove(&id);
        self.set_live(id, |l| {
            l.phase = "parked".into();
            l.polling = false;
        });
        self.persist();
        self.emit_servers();
        if !quiet {
            self.say(format!("已主动断开「{}」：停止采集并关闭 SSH 连接，舰船停泊。", cfg.title()), "ok");
        }
    }

    pub fn connect(self: &Arc<Self>, id: Uuid, quiet: bool) {
        let Some(cfg) = self.server(id) else { return };
        self.set_paused(id, false);
        self.set_live(id, |l| l.phase = "connecting".into());
        self.persist();
        self.emit_servers();
        if !quiet {
            self.say(format!("正在重新呼叫「{}」…", cfg.title()), "info");
        }
        self.start_loop(id);
    }

    pub async fn disconnect_all(&self) {
        let ids: Vec<Uuid> = self.servers.read().unwrap().iter().filter(|s| !s.paused).map(|s| s.id).collect();
        if ids.is_empty() {
            self.say("全舰队都已经停泊了。", "refuse");
            return;
        }
        for id in &ids {
            self.disconnect(*id, true).await;
        }
        self.say(format!("全舰队 {} 艘已断开并停泊。", ids.len()), "ok");
    }

    pub fn connect_all(self: &Arc<Self>) {
        let ids: Vec<Uuid> = self.servers.read().unwrap().iter().filter(|s| s.paused).map(|s| s.id).collect();
        if ids.is_empty() {
            self.say("没有停泊的舰船。", "refuse");
            return;
        }
        for id in &ids {
            self.connect(*id, true);
        }
        self.say(format!("正在呼叫 {} 艘停泊的舰船…", ids.len()), "info");
    }

    pub async fn switch_account(self: &Arc<Self>, id: Uuid, account: Uuid) {
        let title = {
            let mut ss = self.servers.write().unwrap();
            let Some(s) = ss.iter_mut().find(|s| s.id == id) else { return };
            let Some(a) = s.accounts.iter().find(|a| a.id == account).cloned() else { return };
            s.active_account = Some(account);
            format!("{}（{}）", a.title(), a.privilege.role_name())
        };
        self.drop_conn(id).await;
        self.set_live(id, |l| {
            l.probed = None;
            l.docker_sudo = false;
        });
        self.persist();
        self.emit_servers();
        self.say(format!("换成 {title} 登舰，正在查验权限…"), "info");
        if self.server(id).map(|s| s.paused).unwrap_or(false) {
            self.connect(id, true);
        } else {
            self.start_loop(id);
        }
    }

    pub async fn set_sudo_password(&self, id: Uuid, account: Uuid, value: Option<String>) {
        let mut cfg = match self.server(id) { Some(c) => c, None => return };
        self.apply_secrets(&mut cfg, &[SecretInput { account_id: account, kind: "sudo".into(), value: value.clone() }]);
        {
            let mut ss = self.servers.write().unwrap();
            if let Some(s) = ss.iter_mut().find(|s| s.id == id) {
                *s = cfg.clone();
            }
        }
        self.persist();
        self.emit_servers();
        self.say(if value.is_some() { "sudo 密码已存进凭据管理器，正在验证…" } else { "已删除 sudo 密码。" }, "info");
        if cfg.active().map(|a| a.id) == Some(account) && !cfg.paused {
            self.set_live(id, |l| l.probed = None);
            self.probe(id).await;
        }
    }

    pub async fn test_connection(&self, cfg: ServerConfig, secrets_in: Vec<SecretInput>) -> Result<String, String> {
        let mut cfg = cfg;
        // Use typed-but-unsaved secrets for the test, without storing them.
        let mut ep = Self::endpoint(&cfg).or_else(|_| {
            let a = cfg.active().cloned().ok_or("没有账户")?;
            Ok::<Endpoint, String>(Endpoint { host: cfg.host.clone(), port: cfg.port, user: a.user.clone(), auth: Auth::Key { path: None, pass: None } })
        })?;
        if let Some(a) = cfg.active().cloned() {
            for s in &secrets_in {
                if s.account_id != a.id { continue; }
                if let Some(v) = &s.value {
                    match s.kind.as_str() {
                        "login" if a.auth == "password" => ep.auth = Auth::Password(v.clone()),
                        "keypass" if a.auth != "password" => {
                            ep.auth = Auth::Key { path: if a.key_path.is_empty() { None } else { Some(a.key_path.clone()) }, pass: Some(v.clone()) }
                        }
                        _ => {}
                    }
                }
            }
        }
        cfg.host = cfg.host.trim().into();
        let c = Conn::connect(&ep, self.known.clone()).await.map_err(|e| e.to_string())?;
        let o = c
            .exec(r#"uname -sr; hostname; id -un; if [ "$(id -u)" -eq 0 ]; then echo '舰长 (root)'; elif sudo -n true 2>/dev/null; then echo '舰长 (免密 sudo)'; else echo '领航员或需要 sudo 密码'; fi"#, None, Duration::from_secs(15))
            .await
            .map_err(|e| e.to_string())?;
        c.close().await;
        Ok(String::from_utf8_lossy(&o.out).lines().collect::<Vec<_>>().join(" · "))
    }
}
