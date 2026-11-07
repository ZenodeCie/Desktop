import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

import { api, errorMessage } from '../lib/api';
import { ONBOARDED_KEY } from '../lib/constants';
import { formatBytes } from '../lib/format';
import { useApp, useToast } from '../lib/store';
import type { PairingInfo, RuntimeProgress } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CopyButton,
  InlineError,
  Progress,
  Spinner,
} from '../components/ui';

export function OnboardingPage() {
  const { info, reload, runtimeInstalled, authenticated } = useApp();
  const toast = useToast();
  const navigate = useNavigate();

  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<RuntimeProgress | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [pairStarting, setPairStarting] = useState(false);
  const [pairStatus, setPairStatus] = useState<string | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);

  const runtime = info?.runtime;

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    void listen<RuntimeProgress>('runtime://progress', (event) => {
      setProgress(event.payload);
    }).then((unlisten) => unlisteners.push(unlisten));
    return () => unlisteners.forEach((unlisten) => unlisten());
  }, []);

  // Polling de la liaison : le Core renvoie `pending` tant que l'utilisateur
  // n'a pas validé le code sur le site.
  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const result = await api.authPollPairing();
        if (cancelled) return;
        setPairStatus(result.message ?? result.status);
        if (result.status === 'approved') {
          setPairing(null);
          setPairStatus(null);
          await reload();
          toast.success('Compte lié. Votre machine est enregistrée.');
        } else if (result.status === 'expired' || result.status === 'denied') {
          setPairError(
            result.message ??
              (result.status === 'expired'
                ? 'Le code a expiré. Générez-en un nouveau.'
                : 'La demande a été refusée.'),
          );
          setPairing(null);
        }
      } catch (error) {
        if (!cancelled) {
          setPairError(errorMessage(error));
          setPairing(null);
        }
      }
    };

    void poll();
    const interval = Math.max(2, pairing.interval_secs) * 1000;
    timer = window.setInterval(() => void poll(), interval);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pairing, reload, toast]);

  const finish = (skip = false) => {
    if (!skip && !runtimeInstalled) return;
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
    } catch {
      /* stockage indisponible */
    }
    navigate('/', { replace: true });
  };

  const installRuntime = async () => {
    setInstalling(true);
    setRuntimeError(null);
    setProgress({ phase: 'download', received: 0, total: 0, percent: 0 });
    try {
      await api.installRuntime();
      await reload();
      toast.success('Runtime Bun installé et vérifié.');
    } catch (error) {
      setRuntimeError(errorMessage(error));
    } finally {
      setInstalling(false);
    }
  };

  const startPairing = async () => {
    setPairStarting(true);
    setPairError(null);
    setPairStatus(null);
    try {
      const result = await api.authStartPairing();
      setPairing(result);
      try {
        await api.openUrl(result.verification_uri);
      } catch {
        /* l'utilisateur peut ouvrir le lien manuellement */
      }
    } catch (error) {
      setPairError(errorMessage(error));
    } finally {
      setPairStarting(false);
    }
  };

  const steps = useMemo(
    () => [
      { num: 1, label: 'Runtime', done: runtimeInstalled },
      { num: 2, label: 'Compte', done: authenticated },
    ],
    [runtimeInstalled, authenticated],
  );

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-canvas">
      <div className="titlebar-drag absolute inset-x-0 top-0 h-7" />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pb-10 pt-14">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-700 text-brand-100">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 4.5 20 17H4L12 4.5Z" strokeLinejoin="round" />
              <circle cx="12" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="4" cy="17" r="1.6" fill="currentColor" stroke="none" />
              <circle cx="20" cy="17" r="1.6" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <div>
            <p className="text-md font-semibold tracking-tight">Bienvenue dans Zenode Host</p>
            <p className="text-xs text-fg-muted">
              Deux étapes pour héberger vos bots Discord sur cette machine.
            </p>
          </div>
        </div>

        <ol className="mb-6 flex items-center gap-2 text-xs text-fg-subtle">
          {steps.map((step, index) => (
            <li key={step.num} className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full border text-2xs font-semibold ${
                  step.done
                    ? 'border-success bg-success text-white'
                    : 'border-line-strong text-fg-muted'
                }`}
              >
                {step.done ? <Check size={11} /> : step.num}
              </span>
              <span className={step.done ? 'text-fg' : ''}>{step.label}</span>
              {index < steps.length - 1 ? <span className="h-px w-8 bg-line" /> : null}
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent-soft-fg">
                  <Terminal size={16} />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">Runtime des bots</h2>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    Bun {runtime?.pinned_version ?? '1.4.4'}, téléchargé depuis une release
                    officielle et vérifié par empreinte SHA-256.
                  </p>
                </div>
              </div>
              {runtimeInstalled ? (
                <Badge tone="success" dot>
                  Installé
                </Badge>
              ) : (
                <Badge tone="warn" dot>
                  Requis
                </Badge>
              )}
            </div>
            <div className="px-5 py-4">
              {runtimeInstalled ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-fg-muted">
                    <p className="font-medium text-fg">
                      Bun {runtime?.version ?? runtime?.pinned_version}
                    </p>
                    <p className="mt-0.5">
                      {formatBytes(runtime?.size_bytes ?? 0)} · {runtime?.platform}/
                      {runtime?.arch}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    icon={<Download size={13} />}
                    loading={installing}
                    onClick={installRuntime}
                  >
                    Réinstaller
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-fg-muted">
                      Installation locale dans le dossier de données de l’application.
                      Aucun Node.js ni Bun système requis.
                    </p>
                    <Button
                      variant="primary"
                      icon={<Download size={14} />}
                      loading={installing}
                      onClick={installRuntime}
                    >
                      Installer le runtime
                    </Button>
                  </div>
                  {progress && installing ? (
                    <div className="mt-4">
                      <div className="mb-1.5 flex items-center justify-between text-2xs text-fg-muted">
                        <span>
                          {progress.phase === 'extract'
                            ? 'Extraction…'
                            : progress.phase === 'done'
                              ? 'Terminé'
                              : 'Téléchargement…'}
                        </span>
                        <span className="tabular-nums">
                          {progress.percent.toFixed(0)} %
                          {progress.total > 0
                            ? ` · ${formatBytes(progress.received)} / ${formatBytes(progress.total)}`
                            : ''}
                        </span>
                      </div>
                      <Progress value={progress.percent} />
                    </div>
                  ) : null}
                </>
              )}
              <div className="mt-3">
                <InlineError message={runtimeError} />
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent-soft-fg">
                  <Link2 size={16} />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">Compte Zenode</h2>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    Relie cette machine pour synchroniser tes clusters, héberger des bots
                    et retrouver ton catalogue.
                  </p>
                </div>
              </div>
              {authenticated ? (
                <Badge tone="success" dot>
                  Lié
                </Badge>
              ) : (
                <Badge tone="outline">Optionnel</Badge>
              )}
            </div>

            <div className="px-5 py-4">
              {authenticated && info?.auth.user ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {info.auth.user.avatar_url ? (
                      <img
                        src={info.auth.user.avatar_url}
                        alt=""
                        className="h-9 w-9 rounded-full border border-line object-cover"
                      />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-soft-fg">
                        {info.auth.user.display_name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <div>
                      <p className="text-sm font-medium">{info.auth.user.display_name}</p>
                      <p className="text-2xs text-fg-muted">
                        Machine {info.host?.name ?? 'enregistrée'}
                      </p>
                    </div>
                  </div>
                  <CheckCircle2 size={18} className="text-success" />
                </div>
              ) : pairing ? (
                <div className="flex flex-col gap-3">
                  <div className="rounded-lg border border-line bg-sunken px-4 py-3">
                    <p className="text-2xs font-medium uppercase tracking-wider text-fg-subtle">
                      Code de liaison
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xl font-semibold tracking-[0.2em] text-fg">
                        {pairing.user_code}
                      </span>
                      <CopyButton value={pairing.user_code} label="Copier le code" />
                    </div>
                    <p className="mt-2 text-xs text-fg-muted">
                      Saisissez ce code sur{' '}
                      <button
                        type="button"
                        className="font-medium text-accent underline-offset-2 hover:underline"
                        onClick={() => void api.openUrl(pairing.verification_uri)}
                      >
                        {pairing.verification_uri.replace(/^https?:\/\//, '')}
                      </button>{' '}
                      pour approuver la machine.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      icon={<ExternalLink size={13} />}
                      onClick={() => void api.openUrl(pairing.verification_uri)}
                    >
                      Ouvrir la page
                    </Button>
                    <span className="flex items-center gap-1.5 text-2xs text-fg-muted">
                      <Loader2 size={12} className="animate-spin" />
                      {pairStatus ?? 'En attente de validation…'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="max-w-md text-xs text-fg-muted">
                    La liaison utilise un code à durée limitée. Aucun mot de passe n’est
                    stocké sur la machine : seuls des jetons révocables sont conservés.
                  </p>
                  <Button
                    variant="primary"
                    icon={<Link2 size={14} />}
                    loading={pairStarting}
                    onClick={startPairing}
                  >
                    Lier mon compte
                  </Button>
                </div>
              )}
              <div className="mt-3">
                <InlineError message={pairError} />
              </div>
            </div>
          </Card>

          <div className="flex items-start gap-2 rounded-lg border border-line bg-surface px-4 py-3 text-xs text-fg-muted">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" />
            <p>
              Les jetons Discord sont chiffrés au repos dans le coffre local et ne sont
              jamais écrits dans le code de vos bots. Sur un cluster, le Core scelle le
              jeton pour la clé publique de cette machine uniquement.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => finish(true)}>
            Plus tard
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon={<ArrowRight size={15} />}
            disabled={!runtimeInstalled}
            onClick={() => finish(false)}
          >
            {runtimeInstalled ? 'Accéder au tableau de bord' : 'Installez d’abord le runtime'}
          </Button>
        </div>

        {info ? (
          <p className="mt-6 text-center text-2xs text-fg-subtle">
            Zenode Host {info.version} · {info.os}/{info.arch}
          </p>
        ) : (
          <Spinner />
        )}
      </div>
    </div>
  );
}
