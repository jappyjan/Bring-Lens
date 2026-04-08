/**
 * Bring! Shopping List API client.
 *
 * Reverse-engineered from the community libraries miaucl/bring-api,
 * foxriver76/node-bring-api, and eliasball/python-bring-api. There is
 * no official public API, but the Android/Web clients all hit the
 * same base URL with the same hard-coded API key.
 *
 * Endpoints used:
 *   POST   /rest/v2/bringauth                    - login
 *   POST   /rest/v2/bringauth/token              - refresh access token
 *   GET    /rest/bringusers/{uuid}/lists         - list a user's lists
 *   GET    /rest/v2/bringlists/{listUuid}        - get items on a list
 *   PUT    /rest/v2/bringlists/{listUuid}/items  - batch add/complete/remove
 */

import { uuidv4 } from './uuid';

/**
 * Base URL of the Bring! API.
 *
 * We go through our own CORS-stripping reverse proxy because
 * `api.getbring.com` does not return `Access-Control-Allow-Origin`
 * headers, so a plain browser (including the WebView inside the Even
 * Realities companion app) cannot talk to it directly.
 *
 * The proxy mirrors the upstream path structure one-to-one:
 *   https://bring-proxy.apps.janjaap.de/<path>
 *       → https://api.getbring.com/rest/<path>
 *
 * See `bring-proxy/` in this repo for the nginx config and Docker
 * Compose definition.
 */
const BASE_URL = 'https://bring-proxy.apps.janjaap.de';

/**
 * Hard-coded API key used by the Bring Android/Web clients. Same for
 * everyone and never rotates — confirmed across all community libraries.
 */
const BRING_API_KEY = 'cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp';

/** Headers that every request (authenticated or not) must carry. */
function baseHeaders(country: string): Record<string, string> {
  return {
    'X-BRING-API-KEY': BRING_API_KEY,
    'X-BRING-CLIENT': 'android',
    'X-BRING-APPLICATION': 'bring',
    'X-BRING-COUNTRY': country,
  };
}

// ── Types ────────────────────────────────────────────────────────────

export interface BringAuth {
  uuid: string;
  publicUuid: string;
  bringListUUID: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  email: string;
  name: string;
  country: string;
}

export interface BringList {
  listUuid: string;
  name: string;
  theme: string;
}

export interface BringItem {
  uuid: string;
  itemId: string;
  specification: string;
}

export interface BringListItems {
  purchase: BringItem[];
  recently: BringItem[];
}

export type BringOperation = 'TO_PURCHASE' | 'TO_RECENTLY' | 'REMOVE';

interface BringAuthResponse {
  uuid: string;
  publicUuid: string;
  email: string;
  name: string;
  bringListUUID: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

interface BringListsResponse {
  lists: BringList[];
}

interface BringItemsResponse {
  uuid: string;
  status: string;
  items: {
    purchase: BringItem[];
    recently: BringItem[];
  };
}

// ── Error helper ─────────────────────────────────────────────────────

export class BringApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'BringApiError';
  }
}

async function throwIfNotOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  let body = '';
  try {
    body = await res.text();
  } catch {
    // ignore
  }
  throw new BringApiError(
    `${label} failed: ${res.status} ${res.statusText}`,
    res.status,
    body,
  );
}

// ── Auth ─────────────────────────────────────────────────────────────

/**
 * Log in with email + password. Returns a full BringAuth record that
 * contains everything subsequent requests need.
 */
export async function login(
  email: string,
  password: string,
  country = 'DE',
): Promise<BringAuth> {
  const form = new URLSearchParams();
  form.set('email', email);
  form.set('password', password);

  const res = await fetch(`${BASE_URL}/v2/bringauth`, {
    method: 'POST',
    headers: {
      ...baseHeaders(country),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  await throwIfNotOk(res, 'Login');
  const data = (await res.json()) as BringAuthResponse;

  return {
    uuid: data.uuid,
    publicUuid: data.publicUuid,
    bringListUUID: data.bringListUUID,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email: data.email,
    name: data.name,
    country,
  };
}

/**
 * Refresh an expired access token using the long-lived refresh token.
 */
export async function refreshAccessToken(auth: BringAuth): Promise<BringAuth> {
  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('refresh_token', auth.refreshToken);

  const res = await fetch(`${BASE_URL}/v2/bringauth/token`, {
    method: 'POST',
    headers: {
      ...baseHeaders(auth.country),
      Authorization: `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  await throwIfNotOk(res, 'Token refresh');
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    ...auth,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// ── Authenticated helper ─────────────────────────────────────────────

function authHeaders(auth: BringAuth): Record<string, string> {
  return {
    ...baseHeaders(auth.country),
    Authorization: `Bearer ${auth.accessToken}`,
    'X-BRING-USER-UUID': auth.uuid,
    'X-BRING-PUBLIC-USER-UUID': auth.publicUuid,
  };
}

// ── Lists ────────────────────────────────────────────────────────────

/**
 * Load every list owned by / shared with the signed-in user.
 */
export async function getLists(auth: BringAuth): Promise<BringList[]> {
  const res = await fetch(`${BASE_URL}/bringusers/${auth.uuid}/lists`, {
    headers: authHeaders(auth),
  });
  await throwIfNotOk(res, 'Get lists');
  const data = (await res.json()) as BringListsResponse;
  return data.lists ?? [];
}

/**
 * Load both "to buy" (purchase) and "recently bought" (recently) items
 * for a specific list.
 */
export async function getListItems(
  auth: BringAuth,
  listUuid: string,
): Promise<BringListItems> {
  const res = await fetch(`${BASE_URL}/v2/bringlists/${listUuid}`, {
    headers: authHeaders(auth),
  });
  await throwIfNotOk(res, 'Get list items');
  const data = (await res.json()) as BringItemsResponse;
  return {
    purchase: data.items?.purchase ?? [],
    recently: data.items?.recently ?? [],
  };
}

// ── Item mutations ───────────────────────────────────────────────────

interface BringChange {
  accuracy: string;
  altitude: string;
  latitude: string;
  longitude: string;
  itemId: string;
  spec: string;
  uuid: string;
  operation: BringOperation;
}

function makeChange(
  itemId: string,
  operation: BringOperation,
  spec = '',
  uuid: string = uuidv4(),
): BringChange {
  return {
    accuracy: '0.0',
    altitude: '0.0',
    latitude: '0.0',
    longitude: '0.0',
    itemId,
    spec,
    uuid,
    operation,
  };
}

/**
 * Send a batch of changes against a list. All community libraries use
 * the same v2 batch endpoint; a single request can contain many ops.
 */
export async function batchUpdate(
  auth: BringAuth,
  listUuid: string,
  changes: BringChange[],
): Promise<void> {
  const res = await fetch(`${BASE_URL}/v2/bringlists/${listUuid}/items`, {
    method: 'PUT',
    headers: {
      ...authHeaders(auth),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ changes, sender: '' }),
  });
  await throwIfNotOk(res, 'Batch update');
}

/** Add an item to the "to buy" side of a list. */
export async function addItem(
  auth: BringAuth,
  listUuid: string,
  itemId: string,
  spec = '',
): Promise<void> {
  await batchUpdate(auth, listUuid, [makeChange(itemId, 'TO_PURCHASE', spec)]);
}

/** Check off an item — moves it from "purchase" into "recently". */
export async function completeItem(
  auth: BringAuth,
  listUuid: string,
  item: BringItem,
): Promise<void> {
  await batchUpdate(auth, listUuid, [
    makeChange(item.itemId, 'TO_RECENTLY', item.specification, item.uuid),
  ]);
}

/** Un-check an item — move "recently" back into "to buy". */
export async function uncompleteItem(
  auth: BringAuth,
  listUuid: string,
  item: BringItem,
): Promise<void> {
  await batchUpdate(auth, listUuid, [
    makeChange(item.itemId, 'TO_PURCHASE', item.specification, item.uuid),
  ]);
}

/** Remove an item from a list entirely. */
export async function removeItem(
  auth: BringAuth,
  listUuid: string,
  item: BringItem,
): Promise<void> {
  await batchUpdate(auth, listUuid, [
    makeChange(item.itemId, 'REMOVE', item.specification, item.uuid),
  ]);
}

// ── Natural-language helper for voice input ──────────────────────────

/**
 * Turn free-form speech ("two liters of milk") into a canonical
 * (itemId, specification) pair. Bring's catalog keys on itemId, and
 * the user's locale decides what the canonical names look like.
 *
 * We use a simple strategy: the first word becomes the specification
 * modifier only if it's a number / quantity token, otherwise the
 * whole phrase becomes the itemId. This mirrors how a user would
 * naturally type an item into Bring.
 */
export function parseVoiceInput(raw: string): { itemId: string; spec: string } {
  const cleaned = raw
    .trim()
    .replace(/[.,!?;:]+$/g, '')
    .replace(/\s+/g, ' ');
  if (!cleaned) return { itemId: '', spec: '' };

  const lower = cleaned.toLowerCase();

  // "add X" / "buy X" / "need X" prefixes
  const stripped = lower.replace(
    /^(add|buy|get|need|put|please\s+add)\s+/,
    '',
  );

  // "X of Y" → spec=X, itemId=Y (e.g. "2 liters of milk")
  const ofMatch = stripped.match(/^(.+?)\s+of\s+(.+)$/);
  if (ofMatch) {
    const specPart = ofMatch[1]!.trim();
    const itemPart = ofMatch[2]!.trim();
    return {
      itemId: capitalize(itemPart),
      spec: specPart,
    };
  }

  // Leading quantity: "2 bananas" → spec="2", itemId="bananas"
  const qtyMatch = stripped.match(
    /^(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+)$/,
  );
  if (qtyMatch) {
    return {
      itemId: capitalize(qtyMatch[2]!.trim()),
      spec: qtyMatch[1]!.trim(),
    };
  }

  return { itemId: capitalize(stripped), spec: '' };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}
