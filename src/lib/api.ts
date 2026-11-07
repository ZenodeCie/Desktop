import { invoke } from '@tauri-apps/api/core';

import type {
  AppInfo,
  AuthState,
  BotSummary,
  CatalogBot,
  ClusterDetail,
  ClusterSummary,
  EditorAvailability,
  FileEntry,
  LogLine,
  NewBotInput,
  PairingInfo,
  PairingPoll,
  RuntimeStatus,
  Settings,
  UpdateInfo,
} from './types';

/**
 * Enveloppe typée des commandes Tauri.
 *
 * Tauri v2 convertit les arguments camelCase vers les paramètres snake_case
 * des commandes Rust. Les erreurs sont des messages déjà rédigés pour
 * l'utilisateur (voir `AppError` côté Rust).
 */
export const api = {
  appInfo: () => invoke<AppInfo>('app_info'),

  getSettings: () => invoke<Settings>('get_settings'),
  saveSettings: (settings: Settings) => invoke<Settings>('save_settings', { settings }),

  listBots: () => invoke<BotSummary[]>('list_bots'),
  getBot: (id: string) => invoke<BotSummary>('get_bot', { id }),
  createBot: (input: NewBotInput) => invoke<BotSummary>('create_bot', { input }),
  updateBot: (id: string, patch: Record<string, unknown>) =>
    invoke<BotSummary>('update_bot', { id, patch }),
  deleteBot: (id: string) => invoke<void>('delete_bot', { id }),
  setBotToken: (id: string, token: string) =>
    invoke<void>('set_bot_token', { id, token }),
  clearBotToken: (id: string) => invoke<void>('clear_bot_token', { id }),
  startBot: (id: string) => invoke<BotSummary>('start_bot', { id }),
  stopBot: (id: string) => invoke<BotSummary>('stop_bot', { id }),
  restartBot: (id: string) => invoke<BotSummary>('restart_bot', { id }),

  getBotLogs: (id: string, limit = 500) =>
    invoke<LogLine[]>('get_bot_logs', { id, limit }),
  listBotFiles: (id: string) => invoke<FileEntry[]>('list_bot_files', { id }),
  readBotFile: (id: string, path: string) =>
    invoke<string>('read_bot_file', { id, path }),
  writeBotFile: (id: string, path: string, contents: string) =>
    invoke<void>('write_bot_file', { id, path, contents }),
  openBotFolder: (id: string) => invoke<void>('open_bot_folder', { id }),
  openInEditor: (id: string, editor: 'code' | 'cursor') =>
    invoke<void>('open_in_editor', { id, editor }),
  editors: () => invoke<EditorAvailability>('editor_availability'),

  runtimeStatus: () => invoke<RuntimeStatus>('runtime_status'),
  installRuntime: () => invoke<RuntimeStatus>('install_runtime'),

  authStartPairing: (deviceName?: string) =>
    invoke<PairingInfo>('auth_start_pairing', { deviceName }),
  authPollPairing: () => invoke<PairingPoll>('auth_poll_pairing'),
  authLogout: () => invoke<void>('auth_logout'),
  authState: () => invoke<AuthState>('auth_state'),
  syncNow: () => invoke<{ ok: boolean; reason?: string }>('sync_now'),

  listClusters: () => invoke<ClusterSummary[]>('list_clusters'),
  clusterDetail: (clusterId: string) =>
    invoke<ClusterDetail>('cluster_detail', { clusterId }),
  createCluster: (name: string, visibility: 'private' | 'public', description?: string) =>
    invoke<{ cluster_id?: string }>('create_cluster', { name, visibility, description }),
  joinCluster: (code: string) => invoke<unknown>('join_cluster', { code }),
  leaveCluster: (clusterId: string) => invoke<unknown>('leave_cluster', { clusterId }),
  createClusterInvite: (clusterId: string) =>
    invoke<{ code?: string; invite_code?: string; expires_at?: string }>(
      'create_cluster_invite',
      { clusterId },
    ),
  deleteCluster: (clusterId: string) => invoke<unknown>('delete_cluster', { clusterId }),

  deployBot: (clusterId: string, botId: string, hostId?: string) =>
    invoke<unknown>('deploy_bot', { clusterId, botId, hostId }),
  removeClusterBot: (clusterId: string, botId: string) =>
    invoke<unknown>('remove_cluster_bot', { clusterId, botId }),
  assignClusterBot: (clusterId: string, botId: string, hostId?: string) =>
    invoke<unknown>('assign_cluster_bot', { clusterId, botId, hostId }),
  reportClusterBot: (clusterId: string, botId: string, reason: string) =>
    invoke<unknown>('report_cluster_bot', { clusterId, botId, reason }),
  blockClusterBot: (clusterId: string, botId: string, reason: string) =>
    invoke<unknown>('block_cluster_bot', { clusterId, botId, reason }),

  listCatalog: () => invoke<CatalogBot[]>('list_catalog'),
  installCatalogBot: (slug: string, token: string, name?: string) =>
    invoke<BotSummary>('install_catalog_bot', { input: { slug, token, name } }),

  checkUpdates: () => invoke<UpdateInfo | null>('check_updates'),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  openLogsFolder: () => invoke<void>('open_logs_folder'),
  openStorageAccessSettings: () => invoke<void>('open_storage_access_settings'),
  localStats: () => invoke<unknown>('local_host_stats'),
  hideWindow: () => invoke<void>('hide_window'),
  showWindow: () => invoke<void>('show_window'),
  quit: () => invoke<void>('quit_app'),
};

/** Message lisible pour n'importe quelle erreur de commande Tauri. */
export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'Une erreur inattendue est survenue.';
}
