import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { listen } from '@tauri-apps/api/event';

import { api, errorMessage } from './api';
import type { AppInfo, BotRuntimeInfo, BotSummary, LogLine } from './types';

/* ------------------------------------------------------------------ thème */

export type Theme = 'light' | 'dark';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem('zenode-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('zenode-theme', theme);
  } catch {
    /* stockage indisponible : le thème reste appliqué pour la session */
  }
}

/* ------------------------------------------------------------------- app */

interface AppContextValue {
  info: AppInfo | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<AppInfo | null>;
  authenticated: boolean;
  runtimeInstalled: boolean;
  theme: Theme;
  toggleTheme: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    try {
      const next = await api.appInfo();
      if (mounted.current) {
        setInfo(next);
        setError(null);
      }
      return next;
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
      return null;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    const timer = window.setInterval(() => void reload(), 15000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [reload]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      info,
      loading,
      error,
      reload,
      authenticated: info?.auth.authenticated ?? false,
      runtimeInstalled: info?.runtime.installed ?? false,
      theme,
      toggleTheme,
    }),
    [info, loading, error, reload, theme, toggleTheme],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp doit être utilisé sous <AppProvider>');
  return context;
}

/* ----------------------------------------------------------------- toasts */

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = counter.current++;
      setToasts((current) => [...current.slice(-4), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, push, dismiss }),
    [toasts, push, dismiss],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** Liste brute des notifications, consommée par le viewport. */
export function useToastState(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToastState doit être utilisé sous <ToastProvider>');
  return context;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast doit être utilisé sous <ToastProvider>');
  const { push } = context;
  return useMemo(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
      info: (message: string) => push('info', message),
    }),
    [push],
  );
}

/* ------------------------------------------------------------------- bots */

export function useBots() {
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.listBots();
      setBots(next);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    const unlisteners: Array<() => void> = [];

    void listen<{ bot_id: string; runtime: BotRuntimeInfo }>('bot://status', (event) => {
      setBots((current) =>
        current.map((bot) =>
          bot.id === event.payload.bot_id ? { ...bot, ...event.payload.runtime } : bot,
        ),
      );
    }).then((unlisten) => unlisteners.push(unlisten));

    void listen<{
      bot_id: string;
      cpu_percent: number;
      memory_mb: number;
      uptime_secs: number;
      discord_ready: boolean;
    }>('bot://stats', (event) => {
      setBots((current) =>
        current.map((bot) =>
          bot.id === event.payload.bot_id
            ? {
                ...bot,
                cpu_percent: event.payload.cpu_percent,
                memory_mb: event.payload.memory_mb,
                uptime_secs: event.payload.uptime_secs,
                discord_ready: event.payload.discord_ready,
              }
            : bot,
        ),
      );
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      window.clearInterval(timer);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [refresh]);

  return { bots, loading, error, refresh };
}

export function useLogs(botId: string | undefined) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!botId) return;
    let active = true;
    const unlisteners: Array<() => void> = [];

    setLoading(true);
    api
      .getBotLogs(botId, 600)
      .then((initial) => {
        if (active) setLogs(initial);
      })
      .catch(() => {
        if (active) setLogs([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    void listen<{ bot_id: string; log: LogLine }>('bot://log', (event) => {
      if (event.payload.bot_id !== botId) return;
      setLogs((current) => {
        const next = [...current, event.payload.log];
        return next.length > 2500 ? next.slice(next.length - 2500) : next;
      });
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [botId]);

  return { logs, loading, clear: () => setLogs([]) };
}

/* --------------------------------------------------------------- horloge */

/** Force un rendu périodique pour les compteurs (uptime, « il y a … »). */
export function useTicker(intervalMs = 5000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return tick;
}
