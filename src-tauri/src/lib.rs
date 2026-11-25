pub mod collector;
pub mod importer;
pub mod model;
pub mod secrets;
pub mod ssh;
pub mod store;

use std::sync::Arc;

use serde_json::json;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WindowEvent};
use uuid::Uuid;

use model::*;
use store::{shq, SecretInput, Store};

type S<'a> = State<'a, Arc<Store>>;

fn uid(s: &str) -> Result<Uuid, String> {
    Uuid::parse_str(s).map_err(|e| e.to_string())
}

// ---------------- background mode, tray, floating panel ----------------

fn sync_float(app: &AppHandle) {
    let store = app.state::<Arc<Store>>();
    let Some(w) = app.get_webview_window("float") else { return };
    let bg = *store.backgrounded.read().unwrap();
    let prefs = store.prefs.read().unwrap().clone();
    let any = !store.servers.read().unwrap().is_empty();
    if bg && prefs.float_enabled && any {
        if let (Some(x), Some(y)) = (prefs.float_x, prefs.float_y) {
            let _ = w.set_position(PhysicalPosition::new(x, y));
        } else if let Ok(Some(m)) = w.primary_monitor() {
            let sz = m.size();
            let _ = w.set_position(PhysicalPosition::new(sz.width as i32 - 360, 24));
        }
        let _ = w.show();
    } else {
        let _ = w.hide();
    }
}

fn enter_background(app: &AppHandle) {
    let store = app.state::<Arc<Store>>();
    *store.backgrounded.write().unwrap() = true;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    if let Some(t) = app.tray_by_id("main") {
        let _ = t.set_visible(true);
    }
    sync_float(app);
    let float = store.prefs.read().unwrap().float_enabled;
    store.say(format!("已转入后台：舰队继续监控，任务栏右下角有舰船图标{}", if float { "，悬浮窗已弹出。" } else { "。" }), "ok");
}

fn enter_foreground(app: &AppHandle, server: Option<String>) {
    let store = app.state::<Arc<Store>>();
    *store.backgrounded.write().unwrap() = false;
    if let Some(t) = app.tray_by_id("main") {
        let _ = t.set_visible(false);
    }
    sync_float(app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if let Some(s) = server {
            let _ = w.emit("navigate", json!({ "server": s }));
        }
    }
}

fn quit(app: &AppHandle) {
    let store = app.state::<Arc<Store>>().inner().clone();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        store.close_all().await;
        handle.exit(0);
    });
}

// ---------------- commands ----------------

#[tauri::command]
fn get_state(store: S) -> serde_json::Value {
    json!({
        "servers": *store.servers.read().unwrap(),
        "live": *store.live.read().unwrap(),
        "prefs": *store.prefs.read().unwrap(),
        "backgrounded": *store.backgrounded.read().unwrap(),
    })
}

/// Servers already configured elsewhere: ~/.ssh/config (or a file the user picked) and PuTTY sessions.
#[tauri::command]
fn scan_configs(path: Option<String>) -> Vec<importer::Found> {
    let mut v = importer::scan_ssh_config(path.as_ref().map(std::path::PathBuf::from));
    if path.is_none() {
        v.extend(importer::scan_putty());
    }
    v
}

#[tauri::command]
async fn save_server(store: S<'_>, cfg: ServerConfig, secrets: Vec<SecretInput>) -> Result<(), String> {
    store.inner().save_server(cfg, secrets).await;
    Ok(())
}

#[tauri::command]
async fn delete_server(store: S<'_>, id: String) -> Result<(), String> {
    store.delete_server(uid(&id)?).await;
    Ok(())
}

#[tauri::command]
fn move_server(store: S, id: String, delta: i32) -> Result<(), String> {
    store.move_server(uid(&id)?, delta);
    Ok(())
}

#[tauri::command]
async fn connect(store: S<'_>, id: String) -> Result<(), String> {
    store.inner().connect(uid(&id)?, false);
    Ok(())
}

#[tauri::command]
async fn disconnect(store: S<'_>, id: String) -> Result<(), String> {
    store.disconnect(uid(&id)?, false).await;
    Ok(())
}

#[tauri::command]
async fn connect_all(store: S<'_>) -> Result<(), String> {
    store.inner().connect_all();
    Ok(())
}

#[tauri::command]
async fn disconnect_all(store: S<'_>) -> Result<(), String> {
    store.disconnect_all().await;
    Ok(())
}

#[tauri::command]
async fn refresh(store: S<'_>, id: String) -> Result<(), String> {
    store.poll(uid(&id)?).await;
    Ok(())
}

#[tauri::command]
async fn switch_account(store: S<'_>, id: String, account: String) -> Result<(), String> {
    store.inner().switch_account(uid(&id)?, uid(&account)?).await;
    Ok(())
}

#[tauri::command]
async fn reprobe(store: S<'_>, id: String) -> Result<(), String> {
    let id = uid(&id)?;
    store.probe(id).await;
    Ok(())
}

#[tauri::command]
async fn set_sudo_password(store: S<'_>, id: String, account: String, value: Option<String>) -> Result<(), String> {
    store.set_sudo_password(uid(&id)?, uid(&account)?, value.filter(|v| !v.is_empty())).await;
    Ok(())
}

#[tauri::command]
async fn test_connection(store: S<'_>, cfg: ServerConfig, secrets: Vec<SecretInput>) -> Result<String, String> {
    store.test_connection(cfg, secrets).await
}

#[tauri::command]
fn forget_host_key(store: S, host: String, port: u16) {
    store.known.forget(&format!("{host}:{port}"));
    store.say(format!("已忘记 {host}:{port} 的主机指纹，下次连接时重新记录。"), "ok");
}

#[tauri::command]
async fn run(store: S<'_>, id: String, cmd: String, stdin: Option<String>, timeout: Option<u64>) -> Result<RunOut, String> {
    Ok(store.run(uid(&id)?, &cmd, stdin.as_deref().map(|s| s.as_bytes()), timeout.unwrap_or(60)).await)
}

#[tauri::command]
async fn term_open(store: S<'_>, id: String, cols: u32, rows: u32, image: Option<String>) -> Result<String, String> {
    store.inner().term_open(uid(&id)?, cols, rows, image.as_deref()).await
}

#[tauri::command]
async fn term_write(store: S<'_>, tid: String, data: String) -> Result<(), String> {
    store.term_write(&tid, data.as_bytes()).await
}

#[tauri::command]
async fn term_resize(store: S<'_>, tid: String, cols: u32, rows: u32) -> Result<(), String> {
    store.term_resize(&tid, cols, rows).await;
    Ok(())
}

#[tauri::command]
async fn term_close(store: S<'_>, tid: String) -> Result<(), String> {
    store.term_close(&tid).await;
    Ok(())
}

#[tauri::command]
async fn sudo(store: S<'_>, id: String, cmd: String, timeout: Option<u64>) -> Result<RunOut, String> {
    Ok(store.sudo(uid(&id)?, &cmd, None, timeout.unwrap_or(90)).await)
}

#[tauri::command]
async fn docker(store: S<'_>, id: String, args: String, timeout: Option<u64>) -> Result<RunOut, String> {
    Ok(store.docker(uid(&id)?, &args, timeout.unwrap_or(60)).await)
}

#[tauri::command]
fn docker_via_sudo(store: S, id: String) -> Result<bool, String> {
    Ok(store.docker_via_sudo(uid(&id)?))
}

#[tauri::command]
async fn write_file(store: S<'_>, id: String, path: String, content: String, elevated: bool) -> Result<RunOut, String> {
    Ok(store.write_file(uid(&id)?, &path, content.as_bytes(), elevated).await)
}

/// Download a file (cat) or a folder (tar.gz) to a local path chosen in the save dialog.
#[tauri::command]
async fn download(store: S<'_>, id: String, remote: String, is_dir: bool, local: String) -> Result<String, String> {
    let id = uid(&id)?;
    let cmd = if is_dir {
        let p = std::path::Path::new(&remote);
        let parent = p.parent().map(|x| x.to_string_lossy().to_string()).unwrap_or("/".into());
        let name = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
        format!("tar -czf - -C {} {}", shq(if parent.is_empty() { "/" } else { &parent }), shq(&name))
    } else {
        format!("cat -- {}", shq(&remote))
    };
    let o = store.run_bytes(id, &cmd, None, 6 * 3600).await?;
    if o.code != 0 {
        return Err(String::from_utf8_lossy(&o.err).trim().to_string());
    }
    std::fs::write(&local, &o.out).map_err(|e| e.to_string())?;
    Ok(format!("已下载到 {local}（{} 字节）", o.out.len()))
}

/// Upload local files (cat) and folders (tar.gz) into a remote directory.
#[tauri::command]
async fn upload(store: S<'_>, id: String, locals: Vec<String>, remote_dir: String) -> Result<String, String> {
    let id = uid(&id)?;
    let mut done = vec![];
    for l in locals {
        let p = std::path::Path::new(&l);
        let name = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
        let (cmd, data) = if p.is_dir() {
            let mut buf = Vec::new();
            {
                let gz = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::default());
                let mut t = tar::Builder::new(gz);
                t.append_dir_all(&name, p).map_err(|e| e.to_string())?;
                let gz = t.into_inner().map_err(|e| e.to_string())?;
                gz.finish().map_err(|e| e.to_string())?;
            }
            (format!("tar -xzf - -C {}", shq(&remote_dir)), buf)
        } else {
            let data = std::fs::read(p).map_err(|e| e.to_string())?;
            let dest = format!("{}/{}", remote_dir.trim_end_matches('/'), name);
            (format!("cat > {}", shq(&dest)), data)
        };
        let o = store.run_bytes(id, &cmd, Some(&data), 6 * 3600).await?;
        if o.code != 0 {
            return Err(format!("{name}：{}", String::from_utf8_lossy(&o.err).trim()));
        }
        done.push(name);
    }
    Ok(format!("已上传 {} 到 {}", done.join("、"), remote_dir))
}

#[tauri::command]
fn open_terminal(store: S, id: String) -> Result<(), String> {
    let cfg = store.server(uid(&id)?).ok_or("找不到这艘舰船")?;
    let a = cfg.active().cloned().ok_or("没有账户")?;
    let mut args: Vec<String> = vec!["-p".into(), cfg.port.to_string()];
    if a.auth != "password" && !a.key_path.trim().is_empty() {
        args.push("-i".into());
        args.push(a.key_path.clone());
    }
    args.push(format!("{}@{}", a.user, cfg.host));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Windows Terminal if present, otherwise a classic console. Uses Windows' built-in OpenSSH client.
        let wt = std::process::Command::new("wt.exe").arg("ssh").args(&args).spawn();
        if wt.is_err() {
            std::process::Command::new("cmd")
                .args(["/C", "start", "Rackbook", "ssh"])
                .args(&args)
                .creation_flags(0x08000000)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        let cmd = std::iter::once("ssh".to_string()).chain(args.iter().map(|a| store::shq(a))).collect::<Vec<_>>().join(" ");
        let script = format!("tell application \"Terminal\"\n activate\n do script \"{}\"\nend tell", cmd.replace('\\', "\\\\").replace('"', "\\\""));
        std::process::Command::new("osascript").args(["-e", &script]).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // try the common Linux terminals in order
        let tries: [(&str, &[&str]); 6] = [
            ("x-terminal-emulator", &["-e"]),
            ("gnome-terminal", &["--"]),
            ("konsole", &["-e"]),
            ("xfce4-terminal", &["-x"]),
            ("kitty", &[]),
            ("xterm", &["-e"]),
        ];
        let mut ok = false;
        for (bin, pre) in tries {
            if std::process::Command::new(bin).args(pre).arg("ssh").args(&args).spawn().is_ok() {
                ok = true;
                break;
            }
        }
        if !ok {
            return Err("没有找到可用的终端程序（试过 gnome-terminal、konsole、xterm 等）".into());
        }
    }
    store.say(format!("已打开终端：ssh {}@{}（交互式会话，需要时在窗口里输入密码）", a.user, cfg.host), "ok");
    Ok(())
}

#[tauri::command]
fn set_prefs(app: AppHandle, store: S, prefs: Prefs) {
    let relang = store.prefs.read().unwrap().lang != prefs.lang;
    let lang = prefs.lang.clone();
    store.save_prefs(prefs);
    if relang {
        if let Some(t) = app.tray_by_id("main") {
            if let Ok(m) = tray_menu(&app, &lang) { let _ = t.set_menu(Some(m)); }
            let _ = t.set_tooltip(Some(tray_text(&lang)[6]));
        }
    }
    sync_float(&app);
}

#[tauri::command]
fn go_background(app: AppHandle) {
    enter_background(&app);
}

#[tauri::command]
fn show_main(app: AppHandle, server: Option<String>) {
    enter_foreground(&app, server);
}

#[tauri::command]
fn float_resize(app: AppHandle, width: f64, height: f64) {
    if let Some(w) = app.get_webview_window("float") {
        let _ = w.set_size(LogicalSize::new(width, height));
    }
}

#[tauri::command]
fn reset_float(app: AppHandle, store: S) {
    let mut p = store.prefs.read().unwrap().clone();
    p.float_x = None;
    p.float_y = None;
    store.save_prefs(p);
    sync_float(&app);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    quit(&app);
}

// ---------------- app ----------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run_app() {
    tauri::Builder::default()
        // must be the first plugin: a second launch (double-clicking the icon again, a second shortcut) only
        // brings the running Rackbook forward and exits, instead of opening a second, empty copy
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| enter_foreground(app, None)))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let emit_handle = handle.clone();
            let emit: store::Emit = Arc::new(move |event: &str, payload: serde_json::Value| {
                let _ = emit_handle.emit(event, payload);
            });
            let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("Rackbook"));
            let store = Store::new(dir, emit);
            app.manage(store.clone());
            tauri::async_runtime::spawn(async move { store.start() });

            // tray icon: only visible while running in the background
            let lang = store_lang(app.handle());
            let menu = tray_menu(app.handle(), &lang)?;
            let tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip(tray_text(&lang)[6])
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| {
                    let store = app.state::<Arc<Store>>().inner().clone();
                    match ev.id().as_ref() {
                        "open" => enter_foreground(app, None),
                        "float" => {
                            let mut p = store.prefs.read().unwrap().clone();
                            p.float_enabled = !p.float_enabled;
                            store.save_prefs(p);
                            sync_float(app);
                        }
                        "up" => {
                            tauri::async_runtime::spawn(async move { store.connect_all() });
                        }
                        "down" => {
                            tauri::async_runtime::spawn(async move { store.disconnect_all().await });
                        }
                        "quit" => quit(app),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                        enter_foreground(tray.app_handle(), None);
                    }
                })
                .build(app)?;
            tray.set_visible(false)?;
            let _ = handle;
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            match (window.label(), event) {
                ("main", WindowEvent::CloseRequested { api, .. }) => {
                    let store = app.state::<Arc<Store>>();
                    if store.prefs.read().unwrap().background_on_close {
                        api.prevent_close();
                        enter_background(app);
                    } else {
                        api.prevent_close();
                        quit(app);
                    }
                }
                ("float", WindowEvent::Moved(pos)) => {
                    let store = app.state::<Arc<Store>>();
                    let mut p = store.prefs.read().unwrap().clone();
                    if p.float_x != Some(pos.x) || p.float_y != Some(pos.y) {
                        p.float_x = Some(pos.x);
                        p.float_y = Some(pos.y);
                        *store.prefs.write().unwrap() = p.clone();
                        if let Ok(b) = serde_json::to_vec_pretty(&p) {
                            let _ = std::fs::write(store.data_dir.join("prefs.json"), b);
                        }
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_state, scan_configs, term_open, term_write, term_resize, term_close, save_server, delete_server, move_server, connect, disconnect, connect_all, disconnect_all,
            refresh, switch_account, reprobe, set_sudo_password, test_connection, forget_host_key, run, sudo, docker,
            docker_via_sudo, write_file, download, upload, open_terminal, set_prefs, go_background, show_main,
            float_resize, reset_float, quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Rackbook");
}

fn store_lang(app: &AppHandle) -> String {
    app.try_state::<Arc<Store>>().map(|s| s.prefs.read().unwrap().lang.clone()).unwrap_or_default()
}

/// open, float, up, down, quit, (unused), tooltip
fn tray_text(lang: &str) -> [&'static str; 7] {
    match lang {
        "en" => ["Open main window", "Floating panel: on / off", "Connect all", "Disconnect all", "Quit Rackbook", "", "Rackbook · Starfleet (on watch in background)"],
        "ja" => ["メインウィンドウを開く", "フローティング：オン / オフ", "すべて接続", "すべて切断", "Rackbook を終了", "", "Rackbook · 宇宙艦隊（バックグラウンドで当直中）"],
        "es" => ["Abrir ventana principal", "Panel flotante: sí / no", "Conectar todo", "Desconectar todo", "Salir de Rackbook", "", "Rackbook · Flota estelar (de guardia en segundo plano)"],
        "ko" => ["메인 창 열기", "플로팅 창: 켜기 / 끄기", "모두 연결", "모두 연결 해제", "Rackbook 종료", "", "Rackbook · 우주 함대 (백그라운드 당직 중)"],
        "zh-TW" => ["開啟主視窗", "懸浮窗：開 / 關", "全部接通", "全部斷開", "結束 Rackbook", "", "Rackbook · 星際艦隊（背景值班中）"],
        _ => ["打开主窗口", "悬浮窗：开 / 关", "全部接通", "全部断开", "退出 Rackbook", "", "Rackbook · 星际舰队（后台值班中）"],
    }
}

fn tray_menu(app: &AppHandle, lang: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let t = tray_text(lang);
    let open = MenuItem::with_id(app, "open", t[0], true, None::<&str>)?;
    let float = MenuItem::with_id(app, "float", t[1], true, None::<&str>)?;
    let up = MenuItem::with_id(app, "up", t[2], true, None::<&str>)?;
    let down = MenuItem::with_id(app, "down", t[3], true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, "quit", t[4], true, None::<&str>)?;
    Menu::with_items(app, &[&open, &float, &up, &down, &sep, &exit])
}
