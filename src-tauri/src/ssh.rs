//! SSH connections built on russh: one long-lived authenticated connection per ship,
//! every command is a new channel on it (the Windows equivalent of the macOS ControlMaster).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, bail, Result};
use russh::client::{self, ChannelOpenHandle, KeyboardInteractiveAuthResponse};
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{Channel, ChannelMsg, Disconnect};

use crate::vpn_proxy::{self, ProxyRelay, ProxyStatus};
use crate::{vpn_session, vpn_udp};

type ProxyRelays = Arc<Mutex<HashMap<u16, Arc<ProxyRelay>>>>;
type SessionRelay = Arc<Mutex<Option<(String, Arc<ProxyRelay>)>>>;

/// Trust-on-first-use store of host key fingerprints, keyed by "host:port".
pub struct KnownHosts {
    path: PathBuf,
    map: Mutex<HashMap<String, String>>,
}

impl KnownHosts {
    pub fn load(path: PathBuf) -> Self {
        let map = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        KnownHosts { path, map: Mutex::new(map) }
    }
    fn check(&self, host: &str, fp: &str) -> Result<(), String> {
        let mut m = self.map.lock().unwrap();
        match m.get(host) {
            Some(known) if known == fp => Ok(()),
            Some(known) => Err(known.clone()),
            None => {
                m.insert(host.to_string(), fp.to_string());
                if let Ok(b) = serde_json::to_vec_pretty(&*m) {
                    let _ = std::fs::write(&self.path, b);
                }
                Ok(())
            }
        }
    }
    pub fn forget(&self, host: &str) {
        let mut m = self.map.lock().unwrap();
        m.remove(host);
        if let Ok(b) = serde_json::to_vec_pretty(&*m) {
            let _ = std::fs::write(&self.path, b);
        }
    }
}

struct Client {
    known: Arc<KnownHosts>,
    host: String,
    mismatch: Arc<Mutex<Option<String>>>,
    proxies: ProxyRelays,
    session_relay: SessionRelay,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let fp = match key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.fingerprint(HashAlg::Sha256).to_string(),
            PublicKeyOrCertificate::Certificate(c) => c.public_key().fingerprint(HashAlg::Sha256).to_string(),
        };
        match self.known.check(&self.host, &fp) {
            Ok(()) => Ok(true),
            Err(old) => {
                *self.mismatch.lock().unwrap() = Some(format!("之前记录的是 {old}，现在是 {fp}"));
                Ok(false)
            }
        }
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<client::Msg>,
        connected_address: &str,
        connected_port: u32,
        originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if connected_address != "127.0.0.1" || originator_address != "127.0.0.1" {
            return Ok(());
        }
        let relay = u16::try_from(connected_port).ok()
            .and_then(|port| self.proxies.lock().unwrap().get(&port).cloned());
        if let Some(relay) = relay {
            reply.accept().await;
            tokio::spawn(async move { relay.serve(channel.into_stream()).await });
        }
        Ok(())
    }

    async fn server_channel_open_forwarded_streamlocal(
        &mut self,
        channel: Channel<client::Msg>,
        socket_path: &str,
        reply: ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let relay = self.session_relay.lock().unwrap().as_ref()
            .filter(|(path, _)| path == socket_path)
            .map(|(_, relay)| relay.clone());
        if let Some(relay) = relay {
            reply.accept().await;
            tokio::spawn(async move { relay.serve(channel.into_stream()).await });
        }
        Ok(())
    }
}

pub enum Auth {
    /// key file (None = try ~/.ssh/id_ed25519, id_ecdsa, id_rsa) and its passphrase
    Key { path: Option<String>, pass: Option<String> },
    Password(String),
}

pub struct Endpoint {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: Auth,
}

pub struct ExecOut {
    pub out: Vec<u8>,
    pub err: Vec<u8>,
    pub code: i32,
}

pub struct Conn {
    handle: client::Handle<Client>,
    target: (String, u16, String),
    proxies: ProxyRelays,
    proxy_update: tokio::sync::Mutex<()>,
    session_relay: SessionRelay,
    session_update: tokio::sync::Mutex<()>,
}

impl Drop for Conn {
    fn drop(&mut self) {
        self.stop_proxies();
    }
}

fn default_keys() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else { return vec![] };
    ["id_ed25519", "id_ecdsa", "id_rsa"]
        .iter()
        .map(|n| home.join(".ssh").join(n))
        .filter(|p| p.exists())
        .collect()
}

fn expand(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
        if let Some(h) = dirs::home_dir() {
            return h.join(rest);
        }
    }
    PathBuf::from(p)
}

pub fn friendly(e: &str) -> String {
    let l = e.to_lowercase();
    if l.contains("refused") { return "连接被拒（端口对吗？sshd 在运行吗？）".into(); }
    if l.contains("timed out") || l.contains("timeout") { return "连接超时".into(); }
    if l.contains("no such host") || l.contains("failed to lookup") || l.contains("not known") || l.contains("resolve") {
        return "主机名解析不了".into();
    }
    if l.contains("unreachable") { return "网络不可达".into(); }
    if l.contains("unknownkey") || l.contains("unknown key") { return "主机指纹对不上".into(); }
    e.to_string()
}

impl Conn {
    pub async fn connect(ep: &Endpoint, known: Arc<KnownHosts>) -> Result<Conn> {
        let config = Arc::new(client::Config {
            inactivity_timeout: None,
            keepalive_interval: Some(Duration::from_secs(15)),
            keepalive_max: 3,
            nodelay: true,
            ..Default::default()
        });
        let mismatch = Arc::new(Mutex::new(None));
        let hostkey = format!("{}:{}", ep.host, ep.port);
        let proxies = ProxyRelays::default();
        let session_relay = SessionRelay::default();
        let handler = Client { known, host: hostkey, mismatch: mismatch.clone(), proxies: proxies.clone(), session_relay: session_relay.clone() };
        let connecting = client::connect(config, (ep.host.as_str(), ep.port), handler);
        let mut handle = match tokio::time::timeout(Duration::from_secs(12), connecting).await {
            Err(_) => bail!("连接超时"),
            Ok(Err(e)) => {
                if let Some(m) = mismatch.lock().unwrap().clone() {
                    bail!("主机指纹变了，可能被冒充（{m}）。确认无误后可在编辑页「忘记指纹」");
                }
                bail!(friendly(&e.to_string()))
            }
            Ok(Ok(h)) => h,
        };

        let ok = match &ep.auth {
            Auth::Password(pw) => {
                let r = handle.authenticate_password(ep.user.clone(), pw.clone()).await?;
                if r.success() {
                    true
                } else {
                    // Many servers only offer keyboard-interactive for passwords.
                    let mut resp = handle.authenticate_keyboard_interactive_start(ep.user.clone(), None).await?;
                    let mut ok = false;
                    for _ in 0..4 {
                        match resp {
                            KeyboardInteractiveAuthResponse::Success => { ok = true; break; }
                            KeyboardInteractiveAuthResponse::Failure { .. } => break,
                            KeyboardInteractiveAuthResponse::InfoRequest { ref prompts, .. } => {
                                let answers = prompts.iter().map(|_| pw.clone()).collect();
                                resp = handle.authenticate_keyboard_interactive_respond(answers).await?;
                            }
                        }
                    }
                    ok
                }
            }
            Auth::Key { path, pass } => {
                let candidates: Vec<PathBuf> = match path {
                    Some(p) if !p.trim().is_empty() => vec![expand(p.trim())],
                    _ => default_keys(),
                };
                if candidates.is_empty() {
                    bail!("没有找到私钥：在 C:\\Users\\你\\.ssh 下放 id_ed25519 / id_rsa，或在编辑页指定私钥文件");
                }
                let mut ok = false;
                let mut last_err = String::new();
                for p in candidates {
                    let key = match load_secret_key(&p, pass.as_deref()) {
                        Ok(k) => k,
                        Err(e) => {
                            let s = e.to_string();
                            last_err = if s.to_lowercase().contains("encrypted") || s.to_lowercase().contains("passphrase") {
                                format!("私钥 {} 有口令保护，请在编辑页填写私钥口令", p.display())
                            } else {
                                format!("读不了私钥 {}：{s}", p.display())
                            };
                            continue;
                        }
                    };
                    let hash = handle.best_supported_rsa_hash().await.ok().flatten().flatten();
                    let r = handle
                        .authenticate_publickey(ep.user.clone(), PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                        .await?;
                    if r.success() { ok = true; break; }
                    last_err = "公钥被拒（把公钥加入服务器的 authorized_keys）".into();
                }
                if !ok && !last_err.is_empty() { bail!(last_err) }
                ok
            }
        };
        if !ok {
            bail!(match ep.auth {
                Auth::Password(_) => "密码被拒（密码不对，或服务器关闭了密码登录）",
                Auth::Key { .. } => "认证被拒（检查用户名和私钥）",
            })
        }
        Ok(Conn {
            handle,
            target: (ep.host.clone(), ep.port, ep.user.clone()),
            proxies,
            proxy_update: tokio::sync::Mutex::new(()),
            session_relay,
            session_update: tokio::sync::Mutex::new(()),
        })
    }

    pub fn alive(&self) -> bool {
        !self.handle.is_closed()
    }

    pub(crate) fn matches_target(&self, host: &str, port: u16, user: &str) -> bool {
        self.target.0 == host && self.target.1 == port && self.target.2 == user
    }

    pub(crate) fn proxy_matches(&self, local_port: u16, url: &str) -> bool {
        self.alive() && self.proxies.lock().unwrap().values().any(|relay|
            relay.local_port == local_port && relay.url() == url)
    }

    fn stop_proxies(&self) {
        for (_, relay) in self.proxies.lock().unwrap().drain() {
            relay.stop();
        }
        if let Some((_, relay)) = self.session_relay.lock().unwrap().take() {
            relay.stop();
        }
    }

    async fn end_session_relay(&self) {
        let active = self.session_relay.lock().unwrap().take();
        if let Some((path, relay)) = active {
            relay.stop();
            let _ = tokio::time::timeout(Duration::from_secs(3), self.handle.cancel_streamlocal_forward(path)).await;
        }
    }

    async fn vpn_exec(&self, cmd: &str, script: Option<&str>, timeout: u64) -> Result<String, String> {
        let out = self.exec(cmd, script.map(str::as_bytes), Duration::from_secs(timeout)).await.map_err(|e| e.to_string())?;
        if out.code != 0 {
            return Err(String::from_utf8_lossy(&out.err).lines().last()
                .filter(|line| !line.is_empty() && line.len() < 220)
                .unwrap_or("服务器端代理会话操作失败").to_owned());
        }
        Ok(String::from_utf8_lossy(&out.out).trim().to_owned())
    }

    pub(crate) async fn ensure_vpn_session(&self) -> Result<String, String> {
        let _update = self.session_update.lock().await;
        let status = vpn_proxy::read_status(self).await?;
        if status.local_port == 0 {
            return Err("请先在「船员 · 权限」中设置本机 HTTP / Mixed 代理端口".into());
        }
        let reusable = self.session_relay.lock().unwrap().as_ref()
            .is_some_and(|(_, relay)| relay.local_port == status.local_port);
        if reusable && self.vpn_exec(&vpn_session::command("status"), None, 5).await
            .is_ok_and(|out| out == r#"{"active": true}"#) {
            return Ok(vpn_session::command("shell"));
        }
        if !vpn_udp::supported(status.local_port).await {
            return Err("代理终端需要本机 Mixed 端口同时支持 HTTP 和 SOCKS5 UDP（UDP ASSOCIATE 握手失败）".into());
        }
        self.end_session_relay().await;
        let socket = self.vpn_exec(&vpn_session::install_command(), Some(vpn_session::SCRIPT), 15).await?;
        if !socket.starts_with('/') || !socket.ends_with("/vpn-session/s") || socket.contains('\n') {
            return Err("服务器返回了无效的代理会话套接字路径".into());
        }
        let tunnel = self.handle.streamlocal_forward(socket.clone());
        if !matches!(tokio::time::timeout(Duration::from_secs(8), tunnel).await, Ok(Ok(()))) {
            return Err("无法建立 SSH 私有套接字转发，请检查服务器是否允许 StreamLocal 转发".into());
        }
        *self.session_relay.lock().unwrap() = Some((socket, ProxyRelay::private_session(status.local_port)));
        let start = format!("start {}", uuid::Uuid::new_v4().simple());
        if let Err(error) = self.vpn_exec(&vpn_session::command(&start), None, 110).await {
            self.end_session_relay().await;
            return Err(error);
        }
        Ok(vpn_session::command("shell"))
    }

    pub(crate) async fn stop_vpn_session(&self) -> Result<(), String> {
        let _update = self.session_update.lock().await;
        self.vpn_exec(&vpn_session::command("stop"), None, 10).await?;
        self.end_session_relay().await;
        Ok(())
    }

    async fn retire_proxy(&self, port: u16) {
        if let Some(relay) = self.proxies.lock().unwrap().remove(&port) {
            relay.stop();
        }
        let _ = tokio::time::timeout(Duration::from_secs(3),
            self.handle.cancel_tcpip_forward("127.0.0.1", u32::from(port))).await;
    }

    pub(crate) async fn update_user_proxy(&self, local_port: u16, tools: u8) -> Result<ProxyStatus, String> {
        let _update = self.proxy_update.lock().await;
        let old = self.proxies.lock().unwrap().values().next().cloned();
        let mut started = None;
        let relay = if tools == 0 {
            None
        } else if let Some(relay) = old.as_ref().filter(|relay| relay.local_port == local_port) {
            Some(relay.clone())
        } else {
            let upstream = tokio::net::TcpStream::connect(("127.0.0.1", local_port));
            if !matches!(tokio::time::timeout(Duration::from_secs(3), upstream).await, Ok(Ok(_))) {
                return Err(format!("本机 127.0.0.1:{local_port} 无法连接，请确认 VPN 的 HTTP / Mixed 代理端口"));
            }
            let request = self.handle.tcpip_forward("127.0.0.1", 0);
            let remote_port = match tokio::time::timeout(Duration::from_secs(8), request).await {
                Ok(Ok(port)) if port > 0 && port <= u16::MAX.into() => port as u16,
                Ok(_) => return Err("服务器拒绝 SSH 远程端口转发，请检查 SSH 账户的转发权限".into()),
                Err(_) => return Err("请求 SSH 远程端口转发超时".into()),
            };
            let relay = ProxyRelay::new(local_port, remote_port);
            self.proxies.lock().unwrap().insert(remote_port, relay.clone());
            started = Some(remote_port);
            Some(relay)
        };
        let url = relay.as_ref().map(|relay| relay.url()).unwrap_or_default();
        let script = vpn_proxy::install_script(local_port, tools, &url);
        let install = self.exec("python3 -", Some(script.as_bytes()), Duration::from_secs(12)).await;
        match install {
            Ok(out) if out.code == 0 => {}
            result => {
                if let Some(port) = started { self.retire_proxy(port).await; }
                return Err(match result {
                    Ok(out) if out.code == 127 => "服务器需要 python3 来更新当前用户的工具配置".into(),
                    Ok(out) => String::from_utf8_lossy(&out.err).lines().last()
                        .filter(|line| !line.is_empty() && line.len() < 220)
                        .unwrap_or("无法写入当前用户的代理配置").to_owned(),
                    Err(error) => format!("保存当前用户的代理设置失败（{error}）"),
                });
            }
        }
        if let Some(old) = old {
            if relay.as_ref().is_none_or(|relay| relay.remote_port != old.remote_port) {
                self.retire_proxy(old.remote_port).await;
            }
        }
        Ok(ProxyStatus { local_port, tools, connected: relay.is_some() && self.alive() })
    }

    pub async fn exec(&self, cmd: &str, stdin: Option<&[u8]>, timeout: Duration) -> Result<ExecOut> {
        let run = async {
            let mut ch = self.handle.channel_open_session().await?;
            ch.exec(true, cmd).await?;
            if let Some(data) = stdin {
                ch.data(data).await?;
            }
            ch.eof().await?;
            let mut out = Vec::new();
            let mut err = Vec::new();
            let mut code: Option<u32> = None;
            while let Some(msg) = ch.wait().await {
                match msg {
                    ChannelMsg::Data { ref data } => out.extend_from_slice(data),
                    ChannelMsg::ExtendedData { ref data, .. } => err.extend_from_slice(data),
                    ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status),
                    ChannelMsg::ExitSignal { .. } => code = code.or(Some(255)),
                    _ => {}
                }
            }
            Ok::<ExecOut, anyhow::Error>(ExecOut { out, err, code: code.map(|c| c as i32).unwrap_or(-1) })
        };
        match tokio::time::timeout(timeout, run).await {
            Ok(r) => r,
            Err(_) => Err(anyhow!("超时（{} 秒）", timeout.as_secs())),
        }
    }

    /// An interactive login shell or command on a pseudo-terminal, for the embedded terminal.
    /// The read half streams the shell's output; the write half takes keystrokes and window resizes.
    pub async fn shell(&self, cols: u32, rows: u32, cmd: Option<&str>, auth: Option<(&str, &str, &str)>) -> Result<(russh::ChannelReadHalf, russh::ChannelWriteHalf<client::Msg>)> {
        let mut ch = self.handle.channel_open_session().await?;
        // ask for colour and UTF-8 the way a desktop terminal would
        let _ = ch.set_env(false, "LANG", "C.UTF-8").await;
        let _ = ch.set_env(false, "COLORTERM", "truecolor").await;
        ch.request_pty(false, "xterm-256color", cols.max(20), rows.max(5), 0, 0, &[]).await?;
        if let Some(cmd) = cmd { ch.exec(true, cmd).await?; }
        else { ch.request_shell(false).await?; }
        if let Some((prompt, ready, password)) = auth {
            let authenticate = async {
                let mut sent = false;
                let mut tail = Vec::new();
                while let Some(msg) = ch.wait().await {
                    match msg {
                        ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                            tail.extend_from_slice(&data);
                            if tail.windows(ready.len()).any(|part| part == ready.as_bytes()) {
                                return Ok::<(), anyhow::Error>(());
                            }
                            if tail.windows(prompt.len()).any(|part| part == prompt.as_bytes()) {
                                if sent { break; }
                                ch.data(format!("{password}\n").as_bytes()).await?;
                                sent = true;
                                tail.clear();
                            }
                            let extra = tail.len().saturating_sub(prompt.len().max(ready.len()));
                            tail.drain(..extra);
                        }
                        ChannelMsg::ExitStatus { .. } | ChannelMsg::Close | ChannelMsg::Eof => break,
                        _ => {}
                    }
                }
                Err(anyhow!("Docker 终端的 sudo 验证失败"))
            };
            match tokio::time::timeout(Duration::from_secs(15), authenticate).await {
                Ok(Ok(())) => {}
                error => {
                    let _ = ch.eof().await;
                    let _ = ch.close().await;
                    return Err(error.err().map(|_| anyhow!("Docker 终端的 sudo 验证超时"))
                        .unwrap_or_else(|| anyhow!("Docker 终端的 sudo 验证失败")));
                }
            }
        }
        Ok(ch.split())
    }

    pub async fn close(&self) {
        self.stop_proxies();
        let _ = self.handle.disconnect(Disconnect::ByApplication, "bye", "en").await;
    }
}
