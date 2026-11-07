import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Info,
  Loader2,
  X,
} from 'lucide-react';

import { useToastState, type ToastKind } from '../lib/store';

/* --------------------------------------------------------------- boutons */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'discord';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg border border-transparent hover:bg-accent-hover disabled:hover:bg-accent',
  secondary:
    'bg-surface text-fg border border-line hover:bg-sunken hover:border-line-strong disabled:hover:bg-surface',
  ghost:
    'bg-transparent text-fg-muted border border-transparent hover:bg-neutral-soft hover:text-fg',
  danger:
    'bg-danger text-white border border-transparent hover:opacity-90 focus-visible:outline-danger',
  discord:
    'bg-discord text-white border border-transparent hover:opacity-90',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-sm',
  md: 'h-8 px-3 text-sm gap-1.5 rounded-ctl',
  lg: 'h-9 px-4 text-sm gap-2 rounded-ctl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl border border-line bg-surface text-fg-muted transition-colors hover:border-line-strong hover:bg-sunken hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * Action destructrice en deux temps : le premier clic demande confirmation,
 * le second exécute. Évite les boîtes de dialogue natives peu fiables en webview.
 */
export function DangerButton({
  label = 'Supprimer',
  confirmLabel = 'Confirmer',
  onConfirm,
  size = 'md',
  icon,
  className = '',
}: {
  label?: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  size?: Size;
  icon?: ReactNode;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      variant={armed ? 'danger' : 'secondary'}
      size={size}
      icon={armed ? <AlertCircle size={14} /> : icon}
      loading={busy}
      className={className}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

/* ------------------------------------------------------------- formulaire */

const FIELD =
  'w-full rounded-ctl border border-line bg-surface px-2.5 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-line-strong focus:ring-2 focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-60';

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD} h-8 ${className}`} {...rest} />;
}

export function Textarea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD} min-h-20 py-1.5 ${className}`} {...rest} />;
}

export function Select({
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${FIELD} h-8 pr-2 ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
      {hint ? <span className="text-2xs leading-4 text-fg-subtle">{hint}</span> : null}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{label}</p>
        {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-sunken'
        }`}
      >
        <span
          className="absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? 'translateX(1rem)' : 'translateX(0)' }}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ carte */

export function Card({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-line bg-surface shadow-raised ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-fg-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ badge */

type BadgeTone = 'neutral' | 'success' | 'warn' | 'danger' | 'info' | 'accent' | 'outline';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-soft text-neutral-soft-fg',
  success: 'bg-success-soft text-success-fg',
  warn: 'bg-warn-soft text-warn-fg',
  danger: 'bg-danger-soft text-danger-fg',
  info: 'bg-info-soft text-info-fg',
  accent: 'bg-accent-soft text-accent-soft-fg',
  outline: 'border border-line text-fg-muted',
};

export function Badge({
  tone = 'neutral',
  children,
  className = '',
  dot = false,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-medium ${TONES[tone]} ${className}`}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  const color =
    status === 'running' || status === 'online'
      ? 'bg-success'
      : status === 'starting' || status === 'stopping' || status === 'degraded'
        ? 'bg-warn'
        : status === 'crashed' || status === 'error' || status === 'offline'
          ? 'bg-danger'
          : 'bg-stone-400';
  const pulse = status === 'running' || status === 'online';
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse ? (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-50`} />
      ) : null}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

/* -------------------------------------------------------------- structure */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1">{eyebrow}</div> : null}
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface/50 px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-fg">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-fg-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xs font-medium uppercase tracking-wider text-fg-subtle">
            {label}
          </p>
          <p className="mt-1 truncate text-xl font-semibold tabular-nums text-fg">{value}</p>
          {hint ? <p className="mt-0.5 text-xs text-fg-muted">{hint}</p> : null}
        </div>
        {icon ? (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sunken text-fg-muted">
            {icon}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function Progress({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
      <div
        className="h-full rounded-full bg-accent transition-all duration-300"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-fg-muted">
      <Loader2 size={16} className="animate-spin" />
      {label ?? 'Chargement…'}
    </div>
  );
}

/* ------------------------------------------------------------------ modal */

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 p-6 backdrop-blur-[1px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`mt-[8vh] w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-xl border border-line bg-overlay shadow-overlay`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-md font-semibold text-fg">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs text-fg-muted">{description}</p>
            ) : null}
          </div>
          <IconButton label="Fermer" onClick={onClose} className="border-transparent bg-transparent">
            <X size={15} />
          </IconButton>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- copier */

export function CopyButton({ value, label = 'Copier' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={copied ? <Check size={13} /> : <Copy size={13} />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          /* clipboard indisponible */
        }
      }}
    >
      {copied ? 'Copié' : label}
    </Button>
  );
}

/* ----------------------------------------------------------------- toasts */

const TOAST_ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={16} className="text-success" />,
  error: <AlertCircle size={16} className="text-danger" />,
  info: <Info size={16} className="text-info" />,
};

export function ToastViewport() {
  const { toasts, dismiss } = useToastState();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-overlay px-3 py-2.5 shadow-overlay"
        >
          <div className="mt-0.5">{TOAST_ICONS[toast.kind]}</div>
          <p className="flex-1 text-xs leading-5 text-fg">{toast.message}</p>
          <button
            type="button"
            aria-label="Fermer la notification"
            onClick={() => dismiss(toast.id)}
            className="mt-0.5 text-fg-subtle hover:text-fg"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ onglets */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; icon?: ReactNode; badge?: ReactNode }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-line">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              active
                ? 'border-accent text-fg'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- utilitaires */

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-ctl border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger-fg">
      <AlertCircle size={14} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function InlineNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-ctl border border-line bg-sunken px-3 py-2 text-xs text-fg-muted">
      <Info size={14} className="mt-0.5 shrink-0 text-fg-subtle" />
      <div>{children}</div>
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-xs">
      <span className="shrink-0 text-fg-muted">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-fg">{children}</span>
    </div>
  );
}

/** Champ de recherche compact, réutilisé par les pages. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Rechercher…',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative w-full max-w-xs">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-8"
      />
      <svg
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    </div>
  );
}
