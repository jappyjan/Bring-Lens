FROM node:22-alpine

WORKDIR /app

# Install production dependencies first so the layer is cacheable
# across server.js edits.
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy the actual application source.
COPY server.js ./

# Install wget so the docker-compose healthcheck (which lives in the
# alpine base by default) can hit /healthz from inside the container.
RUN apk add --no-cache wget

EXPOSE 80

CMD ["node", "server.js"]
