export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function formatMegabytes(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return '0 Mo';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} Go`;
  return `${Math.round(mb)} Mo`;
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${secs} s`;
  return `${secs} s`;
}

export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '0 %';
  return `${value.toFixed(digits)} %`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return 'jamais';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'jamais';
  const diff = Math.round((Date.now() - date.getTime()) / 1000);
  if (diff < 5) return "à l'instant";
  if (diff < 60) return `il y a ${diff} s`;
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  return `il y a ${Math.floor(diff / 86400)} j`;
}

export function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('fr-FR', { hour12: false });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function humanStatus(status: string): string {
  switch (status) {
    case 'stopped':
      return 'Arrêté';
    case 'starting':
      return 'Démarrage';
    case 'running':
      return 'En ligne';
    case 'stopping':
      return 'Arrêt';
    case 'crashed':
      return 'Crash';
    case 'error':
      return 'Erreur';
    case 'online':
      return 'En ligne';
    case 'offline':
      return 'Hors ligne';
    case 'degraded':
      return 'Dégradé';
    default:
      return status;
  }
}

export function humanOrigin(origin: string): string {
  switch (origin) {
    case 'local':
      return 'Local';
    case 'cluster':
      return 'Cluster';
    case 'catalog':
      return 'Catalogue';
    default:
      return origin;
  }
}

export function languageForFile(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'sh':
      return 'shell';
    case 'rs':
      return 'rust';
    case 'py':
      return 'python';
    default:
      return 'plaintext';
  }
}
