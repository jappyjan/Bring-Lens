/**
 * Bring Lens client.
 *
 * Talks to the Bring Lens proxy (a small Express service that wraps
 * the `bring-shopping` library) — see `bring-proxy/` in this repo.
 * The proxy is the only thing that ever speaks to api.getbring.com;
 * we keep the browser side small and CORS-friendly.
 *
 * Architecture: stateless. The proxy can't reuse a session across
 * requests because `bring-shopping` doesn't expose its bearer token,
 * so the front-end stores `{email, password, country}` in the Even
 * Realities SDK secure store and sends them with every call.
 */

/**
 * Base URL of the Bring Lens proxy.
 *
 * The proxy exposes a small JSON API under `/api/*` and a `/healthz`
 * endpoint for connectivity diagnostics.
 */
export const BASE_URL = 'https://bring-proxy.apps.janjaap.de';

// ── Types ────────────────────────────────────────────────────────────

/**
 * The full credential bundle the front-end persists. Email + password
 * are required for every authenticated proxy call; `name` is the
 * friendly display name Bring returns from `login()`; `country` is on
 * the wire for forward-compatibility (the proxy currently ignores it
 * because `bring-shopping` hard-codes `X-BRING-COUNTRY: DE`).
 */
export interface BringAuth {
  email: string;
  password: string;
  country: string;
  name: string;
}

export interface BringList {
  listUuid: string;
  name: string;
  theme: string;
}

/**
 * An item on a Bring list. Note that on the to-buy / recently-bought
 * sides Bring keys items by **name** — there is no per-item UUID, no
 * `itemId`. Item names are localized canonical article keys (e.g.
 * "Milch", "Apfel"), so they're stable identifiers within a list.
 */
export interface BringItem {
  name: string;
  specification: string;
}

export interface BringListItems {
  purchase: BringItem[];
  recently: BringItem[];
}

// ── Error helper ─────────────────────────────────────────────────────

/**
 * Rich error type. For HTTP failures (`status` set) we keep both the
 * numeric status and the parsed proxy error body. For network failures
 * (`status` undefined) we keep the underlying cause — typically
 * `TypeError: Failed to fetch` (Chrome) or `TypeError: Load failed`
 * (Safari), which indicates DNS, TLS, CORS-preflight, or a dead proxy.
 */
export class BringApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
    public readonly url?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BringApiError';
  }

  /** Human-readable multi-line description for the UI / logs. */
  toDetail(): string {
    const lines: string[] = [this.message];
    if (this.url) lines.push(`URL: ${this.url}`);
    if (this.status !== undefined) lines.push(`Status: ${this.status}`);
    if (this.body) {
      const snippet = this.body.length > 500 ? `${this.body.slice(0, 500)}…` : this.body;
      lines.push(`Body: ${snippet}`);
    }
    if (this.cause instanceof Error && this.cause.message) {
      lines.push(`Cause: ${this.cause.name}: ${this.cause.message}`);
    }
    return lines.join('\n');
  }
}

interface ProxyErrorBody {
  error?: { message?: string; kind?: string };
}

/**
 * `fetch()` wrapper that turns every failure mode into a `BringApiError`
 * carrying the request URL. Distinguishes network errors (DNS / TLS /
 * CORS / dead proxy) from upstream HTTP errors so the UI can tell the
 * user which kind of problem they're looking at, and unwraps the
 * structured `{ error: { message } }` bodies the proxy returns.
 */
async function safeFetch(
  label: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    // `fetch` only rejects on genuine network-level failures — the
    // request never produced a response. The browser's devtools will
    // have the real reason (CORS, DNS, TLS, ...) in the console; here
    // we reconstruct the best message we can for the in-app UI.
    const base = err instanceof Error ? err.message : String(err);
    const looksLikeNetwork =
      err instanceof TypeError ||
      /load failed|failed to fetch|networkerror/i.test(base);
    const hint = looksLikeNetwork
      ? ' (network error — the browser could not reach the proxy. ' +
        'Check that the proxy is running, its TLS certificate is valid, ' +
        'and that CORS preflight succeeds.)'
      : '';
    throw new BringApiError(
      `${label} failed before reaching the server: ${base}${hint}`,
      undefined,
      undefined,
      url,
      err,
    );
  }

  if (!res.ok) {
    let body = '';
    let parsedMessage: string | undefined;
    try {
      body = await res.text();
      if (body) {
        try {
          const parsed = JSON.parse(body) as ProxyErrorBody;
          parsedMessage = parsed?.error?.message;
        } catch {
          // body wasn't JSON; surface the raw text
        }
      }
    } catch {
      // ignore
    }
    const detail = parsedMessage
      ? `${label} failed: ${parsedMessage}`
      : `${label} failed: HTTP ${res.status} ${res.statusText}`;
    throw new BringApiError(detail, res.status, body, url);
  }
  return res;
}

/**
 * POST a JSON body to the proxy and return the parsed JSON response.
 * Centralises the (Content-Type, JSON.stringify, JSON.parse) dance
 * so every endpoint stays a one-liner.
 */
async function postJson<T>(label: string, path: string, body: unknown): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await safeFetch(label, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

/**
 * Hit the proxy's `/healthz` endpoint. Plain GET with **no** custom
 * headers, so it does not trigger a CORS preflight — a failure here
 * means the proxy is unreachable end-to-end (DNS / TLS / container
 * down), whereas a successful ping followed by a failing login points
 * at the proxy's upstream Bring connection or credentials.
 */
export async function pingProxy(): Promise<{
  ok: boolean;
  status?: number;
  body?: string;
  error?: string;
  url: string;
}> {
  const url = `${BASE_URL}/healthz`;
  try {
    const res = await fetch(url, { method: 'GET' });
    let body = '';
    try {
      body = (await res.text()).trim();
    } catch {
      // ignore
    }
    return { ok: res.ok, status: res.status, body, url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      url,
    };
  }
}

// ── Auth ─────────────────────────────────────────────────────────────

/**
 * Validate credentials against the proxy's `/api/login` endpoint.
 * Returns a fully-populated BringAuth that the caller should persist.
 */
export async function login(
  email: string,
  password: string,
  country = 'DE',
): Promise<BringAuth> {
  const data = await postJson<{ name: string | null }>('Login', '/api/login', {
    email,
    password,
    country,
  });
  return {
    email,
    password,
    country,
    name: data.name ?? '',
  };
}

// ── Lists ────────────────────────────────────────────────────────────

/** Load every list owned by / shared with the signed-in user. */
export async function getLists(auth: BringAuth): Promise<BringList[]> {
  const data = await postJson<{ lists: BringList[] }>('Get lists', '/api/lists', {
    email: auth.email,
    password: auth.password,
    country: auth.country,
  });
  return data.lists ?? [];
}

/** Load both "to buy" and "recently bought" items for a list. */
export async function getListItems(
  auth: BringAuth,
  listUuid: string,
): Promise<BringListItems> {
  const data = await postJson<BringListItems>(
    'Get list items',
    '/api/lists/items',
    {
      email: auth.email,
      password: auth.password,
      country: auth.country,
      listUuid,
    },
  );
  return {
    purchase: data.purchase ?? [],
    recently: data.recently ?? [],
  };
}

// ── Item mutations ───────────────────────────────────────────────────

/** Add an item to the "to buy" side of a list. */
export async function addItem(
  auth: BringAuth,
  listUuid: string,
  name: string,
  spec = '',
): Promise<void> {
  await postJson('Add item', '/api/lists/items/add', {
    email: auth.email,
    password: auth.password,
    country: auth.country,
    listUuid,
    name,
    spec,
  });
}

/** Check off an item — moves it from "purchase" into "recently". */
export async function completeItem(
  auth: BringAuth,
  listUuid: string,
  item: BringItem,
): Promise<void> {
  await postJson('Complete item', '/api/lists/items/complete', {
    email: auth.email,
    password: auth.password,
    country: auth.country,
    listUuid,
    name: item.name,
  });
}

/** Un-check an item — re-add it to the "to buy" side. */
export async function uncompleteItem(
  auth: BringAuth,
  listUuid: string,
  item: BringItem,
): Promise<void> {
  await postJson('Uncomplete item', '/api/lists/items/uncomplete', {
    email: auth.email,
    password: auth.password,
    country: auth.country,
    listUuid,
    name: item.name,
    spec: item.specification,
  });
}

/** Remove an item from a list entirely. */
export async function removeItem(
  auth: BringAuth,
  listUuid: string,
  item: BringItem,
): Promise<void> {
  await postJson('Remove item', '/api/lists/items/remove', {
    email: auth.email,
    password: auth.password,
    country: auth.country,
    listUuid,
    name: item.name,
  });
}

// ── Natural-language helper for voice input ──────────────────────────

/**
 * Turn free-form speech ("two liters of milk") into a canonical
 * (name, spec) pair. Bring's catalog keys on item name, and the
 * user's locale decides what the canonical names look like.
 *
 * We use a simple strategy: the first word becomes the specification
 * modifier only if it's a number / quantity token, otherwise the
 * whole phrase becomes the name. This mirrors how a user would
 * naturally type an item into Bring.
 */
export function parseVoiceInput(raw: string): { name: string; spec: string } {
  const cleaned = raw
    .trim()
    .replace(/[.,!?;:]+$/g, '')
    .replace(/\s+/g, ' ');
  if (!cleaned) return { name: '', spec: '' };

  const lower = cleaned.toLowerCase();

  // "add X" / "buy X" / "need X" prefixes
  const stripped = lower.replace(
    /^(add|buy|get|need|put|please\s+add)\s+/,
    '',
  );

  // "X of Y" → spec=X, name=Y (e.g. "2 liters of milk")
  const ofMatch = stripped.match(/^(.+?)\s+of\s+(.+)$/);
  if (ofMatch) {
    const specPart = ofMatch[1]!.trim();
    const itemPart = ofMatch[2]!.trim();
    return {
      name: capitalize(itemPart),
      spec: specPart,
    };
  }

  // Leading quantity: "2 bananas" → spec="2", name="bananas"
  const qtyMatch = stripped.match(
    /^(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+)$/,
  );
  if (qtyMatch) {
    return {
      name: capitalize(qtyMatch[2]!.trim()),
      spec: qtyMatch[1]!.trim(),
    };
  }

  return { name: capitalize(stripped), spec: '' };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}
