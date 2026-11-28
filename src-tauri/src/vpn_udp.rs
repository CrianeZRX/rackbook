//! Relay tun2proxy's UDPGW frames through the desktop SOCKS5 proxy.
//! The only UDP destination opened by Rackbook is the loopback SOCKS5 relay.
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{self, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use tokio::sync::mpsc;
use tokio::task::JoinSet;

pub(crate) const GATEWAY: &str = "192.0.2.250:7300";
const SOCKS5: u8 = 5;
const DATA: u8 = 2;
const KEEPALIVE: u8 = 1;
const CLOSE: u8 = 4;
const ERROR: u8 = 0x20;
const MAX_FLOWS: usize = 32;
const MAX_FRAME: usize = 8192;

fn invalid() -> io::Error { io::ErrorKind::InvalidData.into() }

fn address_size(address: &[u8]) -> Option<usize> {
    let size = match address.first()? {
        1 => 7,
        4 => 19,
        3 => 4 + usize::from(*address.get(1)?),
        _ => return None,
    };
    (address.len() >= size).then_some(size)
}

async fn associate(port: u16) -> io::Result<(TcpStream, UdpSocket)> {
    let mut control = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await?;
    control.write_all(&[SOCKS5, 1, 0]).await?;
    let mut method = [0; 2];
    control.read_exact(&mut method).await?;
    if method != [SOCKS5, 0] { return Err(invalid()); }

    let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    // Ask the proxy to associate datagrams from this socket.
    let mut request = vec![SOCKS5, 3, 0, 1, 127, 0, 0, 1];
    request.extend_from_slice(&socket.local_addr()?.port().to_be_bytes());
    control.write_all(&request).await?;
    let mut response = [0; 4];
    control.read_exact(&mut response).await?;
    if response != [SOCKS5, 0, 0, 1] { return Err(invalid()); }
    let mut address = [0; 6];
    control.read_exact(&mut address).await?;
    let ip = Ipv4Addr::new(address[0], address[1], address[2], address[3]);
    let relay_port = u16::from_be_bytes([address[4], address[5]]);
    if !(ip.is_loopback() || ip.is_unspecified()) || relay_port == 0 { return Err(invalid()); }
    let relay_ip = if ip.is_unspecified() { Ipv4Addr::LOCALHOST } else { ip };
    socket.connect(SocketAddr::from((relay_ip, relay_port))).await?;
    Ok((control, socket))
}

async fn connect(port: u16) -> io::Result<(TcpStream, UdpSocket)> {
    tokio::time::timeout(Duration::from_secs(4), associate(port))
        .await.map_err(|_| io::ErrorKind::TimedOut)?
}

pub(crate) async fn supported(port: u16) -> bool {
    connect(port).await.is_ok()
}

fn encode(flag: u8, id: u16, data: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(data.len() + 5);
    frame.extend_from_slice(&((data.len() + 3) as u16).to_be_bytes());
    frame.push(flag);
    frame.extend_from_slice(&id.to_be_bytes());
    frame.extend_from_slice(data);
    frame
}

struct Flow {
    socket: Arc<UdpSocket>,
    destination: Vec<u8>,
    receive: tokio::task::AbortHandle,
}

impl Drop for Flow {
    fn drop(&mut self) { self.receive.abort(); }
}

async fn receive_datagrams(
    socket: Arc<UdpSocket>,
    mut control: TcpStream,
    id: u16,
    destination: Vec<u8>,
    events: mpsc::Sender<Vec<u8>>,
) {
    let mut buffer = vec![0; MAX_FRAME];
    let mut eof = [0];
    loop {
        let n = tokio::select! {
            _ = control.read(&mut eof) => break,
            result = tokio::time::timeout(Duration::from_secs(90), socket.recv(&mut buffer)) => {
                match result { Ok(Ok(len)) => len, _ => break }
            }
        };
        let Some(body) = buffer[..n].strip_prefix(&[0, 0, 0]) else { continue };
        let Some(size) = address_size(body) else { continue };
        // Responses belong to the flow that requested the destination.
        let mut data = destination.clone();
        data.extend_from_slice(&body[size..]);
        if data.len() + 3 <= MAX_FRAME {
            let _ = events.try_send(encode(DATA, id, &data));
        }
    }
}

async fn read_gateway(
    mut incoming: impl AsyncRead + Unpin,
    events: mpsc::Sender<Vec<u8>>,
    port: u16,
) -> io::Result<()> {
    let mut flows: HashMap<u16, Flow> = HashMap::new();
    let mut receivers = JoinSet::new();
    loop {
        let len = incoming.read_u16().await? as usize;
        if !(3..=MAX_FRAME).contains(&len) { return Err(invalid()); }
        let mut frame = vec![0; len];
        incoming.read_exact(&mut frame).await?;
        let id = u16::from_be_bytes([frame[1], frame[2]]);
        while receivers.try_join_next().is_some() {}
        flows.retain(|_, flow| !flow.receive.is_finished());
        match frame[0] {
            KEEPALIVE => { let _ = events.try_send(encode(KEEPALIVE, id, &[])); continue; }
            CLOSE => { flows.remove(&id); continue; }
            DATA => {}
            _ => return Err(invalid()),
        }
        let datagram = &frame[3..];
        let n = address_size(datagram).ok_or_else(invalid)?;
        let address = &datagram[..n];
        if flows.get(&id).is_some_and(|flow| flow.destination != address) { flows.remove(&id); }
        if !flows.contains_key(&id) {
            if flows.len() >= MAX_FLOWS {
                let _ = events.try_send(encode(ERROR, id, &[]));
                continue;
            }
            let Ok((control, socket)) = connect(port).await else {
                let _ = events.try_send(encode(ERROR, id, &[]));
                continue;
            };
            let socket = Arc::new(socket);
            let receive = receivers.spawn(receive_datagrams(
                socket.clone(), control, id, address.to_vec(), events.clone(),
            ));
            flows.insert(id, Flow { socket, destination: address.to_vec(), receive });
        }
        let mut message = vec![0, 0, 0];
        message.extend_from_slice(datagram);
        if flows[&id].socket.send(&message).await.is_err() {
            flows.remove(&id);
            let _ = events.try_send(encode(ERROR, id, &[]));
        }
    }
}

pub(crate) async fn serve(stream: &mut (impl AsyncRead + AsyncWrite + Unpin), port: u16) -> io::Result<()> {
    let (incoming, mut outgoing) = tokio::io::split(stream);
    let (send, mut receive) = mpsc::channel::<Vec<u8>>(64);
    let send_replies = async {
        while let Some(frame) = receive.recv().await { outgoing.write_all(&frame).await?; }
        Ok(())
    };
    tokio::select! {
        result = read_gateway(incoming, send, port) => result,
        result = send_replies => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_addresses_and_big_endian_datagram_frames() {
        assert_eq!(address_size(&[1, 1, 1, 1, 1, 0, 53]), Some(7));
        assert_eq!(address_size(&[4, 1, 1]), None);
        assert_eq!(address_size(&[3, 2, b'o', b'k', 0, 53]), Some(6));
        assert_eq!(encode(CLOSE, 0x2345, &[]), [0, 3, 4, 0x23, 0x45]);
    }
}
