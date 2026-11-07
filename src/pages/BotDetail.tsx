import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import {
  AlertTriangle,
  ArrowLeft,
  Braces,
  ChevronRight,
  Code2,
  FileCode2,
  FilePlus2,
  FolderOpen,
  KeyRound,
  Loader2,
  Network,
  Play,
  RotateCw,
  Save,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import '../lib/monaco';

import { api, errorMessage } from '../lib/api';
import {
  formatBytes,
  formatClock,
  formatDate,
  formatMegabytes,
  formatPercent,
  formatUptime,
  humanOrigin,
  humanStatus,
  languageForFile,
} from '../lib/format';
import { useApp, useBots, useLogs, useToast } from '../lib/store';
import type {
  BotSummary,
  ClusterSummary,
  FileEntry,
  HostSummary,
  LogLine,
} from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DangerButton,
  EmptyState,
  Field,
  IconButton,
  InlineError,
  InlineNote,
  Input,
  KeyValue,
  Modal,
  Select,
  Spinner,
  StatusDot,
  Switch,
  Tabs,
} from '../components/ui';

type TabId = 'overview' | 'logs' | 'files' | 'settings';

export function BotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { bots, loading, refresh } = useBots();
  const { info } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('overview');
  const [busy, setBusy] = useState<string | null>(null);

  const bot = useMemo(() => bots.find((item) => item.id === id), [bots, id]);

  if (loading && !bot) return <Spinner label="Chargement du bot…" />;

  if (!bot) {
    return (
      <EmptyState
        icon={<AlertTriangle size={20} />}
        title="Bot introuvable"
        description="Ce bot n’existe plus ou son dossier a été supprimé."
        action={
          <Link to="/" className="text-xs font-medium text-accent hover:underline">
            Retour à la liste
          </Link>
        }
      />
    );
  }

  const run = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(action);
    try {
      if (action === 'start') await api.startBot(bot.id);
      else if (action === 'stop') await api.stopBot(bot.id);
      else await api.restartBot(bot.id);
      await refresh();
      toast.success(
        action === 'start'
          ? 'Démarrage demandé.'
          : action === 'stop'
            ? 'Arrêt demandé.'
            : 'Redémarrage demandé.',
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const stopRequested = bot.status === 'stopped' || bot.status === 'crashed' || bot.status === 'error';
  const transitioning = bot.status === 'starting' || bot.status === 'stopping';

  return (
    <>
      <div className="mb-3 flex items-center gap-1.5 text-2xs text-fg-subtle">
        <Link to="/" className="hover:text-fg">
          Bots
        </Link>
        <ChevronRight size={11} />
        <span className="truncate text-fg-muted">{bot.name}</span>
      </div>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            aria-label="Retour"
            onClick={() => navigate('/')}
            className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-ctl border border-line bg-surface text-fg-muted hover:bg-sunken hover:text-fg"
          >
            <ArrowLeft size={15} />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusDot status={bot.status} />
              <h1 className="truncate text-xl font-semibold tracking-tight">{bot.name}</h1>
              <Badge tone={toneForStatus(bot.status)}>{humanStatus(bot.status)}</Badge>
              {bot.origin !== 'local' ? (
                <Badge tone="accent">{humanOrigin(bot.origin)}</Badge>
              ) : null}
            </div>
            <p className="mt-1 truncate font-mono text-2xs text-fg-subtle">
              {bot.id} · {bot.entry}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {stopRequested ? (
            <Button
              variant="primary"
              icon={<Play size={13} />}
              loading={busy === 'start'}
              disabled={busy !== null || !bot.has_token}
              title={bot.has_token ? undefined : 'Configurez le jeton Discord'}
              onClick={() => void run('start')}
            >
              Démarrer
            </Button>
          ) : (
            <Button
              icon={<Square size={12} />}
              loading={busy === 'stop'}
              disabled={busy !== null || transitioning}
              onClick={() => void run('stop')}
            >
              Arrêter
            </Button>
          )}
          <Button
            icon={<RotateCw size={13} />}
            loading={busy === 'restart'}
            disabled={busy !== null || transitioning}
            onClick={() => void run('restart')}
          >
            Redémarrer
          </Button>
          <IconButton
            label="Ouvrir le dossier"
            onClick={() => {
              api.openBotFolder(bot.id).catch((error) => toast.error(errorMessage(error)));
            }}
          >
            <FolderOpen size={14} />
          </IconButton>
          <IconButton
            label={info?.editors.code ? 'Ouvrir dans VS Code' : 'VS Code introuvable'}
            disabled={!info?.editors.code}
            onClick={() => {
              api.openInEditor(bot.id, 'code').catch((error) => toast.error(errorMessage(error)));
            }}
          >
            <Code2 size={14} />
          </IconButton>
          <IconButton
            label={info?.editors.cursor ? 'Ouvrir dans Cursor' : 'Cursor introuvable'}
            disabled={!info?.editors.cursor}
            onClick={() => {
              api.openInEditor(bot.id, 'cursor').catch((error) => toast.error(errorMessage(error)));
            }}
          >
            <Braces size={14} />
          </IconButton>
        </div>
      </div>

      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Aperçu', icon: <SlidersHorizontal size={13} /> },
          { id: 'logs', label: 'Logs', icon: <ScrollText size={13} /> },
          { id: 'files', label: 'Fichiers', icon: <FileCode2 size={13} /> },
          { id: 'settings', label: 'Réglages', icon: <Terminal size={13} /> },
        ]}
      />

      <div className="mt-5">
        {tab === 'overview' ? (
          <OverviewTab
            bot={bot}
            onChanged={refresh}
            onDelete={async () => {
              try {
                await api.deleteBot(bot.id);
                toast.success('Bot supprimé.');
                navigate('/');
              } catch (error) {
                toast.error(errorMessage(error));
              }
            }}
          />
        ) : null}
        {tab === 'logs' ? <LogsTab botId={bot.id} /> : null}
        {tab === 'files' ? <FilesTab botId={bot.id} /> : null}
        {tab === 'settings' ? <SettingsTab bot={bot} onChanged={refresh} /> : null}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- aperçu */

function OverviewTab({
  bot,
  onChanged,
  onDelete,
}: {
  bot: BotSummary;
  onChanged: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        <Card>
          <CardHeader
            title="Exécution"
            description="Un processus Bun isolé par bot, redémarré selon la politique configurée."
            actions={<Badge tone={toneForStatus(bot.status)} dot>{humanStatus(bot.status)}</Badge>}
          />
          <div className="grid gap-x-8 gap-y-1 px-4 py-3 sm:grid-cols-2">
            <KeyValue label="PID">{bot.pid ?? '—'}</KeyValue>
            <KeyValue label="Uptime">{formatUptime(bot.uptime_secs)}</KeyValue>
            <KeyValue label="CPU">{formatPercent(bot.cpu_percent, 1)}</KeyValue>
            <KeyValue label="Mémoire">{formatMegabytes(bot.memory_mb)}</KeyValue>
            <KeyValue label="Redémarrages">
              {bot.restarts} / {bot.max_restarts}
            </KeyValue>
            <KeyValue label="Démarré le">{formatDate(bot.started_at)}</KeyValue>
            <KeyValue label="Dernier code de sortie">
              {bot.exit_code === null ? '—' : bot.exit_code}
            </KeyValue>
            <KeyValue label="Discord">{bot.discord_ready ? 'prêt' : 'non connecté'}</KeyValue>
          </div>
          {bot.last_error ? (
            <div className="border-t border-line px-4 py-3">
              <InlineError message={bot.last_error} />
            </div>
          ) : null}
        </Card>

        <RecentLogs botId={bot.id} />

        <Card>
          <CardHeader title="Zone sensible" description="La suppression efface le code source local et le jeton chiffré." />
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-xs text-fg-muted">
              Cette action est définitive pour ce bot local. Un bot hébergé depuis un
              cluster peut être redéployé par son propriétaire.
            </p>
            <DangerButton
              label="Supprimer ce bot"
              confirmLabel="Confirmer la suppression"
              icon={<Trash2 size={13} />}
              onConfirm={onDelete}
            />
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <TokenPanel bot={bot} onChanged={onChanged} />
        <ClusterPanel bot={bot} onChanged={onChanged} />
      </div>
    </div>
  );
}

function RecentLogs({ botId }: { botId: string }) {
  const { logs } = useLogs(botId);
  const recent = logs.slice(-6);
  return (
    <Card>
      <CardHeader
        title="Dernières lignes"
        description="Flux en direct du processus."
        actions={
          <Badge tone="outline">
            {logs.length} ligne{logs.length > 1 ? 's' : ''}
          </Badge>
        }
      />
      <div className="rounded-b-lg bg-stone-950 p-3 font-mono text-2xs leading-5">
        {recent.length === 0 ? (
          <p className="text-stone-500">Aucun log pour le moment.</p>
        ) : (
          recent.map((log) => <LogLineView key={log.seq} log={log} compact />)
        )}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- jeton */

function TokenPanel({ bot, onChanged }: { bot: BotSummary; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (token.trim().length < 50) {
      setError('Le jeton semble trop court. Copiez le token complet depuis le portail Discord.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.setBotToken(bot.id, token.trim());
      setToken('');
      await onChanged();
      toast.success('Jeton enregistré dans le coffre local.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Jeton Discord"
        description="Chiffré au repos, injecté uniquement au processus."
        actions={
          <Badge tone={bot.has_token ? 'success' : 'warn'} dot>
            {bot.has_token ? 'configuré' : 'absent'}
          </Badge>
        }
      />
      <div className="flex flex-col gap-2.5 px-4 py-3">
        <div className="flex items-center gap-2 text-2xs text-fg-muted">
          <KeyRound size={13} className="text-fg-subtle" />
          Le jeton n’est jamais affiché ni écrit dans le dossier du bot.
        </div>
        <Input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={bot.has_token ? 'Remplacer le jeton…' : 'Coller le jeton Discord'}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="flex items-center justify-between gap-2">
          <DangerButton
            size="sm"
            label="Effacer"
            confirmLabel="Confirmer"
            onConfirm={async () => {
              try {
                await api.clearBotToken(bot.id);
                await onChanged();
                toast.success('Jeton effacé.');
              } catch (cause) {
                toast.error(errorMessage(cause));
              }
            }}
          />
          <Button
            size="sm"
            variant="primary"
            icon={<ShieldCheck size={13} />}
            loading={saving}
            disabled={token.trim().length === 0}
            onClick={save}
          >
            Enregistrer
          </Button>
        </div>
        <InlineError message={error} />
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- cluster */

function ClusterPanel({ bot, onChanged }: { bot: BotSummary; onChanged: () => Promise<void> }) {
  const { authenticated } = useApp();
  const toast = useToast();
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  const [hosts, setHosts] = useState<HostSummary[]>([]);
  const [clusterId, setClusterId] = useState('');
  const [hostId, setHostId] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    api
      .listClusters()
      .then((list) => active && setClusters(list))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [authenticated]);

  useEffect(() => {
    if (!clusterId) {
      setHosts([]);
      return;
    }
    let active = true;
    api
      .clusterDetail(clusterId)
      .then((detail) => active && setHosts(detail.hosts))
      .catch(() => active && setHosts([]));
    return () => {
      active = false;
    };
  }, [clusterId]);

  const deployed = Boolean(bot.cluster_id && bot.remote_bot_id);

  const deploy = async () => {
    setDeploying(true);
    setError(null);
    try {
      await api.deployBot(clusterId, bot.id, hostId || undefined);
      toast.success('Bot déployé. L’hôte le recevra au prochain heartbeat.');
      await onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setDeploying(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Cluster"
        description="Déployer ce bot sur une machine du cluster."
        actions={
          <Badge tone={deployed ? 'accent' : 'outline'} dot={deployed}>
            {deployed ? 'déployé' : 'local'}
          </Badge>
        }
      />
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {deployed ? (
          <>
            <KeyValue label="Cluster">{bot.cluster_id}</KeyValue>
            <KeyValue label="Bot distant">{bot.remote_bot_id}</KeyValue>
            <p className="text-2xs text-fg-muted">
              Le jeton est scellé pour la clé publique de l’hôte choisi. Le code source
              peut être déployé depuis le catalogue.
            </p>
            <DangerButton
              size="sm"
              label="Retirer du cluster"
              confirmLabel="Confirmer"
              onConfirm={async () => {
                if (!bot.cluster_id || !bot.remote_bot_id) return;
                try {
                  await api.removeClusterBot(bot.cluster_id, bot.remote_bot_id);
                  await onChanged();
                  toast.success('Bot retiré du cluster.');
                } catch (cause) {
                  toast.error(errorMessage(cause));
                }
              }}
            />
          </>
        ) : !authenticated ? (
          <InlineNote>
            Liez votre compte pour déployer ce bot sur un cluster.{' '}
            <Link to="/onboarding" className="font-medium text-accent hover:underline">
              Configurer
            </Link>
          </InlineNote>
        ) : (
          <>
            <Field label="Cluster de destination">
              <Select
                value={clusterId}
                onChange={(event) => {
                  setClusterId(event.target.value);
                  setHostId('');
                }}
              >
                <option value="">Sélectionner un cluster…</option>
                {clusters.map((cluster) => (
                  <option key={cluster.cluster_id} value={cluster.cluster_id}>
                    {cluster.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Hôte" hint="Laissez vide pour laisser le Core choisir la machine.">
              <Select value={hostId} onChange={(event) => setHostId(event.target.value)}>
                <option value="">Affectation automatique</option>
                {hosts.map((host) => (
                  <option key={host.host_id} value={host.host_id}>
                    {host.name} · {host.status}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="primary"
              icon={<Network size={13} />}
              loading={deploying}
              disabled={!clusterId || !bot.has_token}
              onClick={deploy}
            >
              Déployer
            </Button>
            {!bot.has_token ? (
              <p className="text-2xs text-warn-fg">
                Configurez le jeton Discord avant de déployer.
              </p>
            ) : null}
            <InlineError message={error} />
          </>
        )}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------- logs */

function LogsTab({ botId }: { botId: string }) {
  const toast = useToast();
  const { logs, loading, clear } = useLogs(botId);
  const [stream, setStream] = useState('all');
  const [query, setQuery] = useState('');
  const [autoscroll, setAutoscroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return logs.filter((log) => {
      if (stream !== 'all' && log.stream !== stream) return false;
      if (needle && !log.line.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [logs, stream, query]);

  useEffect(() => {
    if (autoscroll) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [filtered.length, autoscroll]);

  return (
    <Card>
      <CardHeader
        title="Logs en direct"
        description="Sortie standard et erreurs du processus, avec masquage automatique des jetons."
        actions={
          <>
            <Button
              size="sm"
              variant={autoscroll ? 'primary' : 'secondary'}
              onClick={() => setAutoscroll((value) => !value)}
            >
              Défilement auto
            </Button>
            <Button size="sm" variant="ghost" onClick={clear}>
              Vider
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <Select
          value={stream}
          onChange={(event) => setStream(event.target.value)}
          className="w-40"
        >
          <option value="all">Tous les flux</option>
          <option value="stdout">stdout</option>
          <option value="stderr">stderr</option>
          <option value="system">système</option>
          <option value="install">installation</option>
        </Select>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filtrer les lignes…"
          className="max-w-xs"
        />
        <span className="text-2xs text-fg-subtle">
          {filtered.length} / {logs.length} lignes
        </span>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            icon={<FolderOpen size={13} />}
            onClick={() => {
              api.openLogsFolder().catch((error) => toast.error(errorMessage(error)));
            }}
          >
            Dossier des logs
          </Button>
        </div>
      </div>
      <div className="h-[calc(100vh-26rem)] min-h-64 overflow-auto rounded-b-lg bg-stone-950 p-3 font-mono text-2xs leading-5">
        {loading && logs.length === 0 ? (
          <p className="flex items-center gap-2 text-stone-400">
            <Loader2 size={12} className="animate-spin" />
            Chargement des logs…
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-stone-500">Aucune ligne à afficher.</p>
        ) : (
          filtered.map((log) => <LogLineView key={log.seq} log={log} />)
        )}
        <div ref={bottomRef} />
      </div>
    </Card>
  );
}

function LogLineView({ log, compact = false }: { log: LogLine; compact?: boolean }) {
  const tone =
    log.stream === 'stderr'
      ? 'text-red-300'
      : log.stream === 'system'
        ? 'text-emerald-300'
        : log.stream === 'install'
          ? 'text-amber-300'
          : 'text-stone-200';
  return (
    <div className="flex gap-2 whitespace-pre-wrap break-words">
      {!compact ? (
        <span className="shrink-0 select-none text-stone-500">{formatClock(log.ts)}</span>
      ) : null}
      <span className={`shrink-0 select-none uppercase ${tone} opacity-70`}>
        {log.stream}
      </span>
      <span className={tone}>{log.line}</span>
    </div>
  );
}

/* -------------------------------------------------------------- fichiers */

function FilesTab({ botId }: { botId: string }) {
  const { theme } = useApp();
  const toast = useToast();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [creating, setCreating] = useState(false);

  const loadFiles = useCallback(async () => {
    try {
      const list = await api.listBotFiles(botId);
      setEntries(list.filter((entry) => !entry.is_dir));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoadingFiles(false);
    }
  }, [botId]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const openFile = useCallback(
    async (path: string) => {
      setSelected(path);
      setLoadingFile(true);
      setError(null);
      try {
        const value = await api.readBotFile(botId, path);
        setContent(value);
        setOriginal(value);
      } catch (cause) {
        setContent('');
        setOriginal('');
        setError(errorMessage(cause));
      } finally {
        setLoadingFile(false);
      }
    },
    [botId],
  );

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await api.writeBotFile(botId, selected, content);
      setOriginal(content);
      await loadFiles();
      toast.success('Fichier enregistré.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const createFile = async () => {
    const path = newPath.trim();
    if (!path) return;
    setCreating(true);
    try {
      await api.writeBotFile(botId, path, '');
      setNewOpen(false);
      setNewPath('');
      await loadFiles();
      await openFile(path);
      toast.success('Fichier créé.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  };

  const dirty = content !== original;

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <Card className="flex max-h-[calc(100vh-15rem)] min-h-72 flex-col overflow-hidden">
        <CardHeader
          title="Fichiers"
          actions={
            <IconButton label="Nouveau fichier" onClick={() => setNewOpen(true)}>
              <FilePlus2 size={14} />
            </IconButton>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {loadingFiles ? (
            <Spinner label="Chargement…" />
          ) : entries.length === 0 ? (
            <p className="px-2 py-4 text-xs text-fg-muted">Aucun fichier.</p>
          ) : (
            entries.map((entry) => {
              const active = entry.path === selected;
              return (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => void openFile(entry.path)}
                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
                    active
                      ? 'bg-accent-soft text-accent-soft-fg'
                      : 'text-fg-muted hover:bg-sunken hover:text-fg'
                  }`}
                >
                  <FileCode2 size={13} className="shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate font-mono text-2xs">
                    {entry.path}
                  </span>
                  <span className="shrink-0 text-2xs text-fg-subtle">
                    {formatBytes(entry.size)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </Card>

      <Card className="flex min-h-72 flex-col overflow-hidden">
        <CardHeader
          title={
            selected ? (
              <span className="font-mono text-xs">{selected}</span>
            ) : (
              'Éditeur'
            )
          }
          description={
            selected
              ? `${languageForFile(selected)}${dirty ? ' · modifications non enregistrées' : ''}`
              : 'Sélectionnez un fichier pour l’éditer.'
          }
          actions={
            <Button
              size="sm"
              variant="primary"
              icon={<Save size={13} />}
              loading={saving}
              disabled={!selected || !dirty}
              onClick={save}
            >
              Enregistrer
            </Button>
          }
        />
        <div className="h-[calc(100vh-19rem)] min-h-72">
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-muted">
              <FileCode2 size={26} className="text-fg-subtle" />
              <p className="text-xs">Choisissez un fichier dans la liste.</p>
            </div>
          ) : loadingFile ? (
            <Spinner label="Ouverture du fichier…" />
          ) : (
            <Editor
              path={selected}
              language={languageForFile(selected)}
              value={content}
              onChange={(value) => setContent(value ?? '')}
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              options={{
                fontSize: 12,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: 'on',
                padding: { top: 12, bottom: 12 },
                renderLineHighlight: 'line',
              }}
            />
          )}
        </div>
        {error ? (
          <div className="border-t border-line px-4 py-2">
            <InlineError message={error} />
          </div>
        ) : null}
      </Card>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Nouveau fichier"
        description="Chemin relatif au dossier du bot, par exemple src/commands/ping.ts."
        footer={
          <>
            <Button onClick={() => setNewOpen(false)} disabled={creating}>
              Annuler
            </Button>
            <Button
              variant="primary"
              icon={<FilePlus2 size={13} />}
              loading={creating}
              disabled={!newPath.trim()}
              onClick={createFile}
            >
              Créer
            </Button>
          </>
        }
      >
        <Field label="Chemin du fichier">
          <Input
            value={newPath}
            onChange={(event) => setNewPath(event.target.value)}
            placeholder="src/commands/hello.ts"
            autoFocus
            spellCheck={false}
          />
        </Field>
        <div className="mt-3">
          <InlineError message={error} />
        </div>
      </Modal>
    </div>
  );
}

/* --------------------------------------------------------------- réglages */

function SettingsTab({ bot, onChanged }: { bot: BotSummary; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(bot.name);
  const [autoStart, setAutoStart] = useState(bot.auto_start);
  const [policy, setPolicy] = useState(bot.restart_policy);
  const [memory, setMemory] = useState(String(bot.memory_limit_mb ?? 1024));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const parsedMemory = Number.parseInt(memory, 10);
    setSaving(true);
    setError(null);
    try {
      await api.updateBot(bot.id, {
        name: name.trim(),
        auto_start: autoStart,
        restart_policy: policy,
        memory_limit_mb: Number.isFinite(parsedMemory) ? parsedMemory : undefined,
      });
      await onChanged();
      toast.success('Réglages enregistrés.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Comportement" description="Ces réglages sont propres à ce bot." />
        <div className="flex flex-col gap-3 px-4 py-4">
          <Field label="Nom">
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} />
          </Field>
          <Field label="Politique de redémarrage">
            <Select
              value={policy}
              onChange={(event) => setPolicy(event.target.value as typeof policy)}
            >
              <option value="on_failure">En cas d’échec</option>
              <option value="always">Toujours</option>
              <option value="never">Jamais</option>
            </Select>
          </Field>
          <Field
            label="Limite mémoire (Mo)"
            hint="Best-effort : appliquée au processus et à ses enfants, sans sandbox de sécurité."
          >
            <Input
              type="number"
              min={128}
              max={8192}
              step={128}
              value={memory}
              onChange={(event) => setMemory(event.target.value)}
            />
          </Field>
          <div className="rounded-ctl border border-line px-3">
            <Switch
              checked={autoStart}
              onChange={setAutoStart}
              label="Démarrer avec l’application"
              description="Relance automatique au démarrage de Zenode Host."
            />
          </div>
          <InlineError message={error} />
          <div className="flex justify-end">
            <Button variant="primary" icon={<Save size={13} />} loading={saving} onClick={save}>
              Enregistrer
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Informations" description="Métadonnées du bot local." />
        <div className="px-4 py-3">
          <KeyValue label="Identifiant">
            <span className="font-mono">{bot.id}</span>
          </KeyValue>
          <KeyValue label="Origine">{humanOrigin(bot.origin)}</KeyValue>
          <KeyValue label="Entrée">
            <span className="font-mono">{bot.entry}</span>
          </KeyValue>
          <KeyValue label="Version">{bot.version ?? '—'}</KeyValue>
          <KeyValue label="Propriétaire">{bot.owner ?? 'vous'}</KeyValue>
          <KeyValue label="Créé le">{formatDate(bot.created_at)}</KeyValue>
          <KeyValue label="Modifié le">{formatDate(bot.updated_at)}</KeyValue>
        </div>
        <div className="border-t border-line px-4 py-3">
          <InlineNote>
            <span className="flex items-start gap-1.5">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" />
              L’hôte qui exécute un bot peut lire son jeton dans l’environnement du
              processus. N’hébergez que des bots de confiance et préférez des comptes
              Discord dédiés.
            </span>
          </InlineNote>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- utilitaires */

function toneForStatus(status: string): 'neutral' | 'success' | 'warn' | 'danger' | 'accent' {
  if (status === 'running') return 'success';
  if (status === 'starting' || status === 'stopping') return 'warn';
  if (status === 'crashed' || status === 'error') return 'danger';
  return 'neutral';
}
