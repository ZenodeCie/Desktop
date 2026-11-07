import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Boxes,
  ChevronRight,
  Globe,
  Lock,
  Plus,
  RefreshCw,
  Users,
  UserPlus,
} from 'lucide-react';

import { api, errorMessage } from '../lib/api';
import { humanStatus } from '../lib/format';
import { useApp, useToast } from '../lib/store';
import type { ClusterSummary } from '../lib/types';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  InlineError,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  StatusDot,
  Textarea,
} from '../components/ui';

export function ClustersPage() {
  const { authenticated } = useApp();
  const toast = useToast();
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  const load = useCallback(async () => {
    if (!authenticated) {
      setClusters([]);
      setLoading(false);
      return;
    }
    try {
      const list = await api.listClusters();
      setClusters(list);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    void load();
    if (!authenticated) return;
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load, authenticated]);

  return (
    <>
      <PageHeader
        title="Clusters"
        description="Un cluster relie plusieurs machines et membres pour héberger des bots ensemble. Les clusters privés s’invitent par code ; les clusters publics sont modérés."
        actions={
          authenticated ? (
            <>
              <Button icon={<UserPlus size={14} />} onClick={() => setJoinOpen(true)}>
                Rejoindre
              </Button>
              <Button
                variant="primary"
                icon={<Plus size={14} />}
                onClick={() => setCreateOpen(true)}
              >
                Créer un cluster
              </Button>
            </>
          ) : null
        }
      />

      {!authenticated ? (
        <EmptyState
          icon={<Boxes size={20} />}
          title="Liez votre compte pour utiliser les clusters"
          description="Les clusters synchronisent vos machines, les affectations de bots et les membres. La liaison se fait en deux clics depuis la configuration."
          action={
            <Link
              to="/onboarding"
              className="inline-flex h-8 items-center gap-1.5 rounded-ctl bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              Lier mon compte
            </Link>
          }
        />
      ) : loading ? (
        <Spinner label="Chargement des clusters…" />
      ) : error ? (
        <div className="flex flex-col items-start gap-3">
          <InlineError message={error} />
          <Button icon={<RefreshCw size={13} />} onClick={() => void load()}>
            Réessayer
          </Button>
        </div>
      ) : clusters.length === 0 ? (
        <EmptyState
          icon={<Boxes size={20} />}
          title="Aucun cluster"
          description="Créez un cluster privé pour vos propres machines, ou rejoignez un cluster avec un code d’invitation."
          action={
            <div className="flex gap-2">
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
                Créer un cluster
              </Button>
              <Button icon={<UserPlus size={14} />} onClick={() => setJoinOpen(true)}>
                Rejoindre
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {clusters.map((cluster) => (
            <Link
              key={cluster.cluster_id}
              to={`/clusters/${cluster.cluster_id}`}
              className="group flex flex-col rounded-lg border border-line bg-surface p-4 shadow-raised transition-colors hover:border-line-strong"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-soft-fg">
                    {cluster.visibility === 'public' ? <Globe size={15} /> : <Lock size={15} />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{cluster.name}</p>
                    <p className="truncate font-mono text-2xs text-fg-subtle">
                      {cluster.slug || cluster.cluster_id}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge tone={cluster.visibility === 'public' ? 'info' : 'outline'}>
                    {cluster.visibility === 'public' ? 'Public' : 'Privé'}
                  </Badge>
                  <Badge tone="neutral">{cluster.role}</Badge>
                  <ChevronRight
                    size={14}
                    className="text-fg-subtle transition-transform group-hover:translate-x-0.5"
                  />
                </div>
              </div>

              <p className="mt-2 line-clamp-2 min-h-8 text-xs text-fg-muted">
                {cluster.description || 'Aucune description.'}
              </p>

              <div className="mt-3 grid grid-cols-4 gap-2 border-t border-line pt-3 text-center">
                <Count label="Membres" value={cluster.member_count} icon={<Users size={11} />} />
                <Count label="Hôtes" value={cluster.host_count} />
                <Count label="Bots" value={cluster.bot_count} />
                <Count label="En ligne" value={cluster.online_bots} />
              </div>

              <div className="mt-3 flex items-center gap-1.5 text-2xs text-fg-muted">
                <StatusDot status={cluster.health === 'healthy' ? 'online' : cluster.health} />
                {humanStatus(cluster.health)}
              </div>
            </Link>
          ))}
        </div>
      )}

      <CreateClusterModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          toast.success('Cluster créé.');
          await load();
        }}
      />
      <JoinClusterModal
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={async () => {
          setJoinOpen(false);
          toast.success('Cluster rejoint.');
          await load();
        }}
      />
    </>
  );
}

function Count({ label, value, icon }: { label: string; value: number; icon?: ReactNode }) {
  return (
    <div>
      <p className="flex items-center justify-center gap-1 text-2xs uppercase tracking-wider text-fg-subtle">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-xs font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function CreateClusterModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName('');
      setVisibility('private');
      setDescription('');
      setError(null);
      setSaving(false);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Créer un cluster"
      description="Vous en devenez propriétaire : invitations, affectations et modération."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button
            variant="primary"
            icon={<Plus size={13} />}
            loading={saving}
            disabled={name.trim().length < 3}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await api.createCluster(name.trim(), visibility, description.trim());
                await onCreated();
              } catch (cause) {
                setError(errorMessage(cause));
              } finally {
                setSaving(false);
              }
            }}
          >
            Créer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Nom du cluster">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Mon cluster"
            autoFocus
            maxLength={64}
          />
        </Field>
        <Field
          label="Visibilité"
          hint="Un cluster public apparaît dans le catalogue et peut être modéré par son propriétaire."
        >
          <Select
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as 'private' | 'public')}
          >
            <option value="private">Privé — sur invitation</option>
            <option value="public">Public — catalogue et modération</option>
          </Select>
        </Field>
        <Field label="Description" hint="Facultatif.">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            placeholder="À quoi sert ce cluster ?"
          />
        </Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}

function JoinClusterModal({
  open,
  onClose,
  onJoined,
}: {
  open: boolean;
  onClose: () => void;
  onJoined: () => void | Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCode('');
      setError(null);
      setSaving(false);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rejoindre un cluster"
      description="Saisissez le code d’invitation fourni par un propriétaire ou un administrateur."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button
            variant="primary"
            icon={<UserPlus size={13} />}
            loading={saving}
            disabled={code.trim().length < 4}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await api.joinCluster(code.trim());
                await onJoined();
              } catch (cause) {
                setError(errorMessage(cause));
              } finally {
                setSaving(false);
              }
            }}
          >
            Rejoindre
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Code d’invitation">
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="ex. ZEN-4F2A-9C1B"
            autoFocus
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <InlineError message={error} />
      </div>
    </Modal>
  );
}
