import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import {
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  Laptop,
  Link2,
  LogOut,
  Power,
  PowerOff,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { api, errorMessage } from '../lib/api';
import { DEFAULT_CORE_URL } from '../lib/constants';
import { formatBytes, formatDate, formatRelative } from '../lib/format';
import { useApp, useToast } from '../lib/store';
import type { RuntimeProgress, Settings, UpdateInfo } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DangerButton,
  Field,
  InlineError,
  InlineNote,
  Input,
  KeyValue,
  Progress,
  Spinner,
  Switch,
} from '../components/ui';

export function SettingsPage() {
  const { info, reload, authenticated, runtimeInstalled } = useApp();
  const toast = useToast();
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<RuntimeProgress | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (info?.settings && form === null) setForm(info.settings);
  }, [info?.settings, form]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    void listen<RuntimeProgress>('runtime://progress', (event) => {
      setProgress(event.payload);
    }).then((unlisten) => unlisteners.push(unlisten));
    return () => unlisteners.forEach((unlisten) => unlisten());
  }, []);

  if (!form) return <Spinner label="Chargement des réglages…" />;

  const patch = (partial: Partial<Settings>) => setForm((current) => (current ? { ...current, ...partial } : current));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveSettings({
        ...form,
        core_url: form.core_url.trim() || DEFAULT_CORE_URL,
        max_concurrent_bots: clampNumber(form.max_concurrent_bots, 1, 32, 4),
        default_memory_limit_mb: clampNumber(form.default_memory_limit_mb, 128, 8192, 1024),
        heartbeat_secs: clampNumber(form.heartbeat_secs, 10, 600, 20),
      });
      setForm(saved);
      await reload();
      toast.success('Réglages enregistrés.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const installRuntime = async () => {
    setInstalling(true);
    setRuntimeError(null);
    setProgress({ phase: 'download', received: 0, total: 0, percent: 0 });
    try {
      await api.installRuntime();
      await reload();
      toast.success('Runtime installé et vérifié.');
    } catch (cause) {
      setRuntimeError(errorMessage(cause));
    } finally {
      setInstalling(false);
    }
  };

  const checkUpdates = async () => {
    setChecking(true);
    try {
      const result = await api.checkUpdates();
      setUpdate(result);
      if (!result) toast.info('Zenode Host est à jour.');
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setChecking(false);
    }
  };

  const downloadUrl = update
    ? update.downloads[`${info?.os}-${info?.arch}`] ??
      update.downloads[info?.os ?? ''] ??
      Object.values(update.downloads)[0]
    : undefined;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Réglages</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Configuration de la machine, du runtime et du compte lié à Zenode Host.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Général"
              description="Connexion au Core et limites par défaut."
              actions={<Settings2 size={15} className="text-fg-subtle" />}
            />
            <div className="flex flex-col gap-3 px-4 py-4">
              <Field
                label="URL du Core"
                hint="HTTPS obligatoire, sauf en local. Par défaut : https://zenode.fr."
              >
                <Input
                  value={form.core_url}
                  onChange={(event) => patch({ core_url: event.target.value })}
                  placeholder={DEFAULT_CORE_URL}
                  spellCheck={false}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Bots simultanés" hint="Capacité annoncée au Core.">
                  <Input
                    type="number"
                    min={1}
                    max={32}
                    value={form.max_concurrent_bots}
                    onChange={(event) =>
                      patch({ max_concurrent_bots: Number.parseInt(event.target.value, 10) || 1 })
                    }
                  />
                </Field>
                <Field label="Mémoire par défaut (Mo)">
                  <Input
                    type="number"
                    min={128}
                    max={8192}
                    step={128}
                    value={form.default_memory_limit_mb}
                    onChange={(event) =>
                      patch({
                        default_memory_limit_mb: Number.parseInt(event.target.value, 10) || 1024,
                      })
                    }
                  />
                </Field>
              </div>
              <Field
                label="Intervalle de heartbeat (secondes)"
                hint="Minimum 10 s. Utilisé pour l’affectation et la reprise après panne."
              >
                <Input
                  type="number"
                  min={10}
                  max={600}
                  step={5}
                  value={form.heartbeat_secs}
                  onChange={(event) =>
                    patch({ heartbeat_secs: Number.parseInt(event.target.value, 10) || 20 })
                  }
                />
              </Field>
              <InlineError message={error} />
              <div className="flex justify-end">
                <Button variant="primary" loading={saving} onClick={save}>
                  Enregistrer les réglages
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Démarrage et fenêtre" description="Comportement de l’application." />
            <div className="divide-y divide-line px-4">
              <Switch
                checked={form.launch_at_login}
                onChange={(value) => patch({ launch_at_login: value })}
                label="Lancer au démarrage de la session"
                description="Ouvre Zenode Host automatiquement à l’ouverture de session."
              />
              <Switch
                checked={form.close_to_tray}
                onChange={(value) => patch({ close_to_tray: value })}
                label="Fermer vers la barre système"
                description="Les bots continuent de tourner quand la fenêtre est fermée."
              />
              <Switch
                checked={form.minimize_to_tray}
                onChange={(value) => patch({ minimize_to_tray: value })}
                label="Réduire vers la barre système"
                description="Masque la fenêtre lors d’une réduction."
              />
              <Switch
                checked={form.auto_update}
                onChange={(value) => patch({ auto_update: value })}
                label="Vérifier les mises à jour"
                description="Signale les nouvelles versions de Zenode Host."
              />
            </div>
            <div className="flex justify-end border-t border-line px-4 py-3">
              <Button variant="primary" loading={saving} onClick={save}>
                Enregistrer
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Mises à jour"
              description="Les mises à jour sont publiées sur zenode.fr et vérifiées par le Core."
              actions={
                <Button
                  size="sm"
                  icon={<RefreshCw size={13} className={checking ? 'animate-spin' : ''} />}
                  loading={checking}
                  onClick={checkUpdates}
                >
                  Vérifier
                </Button>
              }
            />
            <div className="px-4 py-3">
              {update ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">Zenode Host {update.version}</p>
                      <p className="text-2xs text-fg-muted">
                        publiée {formatRelative(update.published_at)}
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Download size={13} />}
                      disabled={!downloadUrl}
                      onClick={() => downloadUrl && void api.openUrl(downloadUrl)}
                    >
                      Télécharger
                    </Button>
                  </div>
                  {update.notes ? (
                    <p className="whitespace-pre-wrap rounded-ctl border border-line bg-sunken px-3 py-2 text-xs text-fg-muted">
                      {update.notes}
                    </p>
                  ) : null}
                  {!downloadUrl ? (
                    <p className="text-2xs text-warn-fg">
                      Aucun téléchargement disponible pour {info?.os}/{info?.arch}.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-fg-muted">
                    Vous utilisez la version {info?.version ?? '—'}. Les mises à jour ne
                    remplacent jamais vos bots ni leurs jetons.
                  </p>
                  <Sparkles size={16} className="shrink-0 text-fg-subtle" />
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Compte"
              description="Session liée au Core Zenode."
              actions={
                <Badge tone={authenticated ? 'success' : 'outline'} dot={authenticated}>
                  {authenticated ? 'lié' : 'non lié'}
                </Badge>
              }
            />
            {authenticated && info?.auth.user ? (
              <div className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {info.auth.user.avatar_url ? (
                    <img
                      src={info.auth.user.avatar_url}
                      alt=""
                      className="h-10 w-10 rounded-full border border-line object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-soft-fg">
                      {info.auth.user.display_name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{info.auth.user.display_name}</p>
                    <p className="truncate text-2xs text-fg-muted">
                      {info.auth.user.username ? `@${info.auth.user.username}` : info.auth.user.id}
                    </p>
                  </div>
                </div>
                <div className="mt-3 border-t border-line pt-2">
                  <KeyValue label="Machine">
                    {info.host ? info.host.name : 'non enregistrée'}
                  </KeyValue>
                  <KeyValue label="Hôte">
                    <span className="font-mono text-2xs">
                      {info.auth.host_id ?? info.host?.host_id ?? '—'}
                    </span>
                  </KeyValue>
                  <KeyValue label="Appareil">
                    <span className="font-mono text-2xs">{info.auth.device_id ?? '—'}</span>
                  </KeyValue>
                  <KeyValue label="Session expire">{formatDate(info.auth.expires_at)}</KeyValue>
                  <KeyValue label="Dernière synchro">{formatRelative(info.last_sync)}</KeyValue>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Button
                    size="sm"
                    icon={<RefreshCw size={13} />}
                    onClick={async () => {
                      try {
                        await api.syncNow();
                        await reload();
                        toast.success('Synchronisation effectuée.');
                      } catch (cause) {
                        toast.error(errorMessage(cause));
                      }
                    }}
                  >
                    Synchroniser
                  </Button>
                  <Button
                    size="sm"
                    icon={<LogOut size={13} />}
                    loading={loggingOut}
                    onClick={async () => {
                      setLoggingOut(true);
                      try {
                        await api.authLogout();
                        await reload();
                        toast.info('Compte délié de cette machine.');
                      } catch (cause) {
                        toast.error(errorMessage(cause));
                      } finally {
                        setLoggingOut(false);
                      }
                    }}
                  >
                    Déconnexion
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 px-4 py-4">
                <p className="text-xs text-fg-muted">
                  Liez votre compte pour synchroniser les clusters, le catalogue et les
                  affectations. Vos bots locaux continuent de fonctionner sans compte.
                </p>
                <Link
                  to="/onboarding"
                  className="inline-flex h-8 w-fit items-center gap-1.5 rounded-ctl bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover"
                >
                  <Link2 size={13} />
                  Lier mon compte
                </Link>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Runtime des bots"
              description="Bun épinglé, téléchargé et vérifié par SHA-256."
              actions={
                <Badge tone={runtimeInstalled ? 'success' : 'warn'} dot>
                  {runtimeInstalled ? 'installé' : 'absent'}
                </Badge>
              }
            />
            <div className="px-4 py-3">
              <KeyValue label="Version épinglée">
                {info?.runtime.pinned_version ?? '—'}
              </KeyValue>
              <KeyValue label="Version installée">{info?.runtime.version ?? '—'}</KeyValue>
              <KeyValue label="Taille">
                {info?.runtime.size_bytes ? formatBytes(info.runtime.size_bytes) : '—'}
              </KeyValue>
              <KeyValue label="Chemin">
                <span className="font-mono text-2xs">{info?.runtime.path ?? '—'}</span>
              </KeyValue>
              {installing && progress ? (
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between text-2xs text-fg-muted">
                    <span>
                      {progress.phase === 'extract' ? 'Extraction…' : 'Téléchargement…'}
                    </span>
                    <span>{progress.percent.toFixed(0)} %</span>
                  </div>
                  <Progress value={progress.percent} />
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-2xs text-fg-muted">
                  <ShieldCheck size={13} className="text-success" />
                  empreinte vérifiée
                </div>
                <Button
                  size="sm"
                  icon={<Download size={13} />}
                  loading={installing}
                  onClick={installRuntime}
                >
                  {runtimeInstalled ? 'Réinstaller' : 'Installer'}
                </Button>
              </div>
              <div className="mt-2">
                <InlineError message={runtimeError} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="À propos" description="Informations de l’application et chemins locaux." />
            <div className="px-4 py-3">
              <KeyValue label="Version">{info?.version ?? '—'}</KeyValue>
              <KeyValue label="Système">
                {info?.os}/{info?.arch}
              </KeyValue>
              <KeyValue label="Démarrage auto">
                {info?.autostart ? 'activé' : 'désactivé'}
              </KeyValue>
              <KeyValue label="Données">
                <span className="font-mono text-2xs">{info?.paths.data ?? '—'}</span>
              </KeyValue>
              <KeyValue label="Bots">
                <span className="font-mono text-2xs">{info?.paths.bots ?? '—'}</span>
              </KeyValue>
              <KeyValue label="Logs">
                <span className="font-mono text-2xs">{info?.paths.logs ?? '—'}</span>
              </KeyValue>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <Button
                  size="sm"
                  icon={<FolderOpen size={13} />}
                  onClick={() => void api.openLogsFolder()}
                >
                  Ouvrir les logs
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ExternalLink size={13} />}
                  onClick={() => void api.openUrl('https://zenode.fr')}
                >
                  zenode.fr
                </Button>
                <Link
                  to="/onboarding"
                  className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line px-2.5 text-xs font-medium text-fg-muted hover:bg-sunken hover:text-fg"
                >
                  <Laptop size={12} />
                  Reconfigurer
                </Link>
                <DangerButton
                  size="sm"
                  label="Quitter l’application"
                  confirmLabel="Quitter maintenant"
                  icon={<PowerOff size={13} />}
                  onConfirm={() => api.quit()}
                />
              </div>
            </div>
          </Card>

          <InlineNote>
            <span className="flex items-start gap-1.5">
              <Database size={13} className="mt-0.5 shrink-0" />
              Les bots et leurs jetons restent sur cette machine. Le Core ne reçoit que
              les métriques, les affectations et les jetons scellés pour l’hôte ciblé.
            </span>
          </InlineNote>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-2xs text-fg-subtle">
        <Server size={12} />
        Core : {info?.core_url ?? DEFAULT_CORE_URL} · dernier contact {formatRelative(info?.last_sync)}
        <Power size={12} className="ml-2" />
        Les bots sont arrêtés proprement à la fermeture de l’application.
      </div>
    </>
  );
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
