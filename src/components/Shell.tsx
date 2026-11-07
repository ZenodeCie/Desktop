import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Boxes,
  Bot,
  ChevronRight,
  Link2,
  Moon,
  RefreshCw,
  Server,
  Settings,
  Store,
  Sun,
  Unplug,
} from 'lucide-react';

import { api, errorMessage } from '../lib/api';
import { formatRelative, initials } from '../lib/format';
import { useApp, useToast } from '../lib/store';
import { Badge, Button, StatusDot } from './ui';

const NAV = [
  { to: '/', label: 'Bots', icon: Bot, end: true },
  { to: '/clusters', label: 'Clusters', icon: Boxes },
  { to: '/catalog', label: 'Catalogue', icon: Store },
  { to: '/settings', label: 'Réglages', icon: Settings },
];

const TITLES: Record<string, string> = {
  '/': 'Bots',
  '/clusters': 'Clusters',
  '/catalog': 'Catalogue',
  '/settings': 'Réglages',
  '/onboarding': 'Configuration',
};

export function Shell() {
  const { info } = useApp();
  const isMac = info?.os === 'macos';

  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      {isMac ? (
        <div className="titlebar-drag h-7 shrink-0 border-b border-line/60 bg-surface/70" />
      ) : null}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[var(--container-content)] px-8 py-6">
              <SetupBanner />
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function Sidebar() {
  const { info, runtimeInstalled, authenticated } = useApp();
  const host = info?.host;
  const runtime = info?.runtime;

  return (
    <aside className="flex w-sidebar shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-topbar items-center gap-2.5 px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-700 text-brand-100">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 4.5 20 17H4L12 4.5Z" strokeLinejoin="round" />
            <circle cx="12" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="4" cy="17" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="20" cy="17" r="1.6" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">Zenode Host</p>
          <p className="truncate text-2xs text-fg-subtle">Hébergement de bots</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2 py-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `group flex items-center gap-2.5 rounded-ctl px-2.5 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'bg-accent-soft font-medium text-accent-soft-fg'
                  : 'text-fg-muted hover:bg-sunken hover:text-fg'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <item.icon size={15} className={isActive ? '' : 'text-fg-subtle group-hover:text-fg-muted'} />
                <span className="flex-1">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-line px-3 py-3">
        <div className="rounded-md border border-line bg-sunken/60 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-2xs font-medium text-fg-muted">
              <Server size={12} />
              Runtime Bun
            </span>
            <Badge tone={runtimeInstalled ? 'success' : 'warn'} dot>
              {runtimeInstalled ? runtime?.version ?? 'prêt' : 'absent'}
            </Badge>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-2xs font-medium text-fg-muted">
              {authenticated ? <Link2 size={12} /> : <Unplug size={12} />}
              Compte
            </span>
            <span className="max-w-28 truncate text-2xs text-fg-subtle">
              {authenticated ? info?.auth.user?.display_name ?? 'lié' : 'non lié'}
            </span>
          </div>
          {host ? (
            <p className="mt-2 truncate border-t border-line pt-2 text-2xs text-fg-subtle">
              {host.name}
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function Topbar() {
  const { info, authenticated, theme, toggleTheme, reload } = useApp();
  const toast = useToast();
  const location = useLocation();
  const [syncing, setSyncing] = useState(false);
  const base = `/${location.pathname.split('/').filter(Boolean)[0] ?? ''}`;
  const title = TITLES[base] ?? 'Zenode Host';
  const user = info?.auth.user;

  return (
    <header className="flex h-topbar shrink-0 items-center justify-between gap-4 border-b border-line bg-surface/80 px-6 backdrop-blur">
      <div className="flex items-center gap-2 text-xs text-fg-subtle">
        <span className="font-medium text-fg">{title}</span>
        <ChevronRight size={12} />
        <span>{hostLabel(info?.host?.name)}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 text-2xs text-fg-subtle md:flex">
          <StatusDot status={info?.last_sync ? 'online' : 'offline'} />
          {info?.last_sync ? `synchronisé ${formatRelative(info.last_sync)}` : 'hors ligne'}
        </span>

        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />}
          disabled={!authenticated || syncing}
          onClick={async () => {
            setSyncing(true);
            try {
              const result = await api.syncNow();
              if (result.ok) toast.success('Synchronisation effectuée.');
              else toast.info('Compte non lié : synchronisation ignorée.');
              await reload();
            } catch (error) {
              toast.error(errorMessage(error));
            } finally {
              setSyncing(false);
            }
          }}
        >
          <span className="hidden sm:inline">Synchroniser</span>
        </Button>

        <Button
          size="sm"
          variant="ghost"
          aria-label="Changer de thème"
          title="Changer de thème"
          onClick={toggleTheme}
          icon={theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        />

        {authenticated && user ? (
          <div className="ml-1 flex items-center gap-2 border-l border-line pl-2">
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                className="h-6 w-6 rounded-full border border-line object-cover"
              />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-soft-fg">
                {initials(user.display_name)}
              </span>
            )}
            <span className="hidden max-w-32 truncate text-xs font-medium text-fg sm:block">
              {user.display_name}
            </span>
          </div>
        ) : (
          <NavLink
            to="/onboarding"
            className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-sm border border-line px-2.5 text-xs font-medium text-fg-muted hover:bg-sunken hover:text-fg"
          >
            <Link2 size={12} />
            Lier le compte
          </NavLink>
        )}
      </div>
    </header>
  );
}

function SetupBanner() {
  const { runtimeInstalled, authenticated } = useApp();
  const location = useLocation();
  if (location.pathname === '/onboarding') return null;
  if (runtimeInstalled && authenticated) return null;

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-warn-fg">
          {!runtimeInstalled
            ? 'Le runtime des bots n’est pas encore installé.'
            : 'Votre machine n’est pas liée à un compte Zenode.'}
        </p>
        <p className="mt-0.5 text-2xs text-warn-fg/80">
          {!runtimeInstalled
            ? 'Installez Bun (épinglé et vérifié) pour démarrer vos bots.'
            : 'Liez votre compte pour synchroniser vos clusters et héberger des bots.'}
        </p>
      </div>
      <NavLink
        to="/onboarding"
        className="inline-flex h-7 items-center gap-1 rounded-sm bg-warn px-2.5 text-xs font-medium text-white hover:opacity-90"
      >
        Configurer
        <ChevronRight size={12} />
      </NavLink>
    </div>
  );
}

function hostLabel(name: string | undefined): string {
  return name && name.trim() ? name : 'Machine locale';
}
