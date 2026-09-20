// predict.js — offline next-word + completion prediction for the AAC board.
// Pure logic, no DOM. Testable in node.
//
// People who type by dwelling on keys are SLOW — every keystroke can cost a
// second. Word prediction is the single biggest speed win in AAC (augmentative
// and alternative communication) keyboards. We do it fully offline with:
//   - a unigram frequency list (common English words), and
//   - a small bigram table for context ("I need" -> "help", "to", "a" ...).
// No cloud, no model download. Small but genuinely useful.

import { UNIGRAMS, BIGRAMS, STARTERS } from './lexicon.js';

function rankByFreq(words, freqMap) {
  return words.slice().sort((a, b) => (freqMap[b] || 0) - (freqMap[a] || 0));
}

/**
 * Predict up to `n` candidate words given the text typed so far.
 * If the user is mid-word (no trailing space), we complete that word.
 * If they just finished a word (trailing space), we predict the next word
 * from the bigram table, backing off to global frequency.
 *
 * @param {string} text  the sentence buffer, e.g. "i need "
 * @param {number} n     how many suggestions to return
 * @returns {string[]}
 */
export function predict(text, n = 4) {
  const raw = text.replace(/\s+/g, ' ');
  const endsWithSpace = /\s$/.test(text);
  const tokens = raw.trim().length ? raw.trim().split(' ') : [];

  // Case 1: empty buffer -> sentence starters.
  if (tokens.length === 0) {
    return STARTERS.slice(0, n);
  }

  // Case 2: mid-word completion.
  if (!endsWithSpace) {
    const prefix = tokens[tokens.length - 1].toLowerCase();
    if (!prefix) return STARTERS.slice(0, n);
    const matches = Object.keys(UNIGRAMS).filter(
      (w) => w.startsWith(prefix) && w !== prefix
    );
    return rankByFreq(matches, UNIGRAMS).slice(0, n);
  }

  // Case 3: next-word prediction from the last token's bigram row.
  const last = tokens[tokens.length - 1].toLowerCase();
  const nexts = BIGRAMS[last];
  if (nexts && nexts.length) {
    // bigram lists are already stored most-frequent-first
    return nexts.slice(0, n);
  }
  // Back off to global frequency (minus the word just typed).
  return rankByFreq(Object.keys(UNIGRAMS), UNIGRAMS)
    .filter((w) => w !== last)
    .slice(0, n);
}

/**
 * Personalized prediction: blends the static lexicon with the words THIS user
 * actually uses (learned locally). Duck-typed on `store` — anything exposing
 * `learnedStartingWith(prefix, now)` works, so predict.js stays dependency-free
 * and this is easy to unit-test.
 *
 * Personalization applies to word-completion and next-word (mid-sentence), not
 * the empty-buffer starters (those stay nicely capitalized).
 *
 * @param {string} text
 * @param {number} n
 * @param {{learnedStartingWith:Function}|null} store
 * @param {number} now
 * @returns {string[]}
 */
export function predictAdaptive(text, n = 4, store = null, now = Date.now()) {
  const base = predict(text, Math.max(n, 6));
  if (!store || typeof store.learnedStartingWith !== 'function') {
    return base.slice(0, n);
  }
  const endsWithSpace = /\s$/.test(text);
  const tokens = text.trim().length ? text.trim().split(/\s+/) : [];

  let learned = [];
  if (tokens.length === 0) {
    learned = []; // keep capitalized starters pristine
  } else if (!endsWithSpace) {
    const prefix = tokens[tokens.length - 1].toLowerCase();
    learned = store.learnedStartingWith(prefix, now).filter((w) => w !== prefix);
  } else {
    learned = store.learnedStartingWith('', now).slice(0, 2); // top personal words
  }

  const seen = new Set();
  const out = [];
  const push = (w) => {
    const k = w.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(w); }
  };
  learned.forEach(push);   // personalized first
  base.forEach(push);      // then the general model
  return out.slice(0, n);
}

/** Apply a chosen suggestion to the buffer, returning the new buffer. */
export function applySuggestion(text, word) {
  const endsWithSpace = /\s$/.test(text) || text.length === 0;
  if (endsWithSpace) return text + word + ' ';
  // replace the trailing partial word
  const parts = text.split(/(\s)/); // keep separators
  // find last non-space chunk
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].trim().length) {
      parts[i] = word;
      break;
    }
  }
  return parts.join('') + ' ';
}
