import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  ExternalLink,
  Package,
  RefreshCw,
  Store,
} from 'lucide-react';

import { api, errorMessage } from '../lib/api';
import { useApp } from '../lib/store';
import type { CatalogBot } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineError,
  PageHeader,
  SearchInput,
  Spinner,
} from '../components/ui';

export function CatalogPage() {
  const { authenticated } = useApp();
  const [items, setItems] = useState<CatalogBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [variant, setVariant] = useState<'all' | 'classic' | 'custom'>('all');

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
      if (variant === 'custom' && !item.has_custom_code) return false;
      if (variant === 'classic' && item.has_custom_code) return false;
      if (!needle) return true;
      return (
        item.name.toLowerCase().includes(needle) ||
        item.slug.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle) ||
        item.author.toLowerCase().includes(needle)
      );
    });
  }, [items, query, category, variant]);

  return (
    <>
      <PageHeader
        title="Catalogue"
        description="Bots publics publiés sur zenode.fr. Les clusters à code modifié sont séparés des clusters classiques ; l’installation se fait sur le site Zenode."
      />

      {!authenticated ? (
        <EmptyState
          icon={<Store size={20} />}
          title="Liez votre compte pour accéder au catalogue"
          description="Le catalogue est synchronisé avec le Core. La création et l’installation des bots se font sur zenode.fr."
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
          description="Aucun bot n’est encore publié. Créez et publiez vos bots depuis le site Zenode."
          action={
            <Button
              variant="primary"
              icon={<ExternalLink size={13} />}
              onClick={() => void api.openUrl('https://zenode.fr/dashboard')}
            >
              Ouvrir Zenode
            </Button>
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

          <div className="mb-4 flex flex-wrap gap-1">
            {(['all', 'classic', 'custom'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setVariant(value)}
                className={`rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors ${
                  variant === value
                    ? 'border-accent bg-accent-soft text-accent-soft-fg'
                    : 'border-line text-fg-muted hover:border-line-strong hover:text-fg'
                }`}
              >
                {value === 'all'
                  ? 'Tous les codes'
                  : value === 'classic'
                    ? 'Classiques'
                    : 'Code modifié'}
              </button>
            ))}
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
                      {item.is_community ? <Badge tone="warn">Particulier</Badge> : null}
                      {item.has_custom_code ? <Badge tone="accent">Code modifié</Badge> : null}
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<ExternalLink size={12} />}
                      onClick={() =>
                        void api.openUrl(`https://zenode.fr/catalog/${encodeURIComponent(item.slug)}`)
                      }
                    >
                      Voir sur Zenode
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

