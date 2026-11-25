//! End-to-end test against a local sshd on 127.0.0.1:2222 (see README "开发").
//! Run with: cargo test --test live -- --ignored --nocapture

use std::sync::{Arc, Mutex};
use rackbook_lib::model::*;
use rackbook_lib::store::{SecretInput, Store};

fn store() -> (Arc<Store>, Arc<Mutex<Vec<String>>>) {
    let log = Arc::new(Mutex::new(vec![]));
    let l2 = log.clone();
    let dir = std::env::temp_dir().join(format!("rackbook-test-{}", uuid::Uuid::new_v4()));
    let s = Store::new(dir, Arc::new(move |ev: &str, v: serde_json::Value| {
        if ev == "status" { l2.lock().unwrap().push(v["text"].as_str().unwrap_or("").to_string()); }
    }));
    (s, log)
}

fn server(user: &str, auth: &str) -> ServerConfig {
    let mut c = ServerConfig::default();
    c.name = format!("test-{user}");
    c.host = "127.0.0.1".into();
    c.port = 2222;
    c.accounts[0].user = user.into();
    c.accounts[0].auth = auth.into();
    c
}

#[tokio::test]
#[ignore]
async fn end_to_end() {
    let (st, log) = store();

    // 1. root with the default key (~/.ssh/id_ed25519): captain (root)
    let root = server("root", "key");
    let id = root.id;
    st.save_server(root, vec![]).await;
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if st.live.read().unwrap()[&id].hist.cpu.len() >= 1 { break; }
    }
    let l = st.live.read().unwrap()[&id].clone();
    assert_eq!(l.phase, "online", "error: {}", l.error);
    let s = l.snap.unwrap();
    println!("root: cores={} cpu={:.1}% mem={:.0}MB mounts={} procs={} nets={}", s.cores, s.cpu, s.mem_used / 1e6, s.mounts.len(), s.procs.len(), s.nets.len());
    assert!(s.cores >= 1 && s.mem_total > 0.0 && !s.procs.is_empty());
    assert_eq!(st.privilege(id), Privilege::Root);

    let r = st.run(id, "printf 'a\\nb' | wc -l", None, 10).await;
    assert_eq!(r.out.trim(), "1");
    let r = st.run(id, "cat > /tmp/rackbook-up.txt; wc -c < /tmp/rackbook-up.txt", Some(b"hello\x00world"), 10).await;
    assert_eq!(r.out.trim(), "11", "binary-safe stdin");
    let w = st.write_file(id, "/tmp/rackbook-w.txt", "第一行\n".as_bytes(), true).await;
    assert!(w.ok(), "{}", w.err);
    assert_eq!(st.run(id, "cat /tmp/rackbook-w.txt", None, 10).await.out, "第一行\n");

    // 2. navigator: password login, no sudo
    let mut navi = server("navi", "password");
    let nid = navi.id;
    let aid = navi.accounts[0].id;
    navi.accounts[0].has_login_password = true;
    st.save_server(navi, vec![SecretInput { account_id: aid, kind: "login".into(), value: Some("navi-pass".into()) }]).await;
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if st.privilege(nid) != Privilege::Unknown { break; }
    }
    assert_eq!(st.privilege(nid), Privilege::None, "navi should be navigator; live={:?}", st.live.read().unwrap()[&nid].error);
    let r = st.sudo(nid, "id -u", None, 10).await;
    assert!(!r.ok() && r.err.contains("领航员"), "navigator refused: {}", r.err);

    // 3. captain with password sudo (login password doubles as sudo password)
    let mut cap = server("cap", "password");
    let cid = cap.id;
    let caid = cap.accounts[0].id;
    st.save_server(cap.clone(), vec![SecretInput { account_id: caid, kind: "login".into(), value: Some("cap-pass".into()) }]).await;
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if st.privilege(cid) != Privilege::Unknown { break; }
    }
    assert_eq!(st.privilege(cid), Privilege::Password);
    let r = st.sudo(cid, "id -u", None, 10).await;
    assert_eq!(r.out.trim(), "0", "sudo with password: {}", r.err);
    let w = st.write_file(cid, "/root/rackbook-cap.txt", b"as captain\n", true).await;
    assert!(w.ok(), "captain sudo write: {}", w.err);

    // 4. wrong password -> offline with a clear message
    let mut bad = server("navi", "password");
    let bid = bad.id;
    let baid = bad.accounts[0].id;
    bad.name = "bad".into();
    st.save_server(bad, vec![SecretInput { account_id: baid, kind: "login".into(), value: Some("nope".into()) }]).await;
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if st.live.read().unwrap()[&bid].phase == "offline" { break; }
    }
    let e = st.live.read().unwrap()[&bid].error.clone();
    println!("bad password -> {e}");
    assert!(e.contains("密码被拒"));

    // 5. disconnect / reconnect
    st.disconnect(id, false).await;
    assert_eq!(st.live.read().unwrap()[&id].phase, "parked");
    assert!(st.run(id, "true", None, 5).await.err.contains("停泊"));
    st.connect(id, false);
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if st.live.read().unwrap()[&id].phase == "online" { break; }
    }
    assert_eq!(st.live.read().unwrap()[&id].phase, "online");

    // 6. history after a few polls
    tokio::time::sleep(std::time::Duration::from_secs(7)).await;
    let h = st.live.read().unwrap()[&id].hist.clone();
    println!("history cpu={:?}", h.cpu);
    assert!(h.cpu.len() >= 2);

    for m in log.lock().unwrap().iter() { println!("status: {m}"); }
}
