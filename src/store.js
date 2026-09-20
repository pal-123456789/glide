// store.js — local, private persistence for Glide.
// Everything a user tunes or teaches Glide stays on THEIR device: settings,
// calibration profile, the words they use most, and recent sentences. No server.
//
// Injectable storage backend so this is unit-testable in node (pass a shim);
// in the browser it defaults to window.localStorage. All reads are defensive:
// a corrupt or blocked store must never crash the app — it degrades to defaults.

const NS = 'glide:v2:';
const KEYS = {
  settings: NS + 'settings',
  calib: NS + 'calibration',
  learned: NS + 'learned',
  history: NS + 'history',
};

export const DEFAULT_SETTINGS = {
  sensitivity: 1.4,
  dwellMs: 900,
  smoothing: 1.0,
  blinkOn: true,
  voiceOn: true,
  voiceURI: null,     // chosen TTS voice, if any
  rate: 1.0,
  pitch: 1.0,
  gesturesOn: true,
  scanMode: false,
  scanSpeedMs: 1200,
  tutorialSeen: false, // first-run guided overlay; set once dismissed
};

/** A no-op storage used when localStorage is unavailable (private mode, etc.). */
export class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

export class Store {
  constructor(backend) {
    if (backend) {
      this.s = backend;
    } else {
      // Probe localStorage; fall back to memory if it throws or is absent.
      try {
        const t = '__glide_probe__';
        globalThis.localStorage.setItem(t, '1');
        globalThis.localStorage.removeItem(t);
        this.s = globalThis.localStorage;
      } catch {
        this.s = new MemoryStorage();
      }
    }
  }

  _read(key, fallback) {
    try {
      const raw = this.s.getItem(key);
      if (raw == null) return fallback;
      const val = JSON.parse(raw);
      return val == null ? fallback : val;
    } catch {
      return fallback;
    }
  }
  _write(key, val) {
    try { this.s.setItem(key, JSON.stringify(val)); return true; }
    catch { return false; }
  }

  // ---- settings ----
  getSettings() {
    return { ...DEFAULT_SETTINGS, ...this._read(KEYS.settings, {}) };
  }
  saveSettings(patch) {
    const next = { ...this.getSettings(), ...patch };
    this._write(KEYS.settings, next);
    return next;
  }

  // ---- calibration profile ----
  getCalibration() { return this._read(KEYS.calib, null); }
  saveCalibration(profile) { this._write(KEYS.calib, profile); }
  clearCalibration() { try { this.s.removeItem(KEYS.calib); } catch {} }

  // ---- learned words (frequency + recency) ----
  // Stored as { word: { n: count, t: lastUsedMs } }.
  getLearned() { return this._read(KEYS.learned, {}); }
  learnWord(word, now = Date.now()) {
    const w = String(word || '').trim().toLowerCase();
    if (!w || w.length > 40) return;
    const map = this.getLearned();
    const cur = map[w] || { n: 0, t: 0 };
    cur.n += 1; cur.t = now;
    map[w] = cur;
    // Keep the map bounded so it can't grow forever.
    const entries = Object.entries(map);
    if (entries.length > 400) {
      entries.sort((a, b) => scoreLearned(b[1], now) - scoreLearned(a[1], now));
      const trimmed = Object.fromEntries(entries.slice(0, 300));
      this._write(KEYS.learned, trimmed);
    } else {
      this._write(KEYS.learned, map);
    }
  }
  /** Learned words whose text starts with prefix, best first. */
  learnedStartingWith(prefix, now = Date.now()) {
    const p = String(prefix || '').toLowerCase();
    const map = this.getLearned();
    return Object.keys(map)
      .filter((w) => (p ? w.startsWith(p) : true))
      .sort((a, b) => scoreLearned(map[b], now) - scoreLearned(map[a], now));
  }

  // ---- sentence history ----
  getHistory() { return this._read(KEYS.history, []); }
  pushHistory(sentence, now = Date.now()) {
    const s = String(sentence || '').trim();
    if (!s) return;
    const list = this.getHistory().filter((h) => h.text !== s); // de-dupe
    list.unshift({ text: s, t: now });
    this._write(KEYS.history, list.slice(0, 20));
  }
  clearHistory() { this._write(KEYS.history, []); }
}

/**
 * Recency-weighted frequency score. Recent + frequent ranks highest.
 * Half-life ~7 days so long-unused words fade but don't vanish immediately.
 */
export function scoreLearned(entry, now = Date.now()) {
  if (!entry) return 0;
  const ageDays = Math.max(0, (now - (entry.t || 0)) / 86400000);
  const recency = Math.pow(0.5, ageDays / 7);
  return (entry.n || 0) * (0.4 + 0.6 * recency);
}
