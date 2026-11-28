use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tokio::io::{self, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{watch, Semaphore};
use uuid::Uuid;

use crate::vpn_udp;

pub(crate) const ALL_TOOLS: u8 = 7;
const MAX_HEADERS: usize = 32 * 1024;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProxyStatus {
    pub local_port: u16,
    pub tools: u8,
    pub connected: bool,
}

const READ_PROFILE: &str = r#"sh -c 'f="$HOME/.config/rackbook/vpn-proxy/profile"
if [ -f "$f" ]; then cat "$f"; fi'"#;

impl ProxyStatus {
    pub fn parse(output: &str) -> (Self, &str) {
        let mut lines = output.lines();
        let mut fields = lines.next().unwrap_or_default().split_whitespace();
        let local_port = fields.next().and_then(|value| value.parse().ok()).unwrap_or(0);
        let tools = fields.next().and_then(|value| value.parse().ok()).filter(|&n| n <= ALL_TOOLS).unwrap_or(0);
        let url = lines.next().unwrap_or_default();
        (Self { local_port, tools, connected: false }, url)
    }
}

pub(crate) async fn read_status(connection: &crate::ssh::Conn) -> Result<ProxyStatus, String> {
    let out = connection.exec(READ_PROFILE, None, Duration::from_secs(10)).await.map_err(|e| e.to_string())?;
    if out.code != 0 {
        return Err("读取当前用户的代理设置失败".into());
    }
    let text = String::from_utf8_lossy(&out.out);
    let (mut status, url) = ProxyStatus::parse(&text);
    status.connected = status.tools != 0 && connection.proxy_matches(status.local_port, url);
    Ok(status)
}

pub(crate) fn install_script(local_port: u16, tools: u8, url: &str) -> String {
    let script = include_str!("vpn_profile.py");
    format!("local_port = {local_port}\ntools = {tools}\nproxy_url = {url:?}\n{script}")
}

pub(crate) struct ProxyRelay {
    pub local_port: u16,
    pub remote_port: u16,
    token: String,
    authorization: Option<String>,
    stop: watch::Sender<bool>,
    slots: Semaphore,
}

impl ProxyRelay {
    pub fn new(local_port: u16, remote_port: u16) -> Arc<Self> {
        let token = Uuid::new_v4().simple().to_string();
        let authorization = STANDARD.encode(format!("rackbook:{token}"));
        Arc::new(Self {
            local_port, remote_port, token, authorization: Some(authorization),
            stop: watch::channel(false).0, slots: Semaphore::new(32),
        })
    }

    /// An SSH Unix socket within the current user's private directory supplies access control.
    pub(crate) fn private_session(local_port: u16) -> Arc<Self> {
        Arc::new(Self {
            local_port, remote_port: 0, token: String::new(), authorization: None,
            stop: watch::channel(false).0, slots: Semaphore::new(96),
        })
    }

    pub fn url(&self) -> String {
        format!("http://rackbook:{}@127.0.0.1:{}", self.token, self.remote_port)
    }

    pub fn stop(&self) {
        self.stop.send_replace(true);
    }

    pub async fn serve(&self, mut remote: impl AsyncRead + AsyncWrite + Unpin) {
        let Ok(_permit) = self.slots.try_acquire() else { return };
        let mut stop = self.stop.subscribe();
        if *stop.borrow() { return; }
        tokio::select! {
            _ = stop.changed() => {}
            _ = self.relay(&mut remote) => {}
        }
        let _ = remote.shutdown().await;
    }

    async fn relay(&self, remote: &mut (impl AsyncRead + AsyncWrite + Unpin)) -> io::Result<()> {
        let Ok(Ok(request)) = tokio::time::timeout(Duration::from_secs(10), read_request(remote)).await else {
            return Ok(());
        };
        let Some(header) = authorize(&request, self.authorization.as_deref()) else {
            return remote.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Rackbook\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
        };
        if self.authorization.is_none() && header.split(|&c| c == b'\n').next()
            .and_then(|line| std::str::from_utf8(line).ok())
            .and_then(|line| line.strip_prefix("CONNECT "))
            .and_then(|line| line.split_ascii_whitespace().next()) == Some(vpn_udp::GATEWAY) {
            remote.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await?;
            return vpn_udp::serve(remote, self.local_port).await;
        }
        let upstream = TcpStream::connect(("127.0.0.1", self.local_port));
        let Ok(Ok(mut upstream)) = tokio::time::timeout(Duration::from_secs(5), upstream).await else {
            return remote.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
        };
        upstream.write_all(&header).await?;
        io::copy_bidirectional(remote, &mut upstream).await?;
        Ok(())
    }
}

async fn read_request(remote: &mut (impl AsyncRead + Unpin)) -> io::Result<Vec<u8>> {
    let mut request = Vec::new();
    let mut chunk = [0; 2048];
    while request.len() < MAX_HEADERS {
        let count = remote.read(&mut chunk).await?;
        if count == 0 { break; }
        let from = request.len().saturating_sub(3);
        request.extend_from_slice(&chunk[..count]);
        if request[from..].windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            return Ok(request);
        }
    }
    Err(io::Error::new(io::ErrorKind::InvalidData, "Incomplete proxy request"))
}

fn authorize(request: &[u8], secret: Option<&str>) -> Option<Vec<u8>> {
    let end = request.windows(4).position(|bytes| bytes == b"\r\n\r\n")?;
    let mut headers = std::str::from_utf8(request.get(..end)?).ok()?.split("\r\n");
    let line = headers.next()?;
    let mut fields = line.split_ascii_whitespace();
    let method = fields.next()?;
    let target = fields.next()?;
    if !fields.next()?.starts_with("HTTP/1.") || fields.next().is_some() { return None; }
    let connect = method == "CONNECT";
    if !connect && !target.starts_with("http://") { return None; }

    let mut authorized = secret.is_none();
    let mut clean = format!("{line}\r\n");
    for line in headers {
        let (name, value) = line.split_once(':')?;
        if name.eq_ignore_ascii_case("proxy-authorization") {
            if let Some(secret) = secret {
                let mut credential = value.split_ascii_whitespace();
                authorized = credential.next()?.eq_ignore_ascii_case("basic") &&
                    credential.next()? == secret && credential.next().is_none();
            }
        } else if connect || !["connection", "proxy-connection"].iter().any(|key| name.eq_ignore_ascii_case(key)) {
            clean.push_str(line);
            clean.push_str("\r\n");
        }
    }
    if !authorized { return None; }
    if !connect { clean.push_str("Connection: close\r\nProxy-Connection: close\r\n"); }
    clean.push_str("\r\n");
    let mut bytes = clean.into_bytes();
    bytes.extend_from_slice(&request[end + 4..]);
    Some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_proxy_credentials_at_the_ssh_relay() {
        let request = b"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: Basic a1b2\r\n\r\nremaining";
        assert!(authorize(request, Some("different")).is_none());
        let forwarded = b"CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\nremaining";
        assert_eq!(authorize(request, Some("a1b2")).unwrap(), forwarded);
        assert_eq!(authorize(request, None).unwrap(), forwarded);
        assert!(authorize(b"GET / HTTP/1.1\r\nProxy-Authorization: Basic a1b2\r\n\r\n", Some("a1b2")).is_none());
    }

    #[tokio::test]
    #[ignore = "requires permission to bind loopback sockets"]
    async fn private_tunnel_round_trips_udp_through_socks() {
        use tokio::net::{TcpListener, UdpSocket};
        let socks = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = socks.local_addr().unwrap().port();
        let upstream = tokio::spawn(async move {
            let (mut control, _) = socks.accept().await.unwrap();
            let mut greeting = [0; 3];
            control.read_exact(&mut greeting).await.unwrap();
            assert_eq!(greeting, [5, 1, 0]);
            control.write_all(&[5, 0]).await.unwrap();
            let mut associate = [0; 10];
            control.read_exact(&mut associate).await.unwrap();
            assert_eq!(&associate[..4], &[5, 3, 0, 1]);
            let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
            let [high, low] = socket.local_addr().unwrap().port().to_be_bytes();
            control.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, high, low]).await.unwrap();
            let mut data = [0; 64];
            let (n, source) = socket.recv_from(&mut data).await.unwrap();
            assert_eq!(&data[..n], &[0, 0, 0, 1, 1, 1, 1, 1, 0, 53, 10, 20]);
            socket.send_to(&[0, 0, 0, 1, 1, 1, 1, 1, 0, 53, 20, 10], source).await.unwrap();
            let mut eof = [0];
            assert_eq!(control.read(&mut eof).await.unwrap(), 0);
        });
        let (mut client, server) = tokio::io::duplex(1024);
        tokio::spawn(async move { ProxyRelay::private_session(port).serve(server).await });
        let exchange = async {
            client.write_all(format!("CONNECT {} HTTP/1.1\r\n\r\n", vpn_udp::GATEWAY).as_bytes()).await.unwrap();
            let headers = b"HTTP/1.1 200 Connection established\r\n\r\n";
            let mut reply = vec![0; headers.len()];
            client.read_exact(&mut reply).await.unwrap();
            assert_eq!(reply, headers);
            client.write_all(&[0, 12, 2, 0, 9, 1, 1, 1, 1, 1, 0, 53, 10, 20]).await.unwrap();
            let mut frame = [0; 14];
            client.read_exact(&mut frame).await.unwrap();
            assert_eq!(frame, [0, 12, 2, 0, 9, 1, 1, 1, 1, 1, 0, 53, 20, 10]);
            drop(client);
            upstream.await.unwrap();
        };
        tokio::time::timeout(Duration::from_secs(5), exchange).await.unwrap();
    }
}
