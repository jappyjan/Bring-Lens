/**
 * Bring Lens proxy.
 *
 * A small Express app that wraps the `bring-shopping` library and
 * exposes a tiny REST API the Bring Lens browser front-end can call
 * directly with permissive CORS.
 *
 * Why this exists: api.getbring.com is fronted by Cloudflare, which
 * 403s plain reverse-proxy traffic from datacenter IPs no matter how
 * carefully the headers are scrubbed. The `bring-shopping` library is
 * the well-worn community client (used by Home Assistant and ioBroker)
 * and reaches the upstream cleanly. Wrapping it in an HTTP service
 * gives us a CORS-friendly endpoint with real error handling.
 *
 * Architecture: stateless. The library does not allow rehydrating a
 * session from a cached bearer token (the token is a private field
 * with no setter), so every request creates a fresh `Bring` instance,
 * calls `login()`, and then performs the requested operation. The
 * front-end stores the user's email + password in the Even Realities
 * SDK secure store and forwards them with each call.
 */

const express = require('express');
const cors = require('cors');
const Bring = require('bring-shopping');

const PORT = Number(process.env.PORT) || 80;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

// Permissive CORS — this proxy is designed to be hit from any browser
// origin (Vercel preview deploys, localhost dev, the production site).
// Express handles preflight automatically once we install this.
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86400,
  }),
);

// 64 KiB is plenty for any of our request bodies (login + a list uuid
// + an item name + a free-text spec). Bigger bodies almost certainly
// indicate misuse and we'd rather fail fast than buffer megabytes.
app.use(express.json({ limit: '64kb' }));

// ── Logging ──────────────────────────────────────────────────────────

app.use((req, _res, next) => {
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] ${req.method} ${req.path}`);
  next();
});

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Validate the credential fields every authenticated endpoint needs.
 * Returns null if valid, otherwise an error string for the response.
 */
function validateCredentials(body) {
  if (!body || typeof body !== 'object') return 'Body must be JSON.';
  if (typeof body.email !== 'string' || !body.email.trim()) {
    return 'Field "email" is required.';
  }
  if (typeof body.password !== 'string' || !body.password) {
    return 'Field "password" is required.';
  }
  return null;
}

/**
 * The library throws plain `Error` instances with no status code. The
 * canonical login failure prefix is "Cannot Login: ..." (verified in
 * the published source). Use that to distinguish 401 from 502.
 */
function statusForError(err) {
  const msg = err && err.message ? String(err.message) : '';
  if (msg.startsWith('Cannot Login')) return 401;
  return 502;
}

/**
 * Build a fresh Bring instance and run the action against it. The
 * library expects the credentials field to be called `mail`, not
 * `email`, so the front-end's `email` is mapped here.
 */
async function withBring(body, fn) {
  const bring = new Bring({ mail: body.email, password: body.password });
  await bring.login();
  return fn(bring);
}

/**
 * Wrap an async route handler so thrown errors become structured JSON
 * with the right HTTP status, and the express process never crashes
 * on an unhandled rejection from inside a handler.
 */
function handler(fn) {
  return async (req, res) => {
    const validationError = validateCredentials(req.body);
    if (validationError) {
      res.status(400).json({ error: { message: validationError, kind: 'validation' } });
      return;
    }
    try {
      await fn(req, res);
    } catch (err) {
      const status = statusForError(err);
      const message = err && err.message ? String(err.message) : 'Unknown error';
      console.warn(`  → ${status} ${message}`);
      res.status(status).json({
        error: {
          message,
          kind: status === 401 ? 'auth' : 'upstream',
        },
      });
    }
  };
}

// `bring-shopping` does not URL-encode `itemName` / `specification`
// before splicing them into the request body. Strings containing `&`,
// `=`, `\n`, or non-ASCII characters would otherwise corrupt the form
// payload. Encode here so the library's raw concatenation lands in
// the right form field.
function encode(value) {
  if (value == null) return '';
  return encodeURIComponent(String(value));
}

// ── Routes ───────────────────────────────────────────────────────────

// Health endpoint — used by the docker-compose healthcheck and by the
// front-end's "Test proxy" diagnostic. Plain GET, no auth, no CORS
// preflight (no custom headers required).
app.get('/healthz', (_req, res) => {
  res.type('text/plain').send('ok');
});

// Validate credentials. Returns the friendly display name set by Bring
// during login so the front-end can show it on the settings screen.
app.post(
  '/api/login',
  handler(async (req, res) => {
    const data = await withBring(req.body, async (bring) => ({
      name: bring.name || null,
    }));
    res.json(data);
  }),
);

// All of the user's lists.
app.post(
  '/api/lists',
  handler(async (req, res) => {
    const data = await withBring(req.body, async (bring) => {
      const out = await bring.loadLists();
      return { lists: Array.isArray(out && out.lists) ? out.lists : [] };
    });
    res.json(data);
  }),
);

// Items on a single list, split into "to buy" and "recently bought".
app.post(
  '/api/lists/items',
  handler(async (req, res) => {
    const { listUuid } = req.body;
    if (typeof listUuid !== 'string' || !listUuid) {
      res.status(400).json({ error: { message: 'Field "listUuid" is required.', kind: 'validation' } });
      return;
    }
    const data = await withBring(req.body, async (bring) => {
      const out = await bring.getItems(listUuid);
      return {
        purchase: Array.isArray(out && out.purchase) ? out.purchase : [],
        recently: Array.isArray(out && out.recently) ? out.recently : [],
      };
    });
    res.json(data);
  }),
);

// Add an item to the to-buy side of a list.
app.post(
  '/api/lists/items/add',
  handler(async (req, res) => {
    const { listUuid, name, spec } = req.body;
    if (typeof listUuid !== 'string' || !listUuid) {
      res.status(400).json({ error: { message: 'Field "listUuid" is required.', kind: 'validation' } });
      return;
    }
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: { message: 'Field "name" is required.', kind: 'validation' } });
      return;
    }
    await withBring(req.body, (bring) => bring.saveItem(listUuid, encode(name), encode(spec)));
    res.json({ ok: true });
  }),
);

// Check off an item — moves it from purchase → recently in Bring.
app.post(
  '/api/lists/items/complete',
  handler(async (req, res) => {
    const { listUuid, name } = req.body;
    if (typeof listUuid !== 'string' || !listUuid) {
      res.status(400).json({ error: { message: 'Field "listUuid" is required.', kind: 'validation' } });
      return;
    }
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: { message: 'Field "name" is required.', kind: 'validation' } });
      return;
    }
    await withBring(req.body, (bring) => bring.moveToRecentList(listUuid, encode(name)));
    res.json({ ok: true });
  }),
);

// Un-check an item — re-adds it to the to-buy side. Bring's API does
// not have a dedicated un-check operation; saving with the same name
// puts it back on the purchase list.
app.post(
  '/api/lists/items/uncomplete',
  handler(async (req, res) => {
    const { listUuid, name, spec } = req.body;
    if (typeof listUuid !== 'string' || !listUuid) {
      res.status(400).json({ error: { message: 'Field "listUuid" is required.', kind: 'validation' } });
      return;
    }
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: { message: 'Field "name" is required.', kind: 'validation' } });
      return;
    }
    await withBring(req.body, (bring) => bring.saveItem(listUuid, encode(name), encode(spec)));
    res.json({ ok: true });
  }),
);

// Delete an item entirely from a list.
app.post(
  '/api/lists/items/remove',
  handler(async (req, res) => {
    const { listUuid, name } = req.body;
    if (typeof listUuid !== 'string' || !listUuid) {
      res.status(400).json({ error: { message: 'Field "listUuid" is required.', kind: 'validation' } });
      return;
    }
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: { message: 'Field "name" is required.', kind: 'validation' } });
      return;
    }
    await withBring(req.body, (bring) => bring.removeItem(listUuid, encode(name)));
    res.json({ ok: true });
  }),
);

// Catch-all 404 with CORS-friendly JSON so browser callers see something
// useful instead of an HTML error page.
app.use((req, res) => {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}`, kind: 'not_found' } });
});

// ── Process-level safety nets ─────────────────────────────────────────

// A single broken request must not bring down the whole proxy.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

app.listen(PORT, HOST, () => {
  console.log(`bring-proxy listening on http://${HOST}:${PORT}`);
});
