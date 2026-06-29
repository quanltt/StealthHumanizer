// StealthHumanizer v2 - Multi-Pass Humanization Engine

import { HumanizationOptions, HumanizationResult, SentenceResult } from './types';
import { getSystemPrompt, getRehumanizePrompt, getCorpusAwareSystemPrompt } from './prompts';
import { getCorpusCalibratedThresholds, hasStyleModel, loadStyleModelAsync } from './style-model';
import { getProvider } from './providers';
import { generateWithProvider, generateAlternatives } from './server/providers-runtime';
import { detectAI } from './detector';
import { postprocess, corpusAwarePostprocess } from './postprocess';
import { chunkText, addToHistory } from './storage';
import { countWords } from './text-utils';
import { extractRegions, restoreRegions, containsPlaceholders } from './protect-regions';
import { splitIntoSentences } from './text-utils';

async function humanizeChunk(
  text: string,
  options: HumanizationOptions,
  apiKey: string,
  customModel?: string
): Promise<string> {
  // Use corpus-aware prompt if style model is available
  const systemPrompt = hasStyleModel()
    ? getCorpusAwareSystemPrompt(options.style, undefined, options.domain, options.language)
    : getSystemPrompt(options.style, undefined, options.language);
  const providerInfo = getProvider(options.model);
  const model = customModel || providerInfo?.defaultModel || options.model;

  // If the chunk contains protected-region placeholders, instruct the LLM to
  // pass them through verbatim. They look like __PROTECT_N__ and represent code
  // blocks, links, URLs, mentions, etc. that must not be rewritten.
  const placeholderInstruction = containsPlaceholders(text)
    ? 'CRITICAL: The text contains tokens of the form __PROTECT_N__ (where N is a number). Reproduce every such token EXACTLY as it appears, with no changes, no spaces inside, no translation. They are placeholders that will be restored after rewriting.\n\n'
    : '';

  // Anchor the LLM on input length and structure so it doesn't summarize,
  // expand, or flatten paragraph/list/heading layout. Past observations: the
  // default casual rewrite drifts toward shorter prose (typically -25%) and
  // collapses paragraph breaks within a chunk.
  const inputWords = countWords(text);
  const lengthAnchor = `Length target: approximately ${inputWords} words (±15%). Do not summarize, condense, or significantly expand.`;
  const structureAnchor = 'Keep the original structure intact: preserve paragraph breaks (blank lines), bullet/numbered lists, headings, and line breaks. Do not merge or split paragraphs.';
  const anchors = `${lengthAnchor}\n${structureAnchor}\n\n`;

  const fullPrompt = options.language === 'zh-CN' || options.language === 'zh-TW'
    ? `${placeholderInstruction}${anchors}待改写的文本：\n\n${text}`
    : options.language !== 'en'
    ? `${placeholderInstruction}${anchors}IMPORTANT: The text is in a language other than English. Rewrite it in the SAME language. Do not translate.\n\nText to humanize:\n\n${text}`
    : `${placeholderInstruction}${anchors}Text to humanize:\n\n${text}`;

  return generateWithProvider(options.model, apiKey, systemPrompt, fullPrompt, { model });
}

async function rehumanizeFlaggedSentences(
  flaggedSentences: string[],
  options: HumanizationOptions,
  apiKey: string
): Promise<string[]> {
  const rehumanizePrompt = getRehumanizePrompt(flaggedSentences, options.style);
  const providerInfo = getProvider(options.model);
  const model = providerInfo?.defaultModel || options.model;
  const result = await generateWithProvider(options.model, apiKey, rehumanizePrompt, '', { model });
  
  return result
    .split('\n')
    .map(line => line.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter(line => line.length > 10);
}

export async function humanizeText(
  text: string,
  options: HumanizationOptions,
  apiKey: string,
  onProgress?: (pass: number, maxPasses: number, message: string) => void
): Promise<HumanizationResult> {
  const inputWordCount = countWords(text);
  // Preload style model (async, no-op if already loaded)
  await loadStyleModelAsync();
  // Use corpus-calibrated thresholds if available
  const calibratedThresholds = hasStyleModel() ? getCorpusCalibratedThresholds() : null;
  const targetScore = options.targetScore || calibratedThresholds?.targetScore || 80;
  const maxPasses = 3;

  // Extract structural regions (code, links, URLs, mentions, blockquotes, ...)
  // before any processing. They survive the pipeline as opaque placeholders and
  // are restored verbatim at the end.
  const { masked, regions } = extractRegions(text);
  const chunks = chunkText(masked, 2500);

  let humanizedText = '';

  // Layer 1: LLM rewrite
  onProgress?.(1, maxPasses, 'Humanizing text...');
  for (let i = 0; i < chunks.length; i++) {
    const humanizedChunk = await humanizeChunk(chunks[i], options, apiKey);
    humanizedText += (i > 0 ? '\n\n' : '') + humanizedChunk;
  }

  // Layer 2: Deterministic post-processing (em-dash stripping, vocab swap, etc.)
  // Use light mode to preserve sentence order — full mode's reordering breaks logical flow.
  let currentText = humanizedText;
  if (hasStyleModel()) {
    currentText = corpusAwarePostprocess(currentText);
  }
  currentText = postprocess(currentText, { light: true, aggressiveSynonyms: options.aggressiveSynonyms });

  let passes = 1;

  // Multi-pass: Re-humanize flagged sentences until target score is reached
  if (maxPasses > 1) {
    for (let pass = 2; pass <= maxPasses; pass++) {
      const detection = detectAI(currentText);
      onProgress?.(pass, maxPasses, `Pass ${pass}/${maxPasses} — Score: ${detection.score}% (target: ${targetScore}%)`);
      
      if (detection.score >= targetScore) break;

      const flagged = detection.sentences
        .filter(s => s.classification === 'ai' || s.classification === 'maybe')
        .map(s => s.text);

      if (flagged.length === 0) break;

      try {
        const rehumanized = await rehumanizeFlaggedSentences(flagged, options, apiKey);
        // Replace flagged sentences in-place, preserving paragraph structure.
        // The previous approach joined ALL sentences with ' ', destroying
        // paragraph breaks. Instead, do targeted replacement in the full text.
        let updatedText = currentText;
        let sentenceIndex = 0;
        for (const orig of flagged) {
          if (sentenceIndex < rehumanized.length && rehumanized[sentenceIndex].trim().length > 8) {
            updatedText = updatedText.replace(orig, rehumanized[sentenceIndex]);
            sentenceIndex++;
          }
        }
        currentText = postprocess(updatedText, { light: true, aggressiveSynonyms: options.aggressiveSynonyms });
        passes = pass;
      } catch {
        break;
      }
    }
  }

  // Restore the protected regions in the final humanized text. Detection runs
  // on the placeholder-laden text so the AI scorer doesn't pattern-match on
  // raw URLs, code, etc. — those aren't natural-language signal.
  const finalText = restoreRegions(currentText, regions);
  const finalDetection = detectAI(currentText);
  const outputWordCount = countWords(finalText);

  const originalSentences = splitIntoSentences(text);
  const humanizedSentences = splitIntoSentences(finalText);
  const maxLen = Math.max(originalSentences.length, humanizedSentences.length);
  const sentenceResults: SentenceResult[] = [];

  for (let i = 0; i < maxLen; i++) {
    sentenceResults.push({
      original: originalSentences[i] || '',
      humanized: humanizedSentences[i] || '',
      alternatives: [],
      index: i,
      detectionScore: finalDetection.sentences[i]?.score,
    });
  }

  const providerInfo = getProvider(options.model);

  return {
    sentences: sentenceResults,
    fullText: finalText,
    model: options.model,
    modelName: providerInfo?.name || options.model,
    wordCount: { input: inputWordCount, output: outputWordCount },
    timestamp: Date.now(),
    passes,
    finalScore: finalDetection.score,
    options,
  };
}

export async function getAlternatives(
  originalSentence: string,
  currentHumanized: string,
  options: HumanizationOptions,
  apiKey: string,
  count: number = 3
): Promise<string[]> {
  const systemPrompt = getSystemPrompt(options.style);
  return generateAlternatives(options.model, apiKey, originalSentence, currentHumanized, systemPrompt, count);
}

export function saveResult(result: HumanizationResult): void {
  addToHistory({
    originalText: result.sentences.map(s => s.original).join(' '),
    humanizedText: result.fullText,
    options: result.options,
    wordCount: result.wordCount,
    timestamp: result.timestamp,
    model: result.model,
    modelName: result.modelName,
    finalScore: result.finalScore,
    passes: result.passes,
  });
}
