import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bot as BotIcon,
  ChevronRight,
  Cpu,
  Database,
  ExternalLink,
  MemoryStick,
  Play,
  RotateCw,
  Square,
} from 'lucide-react';

import { api, errorMessage } from '../lib/api';
import {
  formatMegabytes,
  formatPercent,
  formatUptime,
  humanOrigin,
  humanStatus,
} from '../lib/format';
import { useApp, useBots, useToast } from '../lib/store';
import type { BotSummary, LocalStats } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineError,
  PageHeader,
  SearchInput,
  StatTile,
  StatusDot,
} from '../components/ui';

export function BotsPage() {
  const { info, runtimeInstalled } = useApp();
  const { bots, loading, error, refresh } = useBots();
  const stats = useLocalStats();
  const toast = useToast();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);


  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return bots;
    return bots.filter(
      (bot) =>
        bot.name.toLowerCase().includes(needle) ||
        bot.id.toLowerCase().includes(needle) ||
        bot.description.toLowerCase().includes(needle),
    );
  }, [bots, query]);

  const online = bots.filter((bot) => bot.status === 'running').length;
  const totalCpu = bots.reduce((sum, bot) => sum + (bot.cpu_percent || 0), 0);
  const totalMemory = bots.reduce((sum, bot) => sum + (bot.memory_mb || 0), 0);

  const run = async (bot: BotSummary, action: 'start' | 'stop' | 'restart') => {
    setBusy(`${bot.id}:${action}`);
    try {
      if (action === 'start') await api.startBot(bot.id);
      else if (action === 'stop') await api.stopBot(bot.id);
      else await api.restartBot(bot.id);
      toast.success(
        action === 'start'
          ? `${bot.name} démarre.`
          : action === 'stop'
            ? `${bot.name} s’arrête.`
            : `${bot.name} redémarre.`,
      );
      await refresh();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Bots"
        description="Vos bots Discord hébergés sur cette machine. La création de bots se fait sur le site web Zenode."
        actions={
          <>
            <Button
              variant="primary"
              icon={<ExternalLink size={14} />}
              onClick={() => void api.openUrl('https://zenode.fr/dashboard')}
            >
              Créer sur Zenode
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Bots en ligne"
          value={`${online} / ${bots.length}`}
          hint={bots.length === 0 ? 'Aucun bot créé' : 'processus séparés'}
          icon={<BotIcon size={15} />}
        />
        <StatTile
          label="CPU des bots"
          value={formatPercent(totalCpu, 1)}
          hint={stats ? `hôte ${formatPercent(stats.cpu_percent, 0)}` : 'mesure en cours'}
          icon={<Cpu size={15} />}
        />
        <StatTile
          label="RAM des bots"
          value={formatMegabytes(totalMemory)}
          hint={
            stats
              ? `${formatMegabytes(stats.memory_used_mb)} / ${formatMegabytes(stats.memory_total_mb)} sur l’hôte`
              : 'mesure en cours'
          }
          icon={<MemoryStick size={15} />}
        />
        <StatTile
          label="Runtime"
          value={info?.runtime.installed ? `Bun ${info.runtime.version}` : 'Absent'}
          hint={info?.runtime.installed ? 'épinglé et vérifié' : 'à installer dans la configuration'}
          icon={<Database size={15} />}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher un bot…" />
        <div className="flex items-center gap-2 text-2xs text-fg-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          {online} en ligne
          <span className="text-fg-subtle">·</span>
          {bots.length - online} arrêté{bots.length - online > 1 ? 's' : ''}
        </div>
      </div>

      {error ? <InlineError message={error} /> : null}

      {loading && bots.length === 0 ? (
        <Card className="p-10 text-center text-sm text-fg-muted">Chargement des bots…</Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<BotIcon size={20} />}
          title={bots.length === 0 ? 'Aucun bot pour le moment' : 'Aucun résultat'}
          description={
            bots.length === 0
              ? runtimeInstalled
                ? 'Les bots se créent sur zenode.fr. Ils apparaissent ici dès qu’un cluster les confie à cette machine.'
                : 'Installez d’abord le runtime Bun pour pouvoir héberger des bots.'
              : 'Aucun bot ne correspond à cette recherche.'
          }
          action={
            bots.length === 0 ? (
              runtimeInstalled ? (
                <Button
                  variant="primary"
                  icon={<ExternalLink size={14} />}
                  onClick={() => void api.openUrl('https://zenode.fr/dashboard')}
                >
                  Créer un bot sur Zenode
                </Button>
              ) : (
                <Button variant="primary" onClick={() => navigate('/onboarding')}>
                  Configurer le runtime
                </Button>
              )
            ) : null
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((bot) => (
            <BotCard key={bot.id} bot={bot} busy={busy} onRun={run} />
          ))}
        </div>
      )}
    </>
  );
}

function BotCard({
  bot,
  busy,
  onRun,
}: {
  bot: BotSummary;
  busy: string | null;
  onRun: (bot: BotSummary, action: 'start' | 'stop' | 'restart') => void;
}) {
  const running = bot.status === 'running';
  const active = bot.status === 'starting' || bot.status === 'stopping';
  const stopped = bot.status === 'stopped' || bot.status === 'crashed' || bot.status === 'error';

  return (
    <Link
      to={`/bots/${bot.id}`}
      className="group flex flex-col rounded-lg border border-line bg-surface p-4 shadow-raised transition-colors hover:border-line-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatusDot status={bot.status} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-fg">{bot.name}</p>
            <p className="truncate font-mono text-2xs text-fg-subtle">{bot.id}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {bot.origin !== 'local' ? (
            <Badge tone="accent">{humanOrigin(bot.origin)}</Badge>
          ) : null}
          <ChevronRight
            size={14}
            className="text-fg-subtle transition-transform group-hover:translate-x-0.5"
          />
        </div>
      </div>

      <p className="mt-2 line-clamp-2 min-h-8 text-xs text-fg-muted">
        {bot.description || bot.entry}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
        <Metric label="CPU" value={formatPercent(bot.cpu_percent, 1)} />
        <Metric label="RAM" value={formatMegabytes(bot.memory_mb)} />
        <Metric label="Uptime" value={formatUptime(bot.uptime_secs)} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-2xs text-fg-muted">
          <span className={running && bot.discord_ready ? 'text-success' : ''}>
            {humanStatus(bot.status)}
          </span>
          {running && bot.discord_ready ? (
            <span className="flex items-center gap-1 text-success">
              <Activity size={11} />
              Discord prêt
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {stopped ? (
            <Button
              size="sm"
              variant="primary"
              icon={<Play size={12} />}
              loading={busy === `${bot.id}:start`}
              disabled={busy !== null || !bot.has_token}
              title={bot.has_token ? 'Démarrer' : 'Configurez le jeton Discord'}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void onRun(bot, 'start');
              }}
            >
              Démarrer
            </Button>
          ) : (
            <Button
              size="sm"
              icon={<Square size={11} />}
              loading={busy === `${bot.id}:stop`}
              disabled={busy !== null || active}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void onRun(bot, 'stop');
              }}
            >
              Arrêter
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCw size={12} />}
            loading={busy === `${bot.id}:restart`}
            disabled={busy !== null || active}
            title="Redémarrer"
            aria-label="Redémarrer"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void onRun(bot, 'restart');
            }}
          />
        </div>
      </div>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-wider text-fg-subtle">{label}</p>
      <p className="mt-0.5 truncate text-xs font-medium tabular-nums text-fg">{value}</p>
    </div>
  );
}

function useLocalStats(): LocalStats | null {
  const [stats, setStats] = useState<LocalStats | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const value = (await api.localStats()) as LocalStats;
        if (active) setStats(value);
      } catch {
        /* métriques non critiques */
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return stats;
}
