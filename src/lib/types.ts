/** Types miroir des modèles Rust (`src-tauri/src/models.rs`). */

export type BotStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed'
  | 'error';

export type BotOrigin = 'local' | 'cluster' | 'catalog';
export type RestartPolicy = 'always' | 'on_failure' | 'never';

export interface BotRecord {
  id: string;
  name: string;
  description: string;
  origin: BotOrigin;
  cluster_id: string | null;
  remote_bot_id: string | null;
  entry: string;
  auto_start: boolean;
  restart_policy: RestartPolicy;
  max_restarts: number;
  memory_limit_mb: number | null;
  catalog_slug: string | null;
  version: string | null;
  created_at: string;
  updated_at: string;
  owner: string | null;
  public_slug: string | null;
}

export interface BotRuntimeInfo {
  id: string;
  status: BotStatus;
  pid: number | null;
  exit_code: number | null;
  started_at: string | null;
  restarts: number;
  last_error: string | null;
  discord_ready: boolean;
  cpu_percent: number;
  memory_mb: number;
  uptime_secs: number;
}

export interface BotSummary extends BotRecord, BotRuntimeInfo {
  has_token: boolean;
}

export interface LogLine {
  seq: number;
  ts: string;
  stream: string;
  line: string;
}

export interface FileEntry {
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
}

export interface EditorAvailability {
  code: boolean;
  cursor: boolean;
}

export interface Settings {
  core_url: string;
  launch_at_login: boolean;
  minimize_to_tray: boolean;
  close_to_tray: boolean;
  auto_update: boolean;
  max_concurrent_bots: number;
  default_memory_limit_mb: number;
  heartbeat_secs: number;
}

export interface CoreUser {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  zenode_id: string | null;
}

export interface AuthState {
  authenticated: boolean;
  user: CoreUser | null;
  device_id: string | null;
  host_id: string | null;
  expires_at: string | null;
}

export interface RuntimeStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
  pinned_version: string;
  platform: string;
  arch: string;
  size_bytes: number;
}

export interface HostIdentity {
  host_id: string;
  machine_id: string;
  name: string;
  public_key: string;
  registered_at: string;
}

export interface AppInfo {
  version: string;
  os: string;
  arch: string;
  runtime: RuntimeStatus;
  auth: AuthState;
  settings: Settings;
  core_url: string;
  host: HostIdentity | null;
  last_sync: string | null;
  editors: EditorAvailability;
  autostart: boolean;
  paths: { data: string; bots: string; logs: string };
}

export interface PairingInfo {
  user_code: string;
  verification_uri: string;
  expires_at: string;
  interval_secs: number;
}

export interface PairingPoll {
  status: string;
  message?: string | null;
  user?: CoreUser | null;
  warning?: string | null;
}

export interface ClusterSummary {
  cluster_id: string;
  name: string;
  slug: string;
  visibility: 'private' | 'public' | string;
  role: string;
  description: string;
  member_count: number;
  host_count: number;
  bot_count: number;
  online_bots: number;
  health: string;
  created_at: string;
}

export interface HostSummary {
  host_id: string;
  name: string;
  os: string;
  arch: string;
  status: string;
  last_seen: string | null;
  bots: number;
  cpu_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  capacity: number;
  version: string | null;
}

export interface ClusterMember {
  user_id: string;
  display_name: string;
  role: string;
  joined_at: string;
  host_id: string | null;
}

export interface ClusterBot {
  bot_id: string;
  name: string;
  owner_user_id: string;
  owner_name: string | null;
  host_id: string | null;
  host_name: string | null;
  status: string;
  moderation: string;
  created_at: string;
  public_slug: string | null;
}

export interface ClusterDetail extends ClusterSummary {
  hosts: HostSummary[];
  members: ClusterMember[];
  bots: ClusterBot[];
  invite_code: string | null;
}

export interface CatalogBot {
  slug: string;
  name: string;
  description: string;
  author: string;
  category: string;
  version: string;
  installs: number;
  source_url: string | null;
  verified: boolean;
}

export interface UpdateInfo {
  version: string;
  notes: string;
  published_at: string;
  downloads: Record<string, string>;
}

export interface RuntimeProgress {
  phase: string;
  received: number;
  total: number;
  percent: number;
}

export interface LocalStats {
  cpu_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  bots: BotSummary[];
  host: HostIdentity | null;
  runtime_version: string;
}

export interface NewBotInput {
  name: string;
  description?: string;
  token?: string;
  auto_start?: boolean;
}
