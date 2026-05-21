# personal-website

Static personal site (Astro) served by Caddy in Docker.

## Run on any machine (single command)

Requires [Docker](https://docs.docker.com/get-docker/) and Docker Compose v2.

```bash
git clone <repo-url> personal-website && cd personal-website
docker compose up --build
```

- **HTTP:** http://localhost:8080 → redirects to `https://localhost:8443` (mapped host port; Caddy’s automatic redirect is disabled so the `Location` header keeps `:8443`)
- **HTTPS:** https://localhost:8443 (Caddy `tls internal`; use a browser or `curl -k`; some host `curl` builds fail TLS to `127.0.0.1` even with `-k` — use `localhost` or test inside the container)

The image builds the full site from source inside Docker: content collections, math, syntax highlighting, and the Pagefind search index. No host Node.js or `npm install` is required.

Access logs are structured JSON on stdout (`docker compose logs -f caddy`). Edge rate limiting is enabled (default 30 requests per 30s per host locally; see `docker-compose.override.yml`).

### Production VM (Azure or any Linux server)

**Prerequisites:** static public IP, NSG/firewall allows TCP 80 and 443, DNS **A record** for your domain → that IP.

**Deploy (one command on the VM):**

```bash
curl -fsSL https://raw.githubusercontent.com/vaibhav-mattoo/personal-website/main/deploy/deploy.sh | sudo bash -s setup vmattoo.dev
```

**Update / teardown:**

```bash
sudo /opt/personal-website/deploy/deploy.sh update
sudo /opt/personal-website/deploy/deploy.sh teardown
```

See [deploy/README.md](deploy/README.md) for all commands, forks, and private repos.

### CI/CD

After [one-time GitHub Actions setup](deploy/GITHUB_ACTIONS.md), every push to `main` rebuilds and restarts the site on your Azure VM (including the Pagefind search index).

Manual compose (without bootstrap):

```bash
SITE_DOMAIN=vmattoo.dev docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Uses `Caddyfile.prod` (automatic TLS for `SITE_DOMAIN`), binds ports 80/443, stricter rate limits (100/min), and restart/resource policies.

## Local development (without Docker)

```bash
cp .env.example .env   # optional overrides
npm install
npm run dev
```

Dev server: http://127.0.0.1:4321. Search needs a production build (`npm run build && npm run preview`).
