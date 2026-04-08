/**
 * Credential / settings storage backed by the Even Realities SDK.
 *
 * The toolkit's `EvenHubBridge` exposes `setLocalStorage(key, value)` and
 * `getLocalStorage(key)`, which are the SDK's secure, glasses-scoped key-
 * value store. We use those whenever the bridge successfully initialises
 * (i.e. the phone app is actually connected to a pair of G2 glasses).
 *
 * When the app runs in a plain browser during development — or before
 * the glasses have finished connecting — we transparently fall back to
 * `window.localStorage`. That keeps the dev loop fast and still lets us
 * read back anything we previously wrote through the SDK once the
 * bridge is online.
 *
 * All values are coerced to strings. Complex objects should be stored
 * via `getJson` / `setJson` which handle (de)serialisation.
 */

import { EvenHubBridge } from 'even-toolkit/bridge';

const KEY_PREFIX = 'bring-lens.';

let bridge: EvenHubBridge | null = null;
let bridgeReady: Promise<EvenHubBridge | null> | null = null;

/**
 * Lazily construct an EvenHubBridge dedicated to storage. We don't drive
 * a display with this bridge — the `useGlasses` hook in BringGlasses.tsx
 * owns its own bridge for rendering — we just need access to the SDK's
 * key-value API. If init() fails (no glasses connected, running in a
 * plain browser, etc.) we return null and fall back to localStorage.
 */
function getBridge(): Promise<EvenHubBridge | null> {
  if (bridgeReady) return bridgeReady;
  bridgeReady = (async () => {
    try {
      const b = new EvenHubBridge();
      await b.init();
      bridge = b;
      return b;
    } catch (err) {
      console.warn(
        '[bring-lens] EvenHubBridge unavailable; falling back to browser localStorage.',
        err,
      );
      return null;
    }
  })();
  return bridgeReady;
}

function prefixed(key: string): string {
  return `${KEY_PREFIX}${key}`;
}

/**
 * Read a string value. Tries the Even Realities SDK first, then falls
 * back to `window.localStorage`.
 */
export async function getItem(key: string): Promise<string | null> {
  const k = prefixed(key);
  const b = await getBridge();
  if (b) {
    try {
      const value = await b.getLocalStorage(k);
      // The SDK returns an empty string for missing keys; we treat
      // that the same as `null` so callers can use nullish checks.
      return value && value.length > 0 ? value : readBrowser(k);
    } catch (err) {
      console.warn('[bring-lens] SDK getLocalStorage failed', err);
    }
  }
  return readBrowser(k);
}

/** Write a string value through the SDK (with a browser fallback). */
export async function setItem(key: string, value: string): Promise<void> {
  const k = prefixed(key);
  const b = await getBridge();
  if (b) {
    try {
      await b.setLocalStorage(k, value);
    } catch (err) {
      console.warn('[bring-lens] SDK setLocalStorage failed', err);
    }
  }
  writeBrowser(k, value);
}

/** Delete a value everywhere we might have stored it. */
export async function removeItem(key: string): Promise<void> {
  const k = prefixed(key);
  const b = await getBridge();
  if (b) {
    try {
      // The SDK has no dedicated delete, so we write an empty string.
      await b.setLocalStorage(k, '');
    } catch (err) {
      console.warn('[bring-lens] SDK setLocalStorage(empty) failed', err);
    }
  }
  clearBrowser(k);
}

/** Read and JSON-parse a value. */
export async function getJson<T>(key: string): Promise<T | null> {
  const raw = await getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[bring-lens] Corrupted JSON for ${key}; discarding.`, err);
    return null;
  }
}

/** Serialise and store a JSON value. */
export async function setJson<T>(key: string, value: T): Promise<void> {
  await setItem(key, JSON.stringify(value));
}

// ── Browser fallback helpers ─────────────────────────────────────────

function readBrowser(fullKey: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(fullKey);
  } catch {
    return null;
  }
}

function writeBrowser(fullKey: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(fullKey, value);
  } catch (err) {
    console.warn('[bring-lens] localStorage.setItem failed', err);
  }
}

function clearBrowser(fullKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(fullKey);
  } catch {
    // ignore
  }
}

// ── Typed keys ───────────────────────────────────────────────────────

export const StorageKeys = {
  auth: 'auth',
  settings: 'settings',
} as const;

/** Expose the bridge (once ready) for other modules that need it. */
export async function tryGetBridge(): Promise<EvenHubBridge | null> {
  return getBridge();
}

/** Returns true if we're currently using the SDK-backed store. */
export function isUsingSdkStore(): boolean {
  return bridge !== null;
}
