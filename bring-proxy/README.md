# bring-proxy

A small Node.js (Express) service that wraps the [`bring-shopping`](https://github.com/foxriver76/node-bring-api) library and exposes a CORS-friendly REST API for the Bring Lens browser front-end to call.

## Why a real proxy instead of nginx pass-through

`api.getbring.com` is fronted by Cloudflare. A pure nginx reverse proxy gets 403'd by the WAF because of TLS fingerprint and datacenter ASN reputation, even after the headers are scrubbed to look like an Android client. The `bring-shopping` library uses Node 18+'s native `fetch` (undici), which produces a fingerprint Cloudflare consistently lets through — and it's the same client used by the Home Assistant integration and the ioBroker adapter, so it's well-tested in the wild.

## Architecture

**Stateless.** `bring-shopping` does not allow rehydrating a session from a cached bearer token (the token is a private field with no setter), so every incoming request constructs a fresh `Bring` instance, calls `login()`, and then performs the requested operation. The browser stores the user's email + password in the Even Realities SDK secure store and forwards them with each call.

This means:

- ~200 ms login round-trip per request. Acceptable for an app that polls every 15 s.
- The proxy holds zero state — restart-safe, horizontally scalable.
- The user's password lives on the device only (never on the proxy).
- Anyone who can reach the proxy can attempt logins against Bring with arbitrary credentials. If you expose this publicly and worry about abuse, drop in `express-rate-limit`.

## API surface

All endpoints accept JSON POST. Errors come back as `{ error: { message, kind } }` with HTTP status `401` (auth failure), `400` (validation), `502` (upstream issue), or `404` (no route).

```
GET  /healthz                        → "ok"

POST /api/login                      { email, password, country }
                                     → { name }

POST /api/lists                      { email, password, country }
                                     → { lists: [{ listUuid, name, theme }, …] }

POST /api/lists/items                { email, password, country, listUuid }
                                     → { purchase: [{ name, specification }, …],
                                         recently: [{ name, specification }, …] }

POST /api/lists/items/add            { email, password, country, listUuid, name, spec }
                                     → { ok: true }

POST /api/lists/items/complete       { email, password, country, listUuid, name }
                                     → { ok: true }

POST /api/lists/items/uncomplete     { email, password, country, listUuid, name, spec }
                                     → { ok: true }

POST /api/lists/items/remove         { email, password, country, listUuid, name }
                                     → { ok: true }
```

Notes:

- `country` is currently accepted on the wire for forward-compatibility but ignored — `bring-shopping` hard-codes `X-BRING-COUNTRY: DE`. If this ever matters we'd patch the library or fork it.
- Item names and specifications are URL-encoded inside the proxy before being handed to `bring-shopping`, because the library splices them into the request body without escaping. This means you can safely send strings containing `&`, `=`, spaces, and non-ASCII characters from the front-end.
- "Complete" and "uncomplete" both map to Bring operations: complete uses `moveToRecentList`, uncomplete uses `saveItem` again (re-adding the item to the to-buy side).

## Running

```bash
cd bring-proxy
docker compose up -d --build
```

The service is built from `Dockerfile` (Node 22 alpine) and only `expose`s port 80 on the Docker network — it is **not** bound to the host. Reach it from another container on the same network (e.g. `bring-proxy:80`) or through your TLS terminator.

Health check from inside the container:

```bash
docker compose exec bring-proxy wget -qO- http://localhost/healthz
# ok
```

Smoke-test login (run from a sibling container on the same network):

```bash
docker run --rm --network bring-proxy_default curlimages/curl:latest \
  -i -X POST http://bring-proxy/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"hunter2","country":"DE"}'
```

A successful response is `200 OK` with `{"name":"Your Display Name"}`. A bad password returns `401` with `{"error":{"message":"Cannot Login: …","kind":"auth"}}`.

## Exposing it publicly

Put your existing TLS terminator (Traefik, Caddy, Cloudflare Tunnel, ...) in front of the container and point `bring-proxy.apps.janjaap.de` at the `bring-proxy` container on port `80`. The proxy itself speaks plain HTTP — it's intentional so the terminator handles certificates. Because the service uses `expose` rather than `ports`, the terminator must share a Docker network with it.

### Example Traefik labels

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.bring-proxy.rule=Host(`bring-proxy.apps.janjaap.de`)
      - traefik.http.routers.bring-proxy.entrypoints=websecure
      - traefik.http.routers.bring-proxy.tls.certresolver=letsencrypt
      - traefik.http.services.bring-proxy.loadbalancer.server.port=80
```

### Example Caddyfile

```
bring-proxy.apps.janjaap.de {
    reverse_proxy bring-proxy:80
}
```

## Logs

The proxy logs every request as `[<timestamp>] <method> <path>`, and any failed handler logs the resulting status + error message on the next line. View them with:

```bash
docker compose logs -f bring-proxy
```
