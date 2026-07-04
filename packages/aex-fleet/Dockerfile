# aex-fleet dashboard + perpetual loop in one container.
# - Dashboard binds 0.0.0.0:3001 inside the container (network isolation is the boundary).
# - Loop is spawned as a managed child via the dashboard's Start button (or eagerly via env).
# - State persists at /var/lib/aex-fleet (declare a volume in compose).

FROM node:20-bookworm-slim AS build

WORKDIR /opt/aex-fleet
COPY package.json package-lock.json* tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm ci --include=dev && npm run build && npm prune --omit=dev

# ─── runtime image ───────────────────────────────────────────────────────────
FROM node:20-bookworm-slim

# bash for the perpetual loop, jq + perl + curl for its helpers, ca-certs for RPCs
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash curl jq perl ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*

# waap-cli pinned to the same major as we test against
RUN npm install -g @human.tech/waap-cli@1.0.2

# /opt/aex-fleet is the asset root that server.ts / dashboard.ts resolveAsset() falls back to.
WORKDIR /opt/aex-fleet
COPY --from=build /opt/aex-fleet/package.json ./
COPY --from=build /opt/aex-fleet/node_modules ./node_modules
COPY --from=build /opt/aex-fleet/dist ./dist
COPY public ./public
COPY examples ./examples
COPY SKILL.md README.md KNOWN_ISSUES.md ./

# Make perpetual-pass-loop.sh findable via the managed-loop fallback path.
RUN mkdir -p /usr/local/share/aex-fleet \
    && cp examples/perpetual-pass-loop.sh /usr/local/share/aex-fleet/perpetual-pass-loop.sh \
    && chmod +x /usr/local/share/aex-fleet/perpetual-pass-loop.sh \
    && chmod +x examples/*.sh

# Make the CLI globally available
RUN ln -sf /opt/aex-fleet/dist/index.js /usr/local/bin/aex-fleet && chmod +x /opt/aex-fleet/dist/index.js

# State / sessions / sandboxes / log all live here
ENV AEX_FLEET_HOME=/var/lib/aex-fleet
RUN mkdir -p /var/lib/aex-fleet && chmod 700 /var/lib/aex-fleet
VOLUME /var/lib/aex-fleet

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3001/api/state >/dev/null || exit 1

# dumb-init reaps zombies from the perpetual-loop child if it's spawned via the dashboard
ENTRYPOINT ["dumb-init", "--"]
CMD ["aex-fleet", "dashboard", "--port", "3001", "--host", "0.0.0.0", "--no-open"]
