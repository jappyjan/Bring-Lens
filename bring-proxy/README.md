# bring-proxy

A tiny nginx reverse proxy that forwards requests to `api.getbring.com`
and injects permissive CORS headers, so Bring Lens (or any other web
app) can talk to the Bring! API from a plain browser.

## What it does

- Listens on `:80` inside the container.
- Forwards every request `/<path>` → `https://api.getbring.com/rest/<path>`.
- Preserves the client's headers (`Authorization`, `X-BRING-*`, etc).
- Answers `OPTIONS` preflights directly with `Access-Control-Allow-*`.
- Strips any CORS headers Bring might set and writes its own, so the
  browser only ever sees one set.

## Running

```bash
cd bring-proxy
docker compose up -d
```

The proxy will be available on `http://localhost:8080`. Health check:

```bash
curl http://localhost:8080/healthz
# ok
```

Smoke-test against Bring!:

```bash
curl -i -X POST http://localhost:8080/v2/bringauth \
  -H 'X-BRING-API-KEY: cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp' \
  -H 'X-BRING-CLIENT: android' \
  -H 'X-BRING-APPLICATION: bring' \
  -H 'X-BRING-COUNTRY: DE' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'email=you@example.com' \
  --data-urlencode 'password=correct-horse-battery-staple'
```

You should see `Access-Control-Allow-Origin: *` on the response.

## Exposing it publicly

Put your existing TLS terminator (Traefik, Caddy, Cloudflare Tunnel, ...)
in front of the container and point `bring-proxy.apps.janjaap.de` at
port `8080`. The proxy itself speaks plain HTTP — it's intentional so
the terminator handles certificates.

### Example Traefik labels

If you use Traefik with Docker provider, drop this into the service:

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

## Security notes

- The proxy is an **open relay** for the Bring! API. Anyone who can
  reach it can make authenticated Bring! calls on behalf of whoever
  holds a valid access token. That's fine because Bring! already
  requires the access token, but if you want to lock it down further
  you can add an `allow`/`deny` block in `nginx.conf` or tie it to
  your own auth at the TLS terminator.
- The hard-coded `X-BRING-API-KEY` is baked into the Bring Android
  client; it's not a secret, every community library uses the same
  value. See the main project README for details.
- There is no rate limiting. If you expect public use, add
  `limit_req_zone` to `nginx.conf`.
