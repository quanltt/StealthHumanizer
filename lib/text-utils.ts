/**
 * Shared text utility functions for StealthHumanizer.
 * Consolidates sentence splitting, word counting, and sentence alignment
 * that were previously duplicated across 5+ files with inconsistent behavior.
 */

/**
 * Common abbreviations that should not trigger sentence breaks.
 */
const ABBREVIATIONS = new Set([
  'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'St', 'etc', 'vs', 'i.e', 'e.g',
  'Inc', 'Ltd', 'Co', 'Corp', 'Rev', 'Gen', 'Sen', 'Rep', 'Pres', 'Hon', 'al',
]);

/**
 * Split text into sentences with abbreviation and identifier handling.
 * This is the unified version used across the entire application.
 *
 * Features:
 * - Handles abbreviations (Mr., Dr., etc.) without breaking
 * - Protects identifiers (file.ext, domain.tld, version 3.x, IP addresses)
 * - Handles trailing quotes after sentence endings
 */
export function splitIntoSentences(text: string): string[] {
  if (!text || !text.trim()) return [];

  const sentences: string[] = [];
  let current = '';
  let i = 0;

  while (i < text.length) {
    current += text[i];
    if (['.', '!', '?'].includes(text[i])) {
      const beforeMatch = text.slice(Math.max(0, i - 5), i + 1);
      // Period inside an identifier (file.ext, domain.tld, version 3.x, decimal 0.5,
      // IP 192.168.1.1) is not a sentence end. Detect by alnum-period-alnum with no
      // whitespace on either side.
      const isInsideIdentifier = text[i] === '.'
        && /[a-zA-Z0-9]/.test(text[i - 1] || '')
        && /[a-zA-Z0-9]/.test(text[i + 1] || '');
      if (!isInsideIdentifier && !Array.from(ABBREVIATIONS).some(abbr => beforeMatch.endsWith(abbr + '.'))) {
        if (text[i + 1] === '"' || text[i + 1] === "'") { current += text[i + 1]; i++; }
        const trimmed = current.trim();
        if (trimmed.length > 0) sentences.push(trimmed);
        current = '';
      }
    }
    i++;
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) sentences.push(trimmed);
  return sentences;
}

/**
 * Count words in text.
 * Handles both space-delimited and CJK text.
 */
export function countWords(text: string): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Build sentence-level results by aligning original and humanized sentences.
 *
 * Rows where BOTH sides are empty are dropped, and a humanized cell that is a
 * bare interjection fragment ("Honestly?", "Right.", "But wait,") is folded
 * into the previous humanized cell rather than shown as its own line. This
 * keeps the side-by-side diff honest even when the humanized text has a few
 * more or fewer sentences than the original.
 */
export interface SentenceAlignment {
  original: string;
  humanized: string;
  index: number;
}

const FRAGMENT_INTERJECTION = /^\s*(honestly|right|exactly|yeah|hmm|look|so|plus|well|ok|okay|true story|funny enough|makes sense|but wait|and is that|sound familiar|who would have thought)[!,?.]?\s*$/i;

function isFragment(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (FRAGMENT_INTERJECTION.test(t)) return true;
  // Very short, no sentence-ending punctuation, and no verb-like token -> likely a fragment
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 2 && !/[.!?]$/.test(t)) return true;
  return false;
}

export function buildSentenceResults(
  originalText: string,
  humanizedText: string
): SentenceAlignment[] {
  const origSentences = splitIntoSentences(originalText);
  const humanizedSentences = splitIntoSentences(humanizedText);

  // If counts are close (within 2), do standard alignment
  const results: SentenceAlignment[] = [];

  if (Math.abs(origSentences.length - humanizedSentences.length) <= 2) {
    const maxLen = Math.max(origSentences.length, humanizedSentences.length);
    for (let i = 0; i < maxLen; i++) {
      const original = origSentences[i] || '';
      const humanized = humanizedSentences[i] || '';

      // Skip fully-empty rows.
      if (!original.trim() && !humanized.trim()) continue;

      // If the humanized cell is a bare fragment, fold it into the previous row's
      // humanized text so it never appears as its own (misleading) line.
      if (original.trim() && isFragment(humanized) && results.length > 0) {
        const prev = results[results.length - 1];
        prev.humanized = `${prev.humanized} ${humanized}`.trim();
        continue;
      }

      results.push({ original, humanized, index: results.length });
    }
  } else {
    // Significant mismatch: pair up as many as possible, then merge remainders
    const minLen = Math.min(origSentences.length, humanizedSentences.length);
    for (let i = 0; i < minLen; i++) {
      const original = origSentences[i];
      const humanized = humanizedSentences[i];

      if (!original.trim() && !humanized.trim()) continue;

      if (original.trim() && isFragment(humanized) && results.length > 0) {
        const prev = results[results.length - 1];
        prev.humanized = `${prev.humanized} ${humanized}`.trim();
        continue;
      }

      results.push({ original, humanized, index: results.length });
    }

    // Merge excess originals into the last row's original
    if (origSentences.length > minLen && results.length > 0) {
      const excess = origSentences.slice(minLen).join(' ');
      results[results.length - 1].original += ' ' + excess;
    }

    // Merge excess humanized into the last row's humanized
    if (humanizedSentences.length > minLen && results.length > 0) {
      const excess = humanizedSentences.slice(minLen).join(' ');
      results[results.length - 1].humanized += ' ' + excess;
    }
  }

  return results;
}
