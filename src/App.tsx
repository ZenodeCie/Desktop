import { Suspense, lazy } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { FolderKey, Loader2 } from 'lucide-react';

import { Shell } from './components/Shell';
import { ToastViewport } from './components/ui';
import { ONBOARDED_KEY } from './lib/constants';
import { api } from './lib/api';
import { AppProvider, ToastProvider, useApp } from './lib/store';
import { BotsPage } from './pages/Bots';

// Monaco et les pages lourdes ne sont chargés qu'à la demande : le démarrage
// de l'application reste rapide même avec le bundle de l'éditeur.
const BotDetailPage = lazy(() =>
  import('./pages/BotDetail').then((m) => ({ default: m.BotDetailPage })),
);
const ClustersPage = lazy(() =>
  import('./pages/Clusters').then((m) => ({ default: m.ClustersPage })),
);
const ClusterDetailPage = lazy(() =>
  import('./pages/ClusterDetail').then((m) => ({ default: m.ClusterDetailPage })),
);
const CatalogPage = lazy(() =>
  import('./pages/Catalog').then((m) => ({ default: m.CatalogPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.SettingsPage })),
);
const OnboardingPage = lazy(() =>
  import('./pages/Onboarding').then((m) => ({ default: m.OnboardingPage })),
);

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
        <ToastViewport />
      </ToastProvider>
    </AppProvider>
  );
}

function AppRoutes() {
  const { info, loading, error, reload } = useApp();

  if (loading && !info) {
    return <FullPageLoader label="Démarrage de Zenode Host…" />;
  }

  if (!info && error) return <StorageAccessError error={error} retry={reload} />;

  return (
    <Suspense fallback={<FullPageLoader label="Chargement…" />}>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<ShellGate />}>
          <Route index element={<BotsPage />} />
          <Route path="/bots/:id" element={<BotDetailPage />} />
          <Route path="/clusters" element={<ClustersPage />} />
          <Route path="/clusters/:id" element={<ClusterDetailPage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

function StorageAccessError({ error, retry }: { error: string; retry: () => Promise<unknown> }) {
  return (
    <div className="flex h-full items-center justify-center bg-canvas p-6 text-fg">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-sm">
        <FolderKey className="mb-4 text-brand-500" size={28} />
        <h1 className="text-lg font-semibold">Accès aux fichiers requis</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Zenode Host ne peut pas accéder à son dossier de données. Autorisez l’accès dans
          Réglages Système, puis réessayez.
        </p>
        <p className="mt-3 rounded-md bg-sunken px-3 py-2 font-mono text-xs text-fg-subtle">{error}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            className="rounded-sm bg-brand-700 px-3 py-2 text-xs font-medium text-white hover:bg-brand-600"
            onClick={() => void api.openStorageAccessSettings()}
          >
            Autoriser l’accès
          </button>
          <button
            className="rounded-sm border border-line px-3 py-2 text-xs font-medium text-fg-muted hover:bg-sunken hover:text-fg"
            onClick={() => void retry()}
          >
            Réessayer
          </button>
        </div>
      </div>
    </div>
  );
}

function FullPageLoader({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-canvas text-fg-muted">
      <Loader2 size={18} className="animate-spin" />
      <span className="ml-2 text-sm">{label}</span>
    </div>
  );
}

/** Au premier lancement, on guide l'installation du runtime et la liaison. */
function ShellGate() {
  const { info } = useApp();
  if (info && !info.runtime.installed) {
    const seen = (() => {
      try {
        return localStorage.getItem(ONBOARDED_KEY) === '1';
      } catch {
        return false;
      }
    })();
    if (!seen) return <Navigate to="/onboarding" replace />;
  }
  return <Shell />;
}
