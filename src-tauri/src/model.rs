use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// How much power an account has on a server; decides captain (舰长) or navigator (领航员).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Privilege {
    #[default]
    Unknown,
    Root,
    Nopasswd,
    Password,
    NeedsPassword,
    None,
}

impl Privilege {
    pub fn can_sudo(self) -> bool {
        matches!(self, Privilege::Root | Privilege::Nopasswd | Privilege::Password)
    }
    pub fn role_name(self) -> &'static str {
        match self {
            Privilege::Unknown => "待查验",
            Privilege::None => "领航员",
            _ => "舰长",
        }
    }
    pub fn detail(self) -> &'static str {
        match self {
            Privilege::Unknown => "还没登舰查验过权限",
            Privilege::Root => "root：拥有全部权限",
            Privilege::Nopasswd => "免密 sudo",
            Privilege::Password => "sudo（密码存在凭据管理器）",
            Privilege::NeedsPassword => "在 sudo 组，但还没存可用的 sudo 密码",
            Privilege::None => "没有 sudo 权限，只能查看和管理自己的东西",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Account {
    pub id: Uuid,
    pub label: String,
    pub user: String,
    /// "key" or "password"
    pub auth: String,
    pub key_path: String,
    pub has_key_pass: bool,
    pub has_login_password: bool,
    pub has_sudo_password: bool,
    pub privilege: Privilege,
}

impl Default for Account {
    fn default() -> Self {
        Account {
            id: Uuid::new_v4(),
            label: String::new(),
            user: "root".into(),
            auth: "key".into(),
            key_path: String::new(),
            has_key_pass: false,
            has_login_password: false,
            has_sudo_password: false,
            privilege: Privilege::Unknown,
        }
    }
}

impl Account {
    pub fn title(&self) -> String {
        if !self.label.trim().is_empty() {
            self.label.clone()
        } else {
            self.user.clone()
        }
    }
    pub fn key(&self, kind: &str) -> String {
        format!("{kind}-{}", self.id)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ServerConfig {
    pub id: Uuid,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub accounts: Vec<Account>,
    pub active_account: Option<Uuid>,
    pub wash: String,
    pub interval: f64,
    pub paused: bool,
}

impl Default for ServerConfig {
    fn default() -> Self {
        let a = Account::default();
        ServerConfig {
            id: Uuid::new_v4(),
            name: String::new(),
            host: String::new(),
            port: 22,
            active_account: Some(a.id),
            accounts: vec![a],
            wash: "sky".into(),
            interval: 3.0,
            paused: false,
        }
    }
}

impl ServerConfig {
    pub fn title(&self) -> String {
        if self.name.trim().is_empty() {
            self.host.clone()
        } else {
            self.name.clone()
        }
    }
    pub fn active(&self) -> Option<&Account> {
        self.accounts
            .iter()
            .find(|a| Some(a.id) == self.active_account)
            .or_else(|| self.accounts.first())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetIface {
    pub name: String,
    pub rx: u64,
    pub tx: u64,
    pub rx_rate: f64,
    pub tx_rate: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Mount {
    pub fs: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub mount: String,
    pub size: f64,
    pub used: f64,
    pub avail: f64,
}

impl Mount {
    #[allow(dead_code)]
    pub fn frac(&self) -> f64 {
        if self.used + self.avail > 0.0 {
            self.used / (self.used + self.avail)
        } else {
            0.0
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProcRow {
    pub pid: i64,
    pub user: String,
    pub cpu: f64,
    pub mem: f64,
    pub rss: f64,
    pub command: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub index: i64,
    pub name: String,
    pub util: f64,
    pub mem_used: f64,
    pub mem_total: f64,
    pub temp: Option<f64>,
    pub power: Option<f64>,
    pub power_limit: Option<f64>,
    pub fan: Option<f64>,
    pub clock_sm: Option<f64>,
    pub mem_util: Option<f64>,
}

/// One login user's share of the machine right now
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserUse {
    pub user: String,
    /// percent of the whole machine (all cores)
    pub cpu: f64,
    /// cores' worth of CPU in use
    pub cores: f64,
    pub rss: f64,
    pub procs: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub time: f64,
    #[serde(default)]
    pub details_time: f64,
    pub hostname: String,
    pub kernel: String,
    pub os: String,
    pub cores: i64,
    pub uptime: f64,
    pub load: Vec<f64>,
    pub procs_running: String,
    pub cpu: f64,
    pub iowait: f64,
    pub per_core: Vec<f64>,
    pub mem_total: f64,
    pub mem_used: f64,
    pub mem_avail: f64,
    pub mem_cache: f64,
    pub swap_total: f64,
    pub swap_used: f64,
    pub nets: Vec<NetIface>,
    pub rx_rate: f64,
    pub tx_rate: f64,
    pub mounts: Vec<Mount>,
    pub io_read: f64,
    pub io_write: f64,
    pub procs: Vec<ProcRow>,
    pub tcp: i64,
    pub gpus: Vec<Gpu>,
    pub users: Vec<UserUse>,
    pub has_docker: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub cpu: Vec<f64>,
    pub mem: Vec<f64>,
    pub rx: Vec<f64>,
    pub tx: Vec<f64>,
    pub io_r: Vec<f64>,
    pub io_w: Vec<f64>,
    pub load: Vec<f64>,
    pub gpu: Vec<f64>,
}

impl History {
    pub fn push(v: &mut Vec<f64>, x: f64) {
        v.push(if x.is_finite() { x } else { 0.0 });
        if v.len() > 150 {
            let n = v.len() - 150;
            v.drain(0..n);
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Live {
    /// idle | connecting | online | offline | parked
    pub phase: String,
    pub error: String,
    pub snap: Option<Snapshot>,
    pub hist: History,
    pub last_update: f64,
    #[serde(skip)]
    pub probed: Option<Uuid>,
    #[serde(skip)]
    pub docker_sudo: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipClassThreshold {
    pub cores: u32,
    pub memory_gib: f64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ShipClassThresholds {
    pub carrier: Option<ShipClassThreshold>,
    pub cruiser: Option<ShipClassThreshold>,
    pub frigate: Option<ShipClassThreshold>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub background_on_close: bool,
    pub float_enabled: bool,
    pub float_mode: String,
    pub float_metrics: Vec<String>,
    pub float_servers: Vec<Uuid>,
    pub float_alerts_only: bool,
    pub float_opacity: f64,
    pub float_x: Option<i32>,
    pub float_y: Option<i32>,
    pub lang: String,
    pub font_scale: u16,
    pub fleet_name: String,
    pub ship_class_thresholds: Option<ShipClassThresholds>,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            background_on_close: true,
            float_enabled: true,
            float_mode: "list".into(),
            float_metrics: vec!["cpu".into(), "mem".into(), "net".into()],
            float_servers: vec![],
            float_alerts_only: false,
            float_opacity: 0.96,
            float_x: None,
            float_y: None,
            lang: String::new(),
            font_scale: 100,
            fleet_name: String::new(),
            ship_class_thresholds: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunOut {
    pub out: String,
    pub err: String,
    pub code: i32,
}

impl RunOut {
    pub fn fail(msg: impl Into<String>) -> Self {
        RunOut { out: String::new(), err: msg.into(), code: -1 }
    }
    pub fn ok(&self) -> bool {
        self.code == 0
    }
}
