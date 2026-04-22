// Inline step timers + screen wake lock.
// Browser-only (needs navigator.wakeLock + setTimeout). Pure data layer can be
// imported in node for testing via parseDurations.

// Duration regex. Must have a unit word IMMEDIATELY adjacent to the number
// to avoid matching "heat to 350 degrees" as a timer.
const DURATION_RE = /(\b\d+(?:\.\d+)?\s*(?:second|sec|minute|min|hour|hr|h)s?\b)/gi;
const UNIT_SEC = { second: 1, sec: 1, minute: 60, min: 60, hour: 3600, hr: 3600, h: 3600 };

function unitToSeconds(unit) {
  const u = unit.toLowerCase().replace(/s$/, '');
  return UNIT_SEC[u] || UNIT_SEC[u.replace('s', '')] || null;
}

// Parse all durations in a string.
// Returns: [{ raw, seconds, index, length }]
export function parseDurations(text) {
  if (typeof text !== 'string' || !text) return [];
  const results = [];
  DURATION_RE.lastIndex = 0;
  let m;
  while ((m = DURATION_RE.exec(text)) !== null) {
    const raw = m[0];
    const num = parseFloat(raw);
    const unitMatch = raw.match(/([a-zA-Z]+)s?\s*$/);
    if (!unitMatch) continue;
    const baseUnit = unitMatch[1];
    const perSec = unitToSeconds(baseUnit);
    if (!perSec || !Number.isFinite(num)) continue;
    results.push({
      raw,
      seconds: Math.round(num * perSec),
      index: m.index,
      length: raw.length,
    });
  }
  return results;
}

// Split a string around its duration matches so a renderer can turn each
// into a tappable chip. Returns array of { type: 'text'|'timer', value, seconds? }.
export function tokenizeWithTimers(text) {
  const durs = parseDurations(text);
  if (!durs.length) return [{ type: 'text', value: text }];
  const out = [];
  let cursor = 0;
  for (const d of durs) {
    if (d.index > cursor) {
      out.push({ type: 'text', value: text.slice(cursor, d.index) });
    }
    out.push({ type: 'timer', value: d.raw, seconds: d.seconds });
    cursor = d.index + d.length;
  }
  if (cursor < text.length) out.push({ type: 'text', value: text.slice(cursor) });
  return out;
}

// ----- Timer runtime (browser) -----
// Active timers keyed by id. Callers: startTimer, cancelTimer, onFinish.

const activeTimers = new Map();
const listeners = new Set();

function emit(event) {
  for (const l of listeners) {
    try { l(event); } catch { /* isolate */ }
  }
}

export function onTimerEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startTimer({ id, seconds, label = '', onFinish }) {
  if (!id || !Number.isFinite(seconds) || seconds <= 0) return null;
  // Replace any existing timer with same id.
  cancelTimer(id);
  const startedAt = Date.now();
  const endsAt = startedAt + seconds * 1000;
  const handle = setTimeout(() => {
    activeTimers.delete(id);
    chime();
    emit({ type: 'finished', id, label, seconds });
    if (typeof onFinish === 'function') onFinish();
  }, seconds * 1000);
  activeTimers.set(id, { handle, startedAt, endsAt, label, seconds });
  emit({ type: 'started', id, label, seconds, endsAt });
  return { id, endsAt };
}

export function cancelTimer(id) {
  const t = activeTimers.get(id);
  if (!t) return false;
  clearTimeout(t.handle);
  activeTimers.delete(id);
  emit({ type: 'cancelled', id });
  return true;
}

export function activeTimerIds() {
  return [...activeTimers.keys()];
}

export function timerRemaining(id) {
  const t = activeTimers.get(id);
  if (!t) return null;
  return Math.max(0, t.endsAt - Date.now());
}

// ----- Chime -----
let audioCtx = null;
function chime() {
  if (typeof window === 'undefined') return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.001;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc.start(now);
    osc.stop(now + 0.8);
  } catch { /* some browsers require user gesture first */ }
}

// ----- Wake lock -----
// Returns a release() function. Safe to call from any context; no-ops when
// unsupported.
let currentLock = null;

export async function acquireWakeLock() {
  if (typeof navigator === 'undefined' || !navigator.wakeLock?.request) return null;
  try {
    currentLock = await navigator.wakeLock.request('screen');
    currentLock.addEventListener?.('release', () => { currentLock = null; });
    return () => releaseWakeLock();
  } catch {
    return null;
  }
}

export async function releaseWakeLock() {
  if (!currentLock) return;
  try { await currentLock.release(); } catch { /* already released */ }
  currentLock = null;
}
