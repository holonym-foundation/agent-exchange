# Hosted perpetual-pass demo — deploy on aex Hetzner via Docker

Self-contained: one image with dashboard + perpetual loop manager + waap-cli + jq. The dashboard exposes Start/Stop loop buttons so the entire demo lifecycle (signup → trade → policy edits → pause/resume) is driveable from the browser. State persists in a named Docker volume.

> **Target host:** the existing `aex` Hetzner box that already runs the AEX product agents (cetus, morpho, polymarket per [`agent-runtime.md`](../../../../internal-docs/products/waap/prd/aex/agent-runtime.md)).
> **Demo wallets:** `webmaster+pass1@holonym.id` / `+pass2` / `+pass3` (Shady-authorized).
> **Funding:** seed from the local `pass-demo` wallets via [`fund-from-fleet.sh`](./fund-from-fleet.sh) — no faucet needed.

---

## Stage 0 — local capability check (laptop)

```bash
cd ~/human-tech/aex && git pull && cd packages/aex-fleet
EMAIL_BASE=shady@holonym.id ./examples/local-capability-check.sh
```

If that's clean (6 hops, pause/resume worked, state.json populated), proceed.

---

## Stage 1 — build the image locally and smoke

```bash
cd ~/human-tech/aex/packages/aex-fleet
docker build -t aex-fleet:dev .
docker run --rm -it \
  -p 127.0.0.1:3001:3001 \
  -v aex-fleet-demo:/var/lib/aex-fleet \
  aex-fleet:dev
# In a browser: http://localhost:3001
#   1. Click ▶ Start, enter EMAIL_BASE=webmaster@holonym.id
#   2. After signup completes, copy the 3 addresses from the agent table
#   3. Stop the container (Ctrl-C). The volume keeps the session.json + fleet.json.
```

The signup creates `webmaster+pass1/2/3@holonym.id` accounts on WaaP. Stage 2 funds them.

---

## Stage 2 — fund the new hosted wallets from your local fleet

Back on your laptop (where `pass-1/2/3` already hold ~3 ETH Sepolia between them):

```bash
# Register the new hosted addresses locally so we can send to them by id
aex-fleet add hosted-pass-1 --chain sepolia --address 0xCOPY_FROM_STAGE_1 --tag hosted-target
aex-fleet add hosted-pass-2 --chain sepolia --address 0xCOPY_FROM_STAGE_1 --tag hosted-target
aex-fleet add hosted-pass-3 --chain sepolia --address 0xCOPY_FROM_STAGE_1 --tag hosted-target

# 0.05 × 3 sources × 3 recipients = 0.45 ETH total, 0.15 per recipient → ~3 months runtime
./examples/fund-from-fleet.sh \
  --from-tag pass-demo \
  --to hosted-pass-1,hosted-pass-2,hosted-pass-3 \
  --amount 0.05 --yes
```

---

## Stage 3 — push the image to the aex host

Two routes:

### 3a. Push to a registry (cleaner)

```bash
# Pick a registry your aex host has pull access to (Docker Hub, GHCR, etc.)
docker tag aex-fleet:dev ghcr.io/holonym-foundation/aex-fleet:latest
docker push ghcr.io/holonym-foundation/aex-fleet:latest
```

### 3b. Or ship the tarball over ssh (no registry needed)

```bash
docker save aex-fleet:dev | gzip | ssh aex 'gunzip | docker load'
```

---

## Stage 4 — bring it up on aex

SSH to the aex Hetzner box and:

```bash
mkdir -p /opt/aex-fleet && cd /opt/aex-fleet
# Copy docker-compose.yml from this repo (scp from your laptop or recreate):
#   scp ~/human-tech/aex/packages/aex-fleet/docker-compose.yml aex:/opt/aex-fleet/

# If using a registry, edit docker-compose.yml so build: is replaced with image: ghcr.io/…/aex-fleet:latest
# Otherwise the local image: aex-fleet:dev is used as-is.

docker compose up -d
docker compose logs -f aex-fleet
```

Healthcheck flips green within ~30s. Dashboard is at `http://127.0.0.1:3001` on the host — wire it to a reverse proxy for public access.

### 4a. Reverse-proxy + auth

Whatever fronts the existing AEX dashboards on the aex host (Caddy / Nginx / Traefik) gets a new vhost for `aex-fleet-demo.aex.human.tech` (or whatever subdomain you pick) → `http://127.0.0.1:3001`. Examples:

**Caddy:**
```
aex-fleet-demo.aex.human.tech {
  reverse_proxy 127.0.0.1:3001
  # Optional Authelia
  forward_auth authelia.example.com:9091 {
    uri /api/verify?rd=https://authelia.example.com
    copy_headers Remote-User Remote-Groups Remote-Email
  }
}
```

**Nginx:**
```nginx
server {
  server_name aex-fleet-demo.aex.human.tech;
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
  }
  # auth_request /authelia ... per your existing setup
}
```

### 4b. Start the loop from the UI

In the browser:
1. Click **▶ Start** on the "Perpetual loop" card
2. Enter `EMAIL_BASE=webmaster@holonym.id` (saved to localStorage so you only do this once per browser)
3. Optionally tweak DELAY (default 300s = 5 min between hops) + AMOUNT
4. Hit **Start**

Within ~15s the loop's first hop confirms. Table at the bottom shows the tx. `⏸ Pause` and `▶ Resume` work via the pause file. `■ Stop` SIGTERMs the managed child.

---

## Stage 5 — monitoring + refill

When any hosted wallet drops below ~0.005 ETH (dashboard balance column goes red-ish or shows < 0.005):

```bash
# from your laptop
./examples/fund-from-fleet.sh \
  --from-tag pass-demo \
  --to hosted-pass-1,hosted-pass-2,hosted-pass-3 \
  --amount 0.05 --yes
```

For a hands-off setup, wire Karon (or whichever cron-bot already runs on aex) to:
1. Curl `https://aex-fleet-demo.aex.human.tech/api/state` hourly
2. Alert on `min(agents.*.telemetry.lastBalance) < 0.005` to `#feed-ops` Matrix

---

## Cleanup

```bash
# on aex
docker compose down -v   # -v drops the volume too — nukes everything

# on laptop
for n in 1 2 3; do aex-fleet rm hosted-pass-$n; done
# webmaster+pass1/2/3 WaaP accounts remain — recoverable via login from any machine
```

---

## Decisions baked in

- **Image:** node:20-bookworm-slim + waap-cli + jq + bash + dumb-init. ~250 MB compressed.
- **Process model:** dashboard is PID 1; perpetual loop spawned as managed child via the Start button. dumb-init reaps zombies if the child crashes.
- **Volume:** `/var/lib/aex-fleet` named volume — holds `fleet.json`, `sessions/<agent>/session.json`, `sandboxes/<agent>/.waap-agent/`, `perpetual-pass.state.json`, `perpetual-pass.log.jsonl`. Backup with `docker run --rm -v aex-fleet-data:/data -v "$PWD":/out alpine tar czf /out/aex-fleet-backup.tar.gz -C /data .`
- **Port:** dashboard binds `0.0.0.0:3001` inside the container; `docker-compose.yml` maps to `127.0.0.1:3001` on the host so the reverse proxy is the only thing exposed publicly.
- **Auth:** none in the container; reverse proxy handles it. The mutation endpoints (pause/resume/policy/start/stop) are only reachable from things that can hit `127.0.0.1:3001` on the host — i.e., the reverse proxy and root.
- **No supervisord:** the loop is supervised by the dashboard process. If it dies, the dashboard reports `lastExitCode` + waits for the operator to click Start again. Demo-grade; for productionized agents use the existing `agent-runtime` systemd-on-host pattern instead.

---

## Where this fits in the broader stack

- This is the **AEX demo surface** — a self-contained "see fleet ops work live" experience.
- It is **not** the productionized agent runtime (cetus/morpho/polymarket on aex are separate systemd services per [`agent-runtime.md`](../../../../internal-docs/products/waap/prd/aex/agent-runtime.md)).
- Migrating real production agents into the same dashboard view is future work — needs the Neon DSN wired + the existing agent IDs registered locally (the existing `aex-fleet status` already pulls from Neon, so this is mostly a config exercise).
