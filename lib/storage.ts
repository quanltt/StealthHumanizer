import { ApiKeys, HistoryEntry } from './types';
// Note: HistoryEntry fields are optional at storage level for backwards compatibility

const KEYS = {
  API_KEYS: 'stealthhumanizer_api_keys',
  HISTORY: 'stealthhumanizer_history',
  THEME: 'stealthhumanizer_theme',
  VISITED: 'stealthhumanizer_visited',
  PROVIDER_MODELS: 'stealthhumanizer_provider_models',
  DOMAIN: 'stealthhumanizer_domain',
  DEFAULT_PROVIDER: 'stealthhumanizer_default_provider',
};

function encode(data: string): string {
  return btoa(unescape(encodeURIComponent(data)));
}

function decode(data: string): string {
  return decodeURIComponent(escape(atob(data)));
}

// API Keys
export function getApiKeys(): ApiKeys {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(KEYS.API_KEYS);
    if (!stored) return {};
    // Support both legacy plain JSON and new encoded format
    try {
      return JSON.parse(decode(stored));
    } catch {
      return JSON.parse(stored);
    }
  } catch {
    return {};
  }
}

export function setApiKeys(keys: ApiKeys): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.API_KEYS, encode(JSON.stringify(keys)));
}

export function clearApiKeys(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEYS.API_KEYS);
}

// Per-provider model override — lets a user pick a specific model (e.g.
// "gpt-4.1-mini" instead of the provider's defaultModel) without touching Settings.
export function getProviderModels(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(KEYS.PROVIDER_MODELS);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function setProviderModel(providerId: string, model: string | undefined): void {
  if (typeof window === 'undefined') return;
  const current = getProviderModels();
  if (model) current[providerId] = model;
  else delete current[providerId];
  localStorage.setItem(KEYS.PROVIDER_MODELS, JSON.stringify(current));
}

// Preferred corpus domain for corpus-aware style calibration ('default' = no domain filter).
export function getPreferredDomain(): string {
  if (typeof window === 'undefined') return 'default';
  return localStorage.getItem(KEYS.DOMAIN) || 'default';
}

export function setPreferredDomain(domain: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.DOMAIN, domain);
}

// The app-wide default provider (shown pre-selected on load, and used
// whenever the current selection has no usable key — see getApiCredentials
// in Humanizer.tsx). Set from Settings; persists in localStorage so it
// survives reloads and can be changed without a rebuild. Returns null when
// the user hasn't explicitly chosen one, so callers can fall back to the
// build-time NEXT_PUBLIC_DEFAULT_PROVIDER env var.
export function getDefaultProvider(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEYS.DEFAULT_PROVIDER) || null;
}

export function setDefaultProvider(providerId: string | undefined): void {
  if (typeof window === 'undefined') return;
  if (providerId) localStorage.setItem(KEYS.DEFAULT_PROVIDER, providerId);
  else localStorage.removeItem(KEYS.DEFAULT_PROVIDER);
}

// History
const MAX_HISTORY_ITEMS = 50;

export function getHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(KEYS.HISTORY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function addToHistory(entry: Partial<HistoryEntry> & { originalText: string; humanizedText: string }): HistoryEntry {
  const history = getHistory();
  const defaults: HistoryEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    originalText: entry.originalText,
    humanizedText: entry.humanizedText,
    options: {
      style: 'academic',
      model: 'gemini',
      targetScore: 90,
      language: 'en',
    },
  };
  const newEntry = { ...defaults, ...entry, id: defaults.id, timestamp: defaults.timestamp };

  // Add to beginning, keep max items
  const updated = [newEntry, ...history].slice(0, MAX_HISTORY_ITEMS);

  if (typeof window !== 'undefined') {
    localStorage.setItem(KEYS.HISTORY, JSON.stringify(updated));
  }

  return newEntry;
}

export function deleteHistoryEntry(id: string): void {
  if (typeof window === 'undefined') return;
  const history = getHistory();
  const updated = history.filter(entry => entry.id !== id);
  localStorage.setItem(KEYS.HISTORY, JSON.stringify(updated));
}

export function clearHistory(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEYS.HISTORY);
}

// Theme
export function getSystemThemePreference(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(KEYS.THEME);
  if (stored === 'system') return getSystemThemePreference();
  if (stored === 'light' || stored === 'dark') return stored;
  // No explicit choice saved yet: default to 'dark' rather than following
  // the OS/browser's prefers-color-scheme. Light theme only recolors the
  // page background gradient (see .light in globals.css) — every component
  // color (bg-dark-800, text-dark-400, etc.) is a hardcoded dark-palette
  // value that doesn't adapt, so auto-selecting light on a light-mode OS
  // produces a washed-out, low-contrast UI the user never asked for.
  return 'dark';
}

export function setTheme(theme: 'dark' | 'light' | 'system'): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.THEME, theme);
}

export function onSystemThemeChange(callback: (theme: 'dark' | 'light') => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (e: MediaQueryListEvent) => callback(e.matches ? 'dark' : 'light');
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}

// Visited flag
export function hasVisited(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(KEYS.VISITED) === 'true';
}

export function markVisited(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.VISITED, 'true');
}

// Word count utility
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

// Text chunking for long texts
export function chunkText(text: string, maxWords: number = 2500): string[] {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return [text];

  const chunks: string[] = [];
  let currentChunk: string[] = [];

  for (const word of words) {
    currentChunk.push(word);
    if (currentChunk.length >= maxWords) {
      // Try to end at a sentence boundary
      const chunkText = currentChunk.join(' ');
      const lastSentenceEnd = Math.max(
        chunkText.lastIndexOf('.'),
        chunkText.lastIndexOf('!'),
        chunkText.lastIndexOf('?')
      );

      if (lastSentenceEnd > chunkText.length * 0.5) {
        chunks.push(chunkText.slice(0, lastSentenceEnd + 1));
        const remaining = chunkText.slice(lastSentenceEnd + 1).trim();
        currentChunk = remaining ? remaining.split(/\s+/) : [];
      } else {
        chunks.push(chunkText);
        currentChunk = [];
      }
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }

  return chunks;
}

// Format date
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Download utilities
export function downloadAsTxt(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadAsDocx(text: string, filename: string): void {
  // HTML-escape user content to prevent XSS
  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const safeFilename = escapeHtml(filename);
  const safeText = escapeHtml(text);

  // Simple DOCX format (just wrapped text)
  const docContent = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <title>${safeFilename}</title>
      </head>
      <body>
        ${safeText.split('\n').map(p => `<p>${p}</p>`).join('\n')}
      </body>
    </html>
  `;

  const blob = new Blob([docContent], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadAsMarkdown(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
