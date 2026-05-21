# VM deployment scripts

All commands go through **`deploy/deploy.sh`**. Run from a git clone or pipe the script from GitHub on a fresh VM.

## Prerequisites (any cloud VM)

1. Linux (Ubuntu 22.04+ recommended), **static public IP**
2. Firewall / NSG: inbound TCP **80** and **443**
3. DNS **A record**: your domain → VM IP

## One-time setup (fresh VM)

**Single command** (no prior clone; installs to `/opt/personal-website`):

```bash
curl -fsSL https://raw.githubusercontent.com/vaibhav-mattoo/personal-website/main/deploy/deploy.sh | sudo bash -s setup vmattoo.dev
```

Replace `vmattoo.dev` and the GitHub URL if you use a fork (`REPO_URL=...` before the command).

**From a clone:**

```bash
git clone https://github.com/vaibhav-mattoo/personal-website.git /opt/personal-website
sudo /opt/personal-website/deploy/deploy.sh setup vmattoo.dev
```

`setup` installs Docker, clones/updates the repo, builds the site in Docker (including Pagefind), and starts Caddy with HTTPS.

## Day-two operations

| Command | What it does |
|---------|----------------|
| `sudo deploy/deploy.sh update` | `git pull` + rebuild/restart (same step CI uses) |
| `sudo deploy/deploy.sh teardown` | Remove site, containers, volumes, and deploy tree |
| `deploy/deploy.sh setup-ci <user> [key.pub]` | Allow GitHub Actions SSH + passwordless `update.sh` |

## GitHub Actions (optional)

After `setup`, enable automatic deploys on push to `main`: [GITHUB_ACTIONS.md](GITHUB_ACTIONS.md).

```bash
# On the VM (once)
./opt/personal-website/deploy/deploy.sh setup-ci vaibhav ~/.ssh/personal-website-deploy.pub
```

## Verify

```bash
curl -sI "https://vmattoo.dev/"
sudo docker compose -p personal-website -f /opt/personal-website/docker-compose.yml -f /opt/personal-website/docker-compose.prod.yml ps
```

## Private repo

```bash
git clone git@github.com:you/personal-website.git /opt/personal-website
sudo /opt/personal-website/deploy/deploy.sh setup vmattoo.dev
```

## Script reference

| File | Role |
|------|------|
| `deploy.sh` | Entry point (`setup`, `update`, `teardown`, `setup-ci`) |
| `bootstrap.sh` | Called by `setup` — Docker + compose up |
| `update.sh` | Called by `update` and CI |
| `teardown.sh` | Called by `teardown` |
| `configure-github-deploy.sh` | Called by `setup-ci` |
