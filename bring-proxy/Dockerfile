FROM nginx:1.27-alpine

# Bake the proxy config into the image so the container has no host
# bind-mount dependency. This makes the service portable to any
# orchestrator (Coolify, plain docker compose, Kubernetes, ...)
# without needing to pre-stage files on the host.
COPY nginx.conf /etc/nginx/conf.d/default.conf
