# syntax=docker/dockerfile:1
# Base image; a mirror or a pinned digest can be passed with
#   --build-arg NODE_IMAGE=...
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
# better-sqlite3 is compiled here from its source code instead of downloading
# a prebuilt binary, using the Node headers that ship with the image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
ENV npm_config_build_from_source=true \
  npm_config_nodedir=/usr/local
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# AGPL-3.0, section 13: the image carries the exact source it was built from,
# served at /source, so users can get it even on a server without Internet.
RUN mkdir -p source \
  && tar --exclude=./node_modules --exclude=./dist --exclude=./source \
    --exclude=./data -czf /tmp/source.tar.gz . \
  && mv /tmp/source.tar.gz source/drawdb-collaborative-source.tar.gz
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS production
LABEL org.opencontainers.image.title="drawDB Collaborative" \
  org.opencontainers.image.description="Self-hosted collaborative database diagram editor" \
  org.opencontainers.image.licenses="AGPL-3.0"
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/drawdb.sqlite
# The server shells out to git for diagram repository sync, and needs an SSH
# client plus CA certificates to reach remotes.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/collaboration ./src/collaboration
COPY --from=build /app/source ./source
COPY --from=build /app/LICENSE ./LICENSE
RUN install -d -o node -g node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/auth/status').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/index.js"]
