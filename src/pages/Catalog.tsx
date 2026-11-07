import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BadgeCheck,
  Download,
  Package,
  RefreshCw,
  Store,
} from 'lucide-react';

import { api, errorMessage } from '../lib/api';
import { useApp, useToast } from '../lib/store';
import type { CatalogBot } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  InlineError,
  InlineNote,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Spinner,
} from '../components/ui';

export function CatalogPage() {
  const { authenticated } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<CatalogBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [install, setInstall] = useState<CatalogBot | null>(null);

  const load = useCallback(async () => {
    if (!authenticated) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await api.listCatalog();
      setItems(list);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    const values = new Set(items.map((item) => item.category).filter(Boolean));
    return ['all', ...Array.from(values).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!needle) return true;
      return (
        item.name.toLowerCase().includes(needle) ||
        item.slug.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle) ||
        item.author.toLowerCase().includes(needle)
      );
    });
  }, [items, query, category]);

  return (
    <>
      <PageHeader
        title="Catalogue"
        description="Des bots prêts à héberger, publiés par la communauté Zenode. L’installation crée un bot local que vous pouvez modifier."
      />

      {!authenticated ? (
        <EmptyState
          icon={<Store size={20} />}
          title="Liez votre compte pour accéder au catalogue"
          description="Le catalogue est synchronisé avec le Core et nécessite une session. L’installation reste locale : le code est téléchargé dans le dossier de vos bots."
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
        <Spinner label="Chargement du catalogue…" />
      ) : error ? (
        <div className="flex flex-col items-start gap-3">
          <InlineError message={error} />
          <Button icon={<RefreshCw size={13} />} onClick={() => void load()}>
            Réessayer
          </Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Package size={20} />}
          title="Catalogue vide"
          description="Aucun bot n’est encore publié. Vous pouvez créer un bot local depuis l’onglet Bots et le déployer sur un cluster."
          action={
            <Link
              to="/"
              className="inline-flex h-8 items-center gap-1.5 rounded-ctl border border-line bg-surface px-3 text-sm font-medium text-fg hover:bg-sunken"
            >
              Créer un bot local
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Rechercher dans le catalogue…"
            />
            <div className="flex flex-wrap gap-1">
              {categories.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCategory(value)}
                  className={`rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors ${
                    category === value
                      ? 'border-accent bg-accent-soft text-accent-soft-fg'
                      : 'border-line text-fg-muted hover:border-line-strong hover:text-fg'
                  }`}
                >
                  {value === 'all' ? 'Tous' : value}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Store size={20} />}
              title="Aucun résultat"
              description="Aucun bot ne correspond à cette recherche ou à cette catégorie."
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {filtered.map((item) => (
                <Card key={item.slug} className="flex flex-col p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-soft-fg">
                        <Package size={16} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-sm font-semibold">{item.name}</p>
                          {item.verified ? (
                            <BadgeCheck size={14} className="shrink-0 text-info" aria-label="Vérifié" />
                          ) : null}
                        </div>
                        <p className="truncate font-mono text-2xs text-fg-subtle">{item.slug}</p>
                      </div>
                    </div>
                    <Badge tone="outline">{item.category || 'divers'}</Badge>
                  </div>

                  <p className="mt-2 line-clamp-3 min-h-12 text-xs text-fg-muted">
                    {item.description || 'Aucune description.'}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                    <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-subtle">
                      <span>par {item.author || 'communauté'}</span>
                      <span>·</span>
                      <span>v{item.version}</span>
                      <span>·</span>
                      <span className="tabular-nums">{item.installs} installation{item.installs > 1 ? 's' : ''}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Download size={12} />}
                      onClick={() => setInstall(item)}
                    >
                      Installer
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <InstallModal
        item={install}
        onClose={() => setInstall(null)}
        onInstalled={async (botId) => {
          setInstall(null);
          toast.success('Bot installé depuis le catalogue.');
          navigate(`/bots/${botId}`);
        }}
      />
    </>
  );
}

function InstallModal({
  item,
  onClose,
  onInstalled,
}: {
  item: CatalogBot | null;
  onClose: () => void;
  onInstalled: (botId: string) => void | Promise<void>;
}) {
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) {
      setToken('');
      setName('');
      setError(null);
      setInstalling(false);
    } else {
      setName(item.name);
    }
  }, [item]);

  return (
    <Modal
      open={Boolean(item)}
      onClose={onClose}
      title={item ? `Installer ${item.name}` : 'Installer'}
      description="Le code source est téléchargé et vérifié dans le dossier de vos bots. Vous pourrez l’éditer ensuite."
      footer={
        <>
          <Button onClick={onClose} disabled={installing}>
            Annuler
          </Button>
          <Button
            variant="primary"
            icon={<Download size={13} />}
            loading={installing}
            disabled={token.trim().length < 50}
            onClick={async () => {
              if (!item) return;
              setInstalling(true);
              setError(null);
              try {
                const bot = await api.installCatalogBot(
                  item.slug,
                  token.trim(),
                  name.trim() || undefined,
                );
                await onInstalled(bot.id);
              } catch (cause) {
                setError(errorMessage(cause));
              } finally {
                setInstalling(false);
              }
            }}
          >
            Installer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Nom local" hint="Vous pourrez le renommer plus tard.">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
          />
        </Field>
        <Field
          label="Jeton Discord"
          hint="Chiffré dans le coffre local. Le catalogue ne reçoit jamais ce jeton."
        >
          <Input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Coller le jeton du bot"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </Field>
        {item && !item.source_url ? (
          <InlineNote>
            Ce bot n’a pas d’archive source publiée : un squelette TypeScript standard
            sera créé, à vous de l’adapter.
          </InlineNote>
        ) : null}
        <InlineError message={error} />
      </div>
    </Modal>
  );
}
