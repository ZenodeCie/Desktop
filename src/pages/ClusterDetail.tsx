import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Bot as BotIcon,
  ChevronRight,
  Cpu,
  Globe,
  KeyRound,
  Lock,
  Network,
  RefreshCw,
  Server,
  ShieldAlert,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';

import { api, errorMessage } from '../lib/api';
import {
  formatMegabytes,
  formatPercent,
  formatRelative,
  humanStatus,
} from '../lib/format';
import { useApp, useToast } from '../lib/store';
import type { ClusterBot, ClusterDetail } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CopyButton,
  DangerButton,
  EmptyState,
  Field,
  InlineError,
  InlineNote,
  Modal,
  PageHeader,
  Select,
  Spinner,
  StatTile,
  StatusDot,
  Textarea,
} from '../components/ui';

type BotAction = { type: 'assign' | 'report'; bot: ClusterBot } | null;

export function ClusterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { authenticated } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ClusterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [action, setAction] = useState<BotAction>(null);

  const load = useCallback(async () => {
    if (!id || !authenticated) {
      setLoading(false);
      return;
    }
    try {
      const next = await api.clusterDetail(id);
      setDetail(next);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [id, authenticated]);

  useEffect(() => {
    void load();
    if (!id || !authenticated) return;
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load, id, authenticated]);

  if (!authenticated) {
    return (
      <EmptyState
        icon={<Lock size={20} />}
        title="Compte non lié"
        description="Liez votre compte Zenode pour consulter ce cluster."
        action={
          <Link to="/onboarding" className="text-xs font-medium text-accent hover:underline">
            Lier mon compte
          </Link>
        }
      />
    );
  }

  if (loading && !detail) return <Spinner label="Chargement du cluster…" />;

  if (error && !detail) {
    return (
      <div className="flex flex-col items-start gap-3">
        <InlineError message={error} />
        <div className="flex gap-2">
          <Button icon={<RefreshCw size={13} />} onClick={() => void load()}>
            Réessayer
          </Button>
          <Button variant="ghost" onClick={() => navigate('/clusters')}>
            Retour
          </Button>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const isOwner = detail.role === 'owner';
  const canModerate = isOwner || detail.role === 'admin';

  const createInvite = async () => {
    setInviteBusy(true);
    try {
      const result = await api.createClusterInvite(detail.cluster_id);
      const code = result.code ?? result.invite_code ?? null;
      if (code) setInvite(code);
      await load();
      if (!code) toast.success('Invitation créée.');
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setInviteBusy(false);
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center gap-1.5 text-2xs text-fg-subtle">
        <Link to="/clusters" className="hover:text-fg">
          Clusters
        </Link>
        <ChevronRight size={11} />
        <span className="truncate text-fg-muted">{detail.name}</span>
      </div>

      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={detail.visibility === 'public' ? 'info' : 'outline'}>
              {detail.visibility === 'public' ? (
                <>
                  <Globe size={11} /> Public
                </>
              ) : (
                <>
                  <Lock size={11} /> Privé
                </>
              )}
            </Badge>
            <Badge tone="neutral">{detail.role}</Badge>
            {detail.is_community ? <Badge tone="warn">Communauté</Badge> : null}
            {detail.has_custom_code ? <Badge tone="accent">Code modifié</Badge> : null}
            {detail.backup_enabled ? <Badge tone="success">Backup 48 h</Badge> : null}
            <Badge tone={detail.health === 'healthy' ? 'success' : 'warn'} dot>
              {humanStatus(detail.health)}
            </Badge>
          </div>
        }
        title={detail.name}
        description={detail.description || 'Aucune description.'}
        actions={
          <>
            <Button
              icon={<UserPlus size={13} />}
              loading={inviteBusy}
              disabled={!canModerate}
              title={canModerate ? 'Créer un code d’invitation' : 'Réservé aux administrateurs'}
              onClick={createInvite}
            >
              Inviter
            </Button>
            {isOwner ? (
              <DangerButton
                label="Supprimer"
                confirmLabel="Confirmer"
                icon={<Trash2 size={13} />}
                onConfirm={async () => {
                  try {
                    await api.deleteCluster(detail.cluster_id);
                    toast.success('Cluster supprimé.');
                    navigate('/clusters');
                  } catch (cause) {
                    toast.error(errorMessage(cause));
                  }
                }}
              />
            ) : (
              <DangerButton
                label="Quitter"
                confirmLabel="Confirmer"
                icon={<UserMinus size={13} />}
                onConfirm={async () => {
                  try {
                    await api.leaveCluster(detail.cluster_id);
                    toast.success('Vous avez quitté le cluster.');
                    navigate('/clusters');
                  } catch (cause) {
                    toast.error(errorMessage(cause));
                  }
                }}
              />
            )}
          </>
        }
      />

      {detail.invite_code ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-accent-soft px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs text-accent-soft-fg">
            <KeyRound size={14} />
            Code d’invitation actif :
            <span className="font-mono font-semibold tracking-wider">{detail.invite_code}</span>
          </div>
          <CopyButton value={detail.invite_code} label="Copier le code" />
        </div>
      ) : null}

      {detail.is_community && detail.visibility === 'public' ? (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-xs text-warn-fg">
          Ce VM Worker appartient à un particulier. Il n’est ni exploité ni supervisé par
          Zenode : n’hébergez que des bots dont vous acceptez le code et l’origine.
        </div>
      ) : null}

      {detail.has_custom_code ? (
        <div className="mb-4 rounded-lg border border-accent/40 bg-accent-soft px-4 py-2.5 text-xs text-accent-soft-fg">
          Ce VM Worker utilise un code de bot modifié. Il est séparé des clusters classiques
          et n’a pas été vérifié par Zenode.
        </div>
      ) : null}

      {error ? <InlineError message={error} /> : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Hôtes"
          value={detail.host_count}
          hint={`${detail.hosts.filter((host) => host.status === 'online').length} en ligne`}
          icon={<Server size={15} />}
        />
        <StatTile
          label="Bots"
          value={detail.bot_count}
          hint={`${detail.online_bots} en ligne`}
          icon={<BotIcon size={15} />}
        />
        <StatTile label="Membres" value={detail.member_count} icon={<Users size={15} />} />
        <StatTile
          label="Visibilité"
          value={detail.visibility === 'public' ? 'Public' : 'Privé'}
          hint={detail.visibility === 'public' ? 'modéré' : 'sur invitation'}
          icon={detail.visibility === 'public' ? <Globe size={15} /> : <Lock size={15} />}
        />
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            title="Machines"
            description="Hôtes qui exécutent les bots du cluster."
            actions={<Badge tone="outline">{detail.hosts.length}</Badge>}
          />
          {detail.hosts.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-fg-muted">
              Aucune machine pour le moment. Installez Zenode Host et liez-la au cluster.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-xs">
                <thead className="border-b border-line text-2xs uppercase tracking-wider text-fg-subtle">
                  <tr>
                    <th className="px-4 py-2 font-medium">Machine</th>
                    <th className="px-3 py-2 font-medium">Système</th>
                    <th className="px-3 py-2 font-medium">Statut</th>
                    <th className="px-3 py-2 font-medium">Bots</th>
                    <th className="px-3 py-2 font-medium">CPU</th>
                    <th className="px-3 py-2 font-medium">RAM</th>
                    <th className="px-4 py-2 font-medium">Vu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {detail.hosts.map((host) => (
                    <tr key={host.host_id} className="hover:bg-sunken/50">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <StatusDot status={host.status} />
                          <span className="font-medium text-fg">{host.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-fg-muted">
                        {host.os}/{host.arch}
                        {host.version ? ` · v${host.version}` : ''}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={host.status === 'online' ? 'success' : 'warn'}>
                          {humanStatus(host.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{host.bots}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatPercent(host.cpu_percent, 0)}</td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {formatMegabytes(host.memory_used_mb)} / {formatMegabytes(host.memory_total_mb)}
                      </td>
                      <td className="px-4 py-2.5 text-fg-muted">{formatRelative(host.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Bots du cluster"
            description="Affectez un bot à une machine ou laissez le Core choisir selon la charge."
            actions={<Badge tone="outline">{detail.bots.length}</Badge>}
          />
          {detail.bots.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-fg-muted">
              Aucun bot déployé. Ouvrez un bot local et utilisez « Déployer » dans son aperçu.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-left text-xs">
                <thead className="border-b border-line text-2xs uppercase tracking-wider text-fg-subtle">
                  <tr>
                    <th className="px-4 py-2 font-medium">Bot</th>
                    <th className="px-3 py-2 font-medium">Propriétaire</th>
                    <th className="px-3 py-2 font-medium">Hôte</th>
                    <th className="px-3 py-2 font-medium">Statut</th>
                    <th className="px-3 py-2 font-medium">Modération</th>
                    <th className="px-4 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {detail.bots.map((bot) => (
                    <tr key={bot.bot_id} className="hover:bg-sunken/50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-fg">{bot.name}</p>
                        <p className="font-mono text-2xs text-fg-subtle">{bot.bot_id}</p>
                      </td>
                      <td className="px-3 py-2.5 text-fg-muted">
                        {bot.owner_name ?? bot.owner_user_id}
                      </td>
                      <td className="px-3 py-2.5 text-fg-muted">
                        {bot.host_name ?? (
                          <span className="italic text-fg-subtle">non affecté</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={bot.status === 'running' ? 'success' : 'neutral'} dot>
                          {humanStatus(bot.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        {bot.moderation && bot.moderation !== 'ok' ? (
                          <Badge tone="danger">{bot.moderation}</Badge>
                        ) : (
                          <span className="text-2xs text-fg-subtle">ok</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            icon={<Network size={12} />}
                            disabled={!canModerate || detail.hosts.length === 0}
                            onClick={() => setAction({ type: 'assign', bot })}
                          >
                            Affecter
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<ShieldAlert size={12} />}
                            onClick={() => setAction({ type: 'report', bot })}
                            title="Signaler"
                            aria-label="Signaler"
                          />
                          <DangerButton
                            size="sm"
                            label="Retirer"
                            confirmLabel="Confirmer"
                            onConfirm={async () => {
                              try {
                                await api.removeClusterBot(detail.cluster_id, bot.bot_id);
                                toast.success('Bot retiré du cluster.');
                                await load();
                              } catch (cause) {
                                toast.error(errorMessage(cause));
                              }
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Membres"
            description="Les membres peuvent publier des bots et affecter leurs machines."
            actions={<Badge tone="outline">{detail.members.length}</Badge>}
          />
          <div className="divide-y divide-line">
            {detail.members.map((member) => (
              <div
                key={`${member.user_id}-${member.host_id ?? 'none'}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-soft-fg">
                    {member.display_name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="font-medium text-fg">{member.display_name}</span>
                  <Badge tone="neutral">{member.role}</Badge>
                </div>
                <div className="flex items-center gap-3 text-2xs text-fg-subtle">
                  {member.host_id ? (
                    <span className="flex items-center gap-1">
                      <Cpu size={11} />
                      {member.host_id}
                    </span>
                  ) : null}
                  <span>depuis {formatRelative(member.joined_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {detail.visibility === 'public' ? (
          <InlineNote>
            <span className="flex items-start gap-1.5">
              <Globe size={13} className="mt-0.5 shrink-0" />
              Ce cluster est public : les bots déployés sont visibles dans le catalogue.
              Les administrateurs peuvent signaler, bloquer et retirer un bot.
            </span>
          </InlineNote>
        ) : null}
      </div>

      <BotActionModal
        action={action}
        detail={detail}
        canModerate={canModerate}
        onClose={() => setAction(null)}
        onDone={async () => {
          setAction(null);
          await load();
        }}
      />

      <Modal
        open={Boolean(invite)}
        onClose={() => setInvite(null)}
        title="Code d’invitation"
        description="Partagez ce code avec la personne à inviter. Il peut expirer côté Core."
        footer={<Button onClick={() => setInvite(null)}>Fermer</Button>}
      >
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-sunken px-4 py-3">
          <span className="font-mono text-lg font-semibold tracking-[0.15em]">
            {invite ?? ''}
          </span>
          {invite ? <CopyButton value={invite} /> : null}
        </div>
      </Modal>
    </>
  );
}

function BotActionModal({
  action,
  detail,
  canModerate,
  onClose,
  onDone,
}: {
  action: BotAction;
  detail: ClusterDetail;
  canModerate: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [hostId, setHostId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHostId('');
    setReason('');
    setError(null);
    setBusy(false);
  }, [action]);

  if (!action) return null;

  const run = async (kind: 'assign' | 'report' | 'block') => {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'assign') {
        await api.assignClusterBot(detail.cluster_id, action.bot.bot_id, hostId || undefined);
        toast.success('Affectation enregistrée.');
      } else if (kind === 'report') {
        await api.reportClusterBot(detail.cluster_id, action.bot.bot_id, reason.trim());
        toast.success('Signalement envoyé.');
      } else {
        await api.blockClusterBot(detail.cluster_id, action.bot.bot_id, reason.trim());
        toast.success('Bot bloqué dans le cluster.');
      }
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (action.type === 'assign') {
    return (
      <Modal
        open
        onClose={onClose}
        title={`Affecter ${action.bot.name}`}
        description="Choisissez la machine qui exécutera ce bot. Le jeton sera scellé pour sa clé publique."
        footer={
          <>
            <Button onClick={onClose} disabled={busy}>
              Annuler
            </Button>
            <Button
              variant="primary"
              icon={<Network size={13} />}
              loading={busy}
              onClick={() => void run('assign')}
            >
              Affecter
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Machine">
            <Select value={hostId} onChange={(event) => setHostId(event.target.value)}>
              <option value="">Sélection automatique</option>
              {detail.hosts.map((host) => (
                <option key={host.host_id} value={host.host_id}>
                  {host.name} · {humanStatus(host.status)}
                </option>
              ))}
            </Select>
          </Field>
          <InlineNote>
            L’hôte reçoit l’affectation au prochain heartbeat, puis démarre le bot. Une
            machine hors ligne recevra l’affectation à son retour.
          </InlineNote>
          <InlineError message={error} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Signaler ${action.bot.name}`}
      description="Le signalement est transmis aux administrateurs du cluster. Le blocage est immédiat et réservé à la modération."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          {canModerate ? (
            <Button
              variant="danger"
              icon={<ShieldAlert size={13} />}
              loading={busy}
              disabled={reason.trim().length < 5}
              onClick={() => void run('block')}
            >
              Bloquer
            </Button>
          ) : null}
          <Button
            variant="primary"
            icon={<ShieldAlert size={13} />}
            loading={busy}
            disabled={reason.trim().length < 5}
            onClick={() => void run('report')}
          >
            Signaler
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Motif" hint="Décrivez le problème (5 caractères minimum).">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Spam, contenu interdit, comportement anormal…"
            autoFocus
          />
        </Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}
