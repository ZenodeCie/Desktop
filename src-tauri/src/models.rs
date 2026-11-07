use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RestartPolicy {
    Always,
    #[default]
    OnFailure,
    Never,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BotOrigin {
    #[default]
    Local,
    Cluster,
    Catalog,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BotRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub origin: BotOrigin,
    #[serde(default)]
    pub cluster_id: Option<String>,
    #[serde(default)]
    pub remote_bot_id: Option<String>,
    #[serde(default)]
    pub entry: String,
    #[serde(default = "default_true")]
    pub auto_start: bool,
    #[serde(default)]
    pub restart_policy: RestartPolicy,
    #[serde(default = "default_max_restarts")]
    pub max_restarts: u32,
    #[serde(default)]
    pub memory_limit_mb: Option<u64>,
    #[serde(default)]
    pub catalog_slug: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    /// Métadonnées d'affichage remontées par le Core (jamais de secret).
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub public_slug: Option<String>,
}

fn default_true() -> bool {
    true
}
fn default_max_restarts() -> u32 {
    8
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BotStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
    Crashed,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BotRuntimeInfo {
    pub id: String,
    pub status: BotStatus,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub started_at: Option<String>,
    pub restarts: u32,
    pub last_error: Option<String>,
    pub discord_ready: bool,
    pub cpu_percent: f32,
    pub memory_mb: f64,
    pub uptime_secs: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BotSummary {
    #[serde(flatten)]
    pub record: BotRecord,
    #[serde(flatten)]
    pub runtime: BotRuntimeInfo,
    pub has_token: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LogLine {
    pub seq: u64,
    pub ts: String,
    pub stream: String,
    pub line: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_core_url")]
    pub core_url: String,
    #[serde(default = "default_true")]
    pub launch_at_login: bool,
    #[serde(default = "default_true")]
    pub minimize_to_tray: bool,
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    #[serde(default = "default_true")]
    pub auto_update: bool,
    #[serde(default = "default_max_bots")]
    pub max_concurrent_bots: u32,
    #[serde(default = "default_memory")]
    pub default_memory_limit_mb: u64,
    #[serde(default)]
    pub heartbeat_secs: u64,
}

fn default_core_url() -> String {
    "https://zenode.fr".to_string()
}
fn default_max_bots() -> u32 {
    4
}
fn default_memory() -> u64 {
    1024
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            core_url: default_core_url(),
            launch_at_login: true,
            minimize_to_tray: true,
            close_to_tray: true,
            auto_update: true,
            max_concurrent_bots: default_max_bots(),
            default_memory_limit_mb: default_memory(),
            heartbeat_secs: 20,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct HostIdentity {
    pub host_id: String,
    pub machine_id: String,
    pub name: String,
    pub public_key: String,
    #[serde(default)]
    pub registered_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct State {
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub bots: Vec<BotRecord>,
    #[serde(default)]
    pub host: Option<HostIdentity>,
    #[serde(default)]
    pub last_sync: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CoreUser {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub zenode_id: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct AuthState {
    pub authenticated: bool,
    pub user: Option<CoreUser>,
    pub device_id: Option<String>,
    pub host_id: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PairingInfo {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_at: String,
    pub interval_secs: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct RuntimeStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub pinned_version: String,
    pub platform: String,
    pub arch: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClusterSummary {
    pub cluster_id: String,
    pub name: String,
    pub slug: String,
    pub visibility: String,
    pub role: String,
    pub description: String,
    pub member_count: u32,
    pub host_count: u32,
    pub bot_count: u32,
    pub online_bots: u32,
    pub health: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HostSummary {
    pub host_id: String,
    pub name: String,
    pub os: String,
    pub arch: String,
    pub status: String,
    pub last_seen: Option<String>,
    pub bots: u32,
    pub cpu_percent: f64,
    pub memory_used_mb: f64,
    pub memory_total_mb: f64,
    pub capacity: u32,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClusterDetail {
    #[serde(flatten)]
    pub summary: ClusterSummary,
    pub hosts: Vec<HostSummary>,
    pub members: Vec<ClusterMember>,
    pub bots: Vec<ClusterBot>,
    pub invite_code: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClusterMember {
    pub user_id: String,
    pub display_name: String,
    pub role: String,
    pub joined_at: String,
    pub host_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClusterBot {
    pub bot_id: String,
    pub name: String,
    pub owner_user_id: String,
    pub owner_name: Option<String>,
    pub host_id: Option<String>,
    pub host_name: Option<String>,
    pub status: String,
    pub moderation: String,
    pub created_at: String,
    pub public_slug: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CatalogBot {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub category: String,
    pub version: String,
    pub installs: u64,
    pub source_url: Option<String>,
    pub verified: bool,
}

/// Affectation envoyée par le Core au heartbeat. Le jeton est scellé pour la
/// clé publique de CETTE machine : aucun autre hôte ne peut l'ouvrir.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Assignment {
    pub bot_id: String,
    pub name: String,
    pub cluster_id: Option<String>,
    pub cluster_name: Option<String>,
    pub owner: Option<String>,
    pub public_slug: Option<String>,
    pub source_url: Option<String>,
    pub entry: Option<String>,
    pub sealed_token: String,
    pub version: Option<String>,
    #[serde(default)]
    pub memory_limit_mb: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HeartbeatResult {
    #[serde(default)]
    pub assignments: Vec<Assignment>,
    #[serde(default)]
    pub removed: Vec<String>,
    #[serde(default)]
    pub host_status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub published_at: String,
    pub downloads: std::collections::HashMap<String, String>,
}
