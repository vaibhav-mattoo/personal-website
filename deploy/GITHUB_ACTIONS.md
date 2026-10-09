# GitHub Actions → Azure VM deploy

Pushes to `main` (and notes-repo pushes, via `repository_dispatch`) run CI, which builds the whole site (Astro + Pagefind). The deploy job uploads that build to the VM with `rsync`, switches the live site to it, then runs `deploy/update.sh` (git pull + a cheap `docker compose up` that only rebuilds the Caddy image if it changed).

## One-time VM setup

SSH into the VM (`23.100.73.113` or your hostname) as the user GitHub will use (`vaibhav` on this project’s Azure VM).

### 1. VM script (sudoers + SSH key)

On your laptop, create a key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/personal-website-deploy -N "" -C "github-actions-deploy"
```

On the **VM** (after the site is deployed):

```bash
/opt/personal-website/deploy/deploy.sh setup-ci vaibhav ~/.ssh/personal-website-deploy.pub
```

(Or copy the `.pub` to the VM and pass its path there. Defaults to `vaibhav` if you omit the username.)

Test:

```bash
ssh -i ~/.ssh/personal-website-deploy vaibhav@23.100.73.113 'sudo /opt/personal-website/deploy/update.sh'
```

### 2. Ensure the site is deployed

If not already done:

```bash
curl -fsSL https://raw.githubusercontent.com/vaibhav-mattoo/personal-website/main/deploy/deploy.sh | sudo bash -s setup vmattoo.dev
```

**Already running an older deploy?** You do not need teardown. Pull and rebuild:

```bash
sudo /opt/personal-website/deploy/deploy.sh update
```

(If `deploy.sh` is not on the VM yet: `cd /opt/personal-website && sudo git pull origin main && sudo chmod +x deploy/*.sh`, then run `update` or `setup` again.)

## GitHub repository secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Example | Description |
|--------|---------|-------------|
| `DEPLOY_HOST` | `23.100.73.113` | VM public IP or DNS |
| `DEPLOY_USER` | `vaibhav` | SSH user |
| `DEPLOY_SSH_KEY` | *(private key)* | Full contents of `personal-website-deploy` (no passphrase) |
| `DEPLOY_PORT` | `22` | Optional; omit to use 22 |

## What runs on each push to `main`

1. **CI job** — `npm ci`, `astro check` (skipped for notes-only deploys), `npm run build` with production settings (`.env.example` + `vmattoo.dev` + the comments URL), Pagefind included. Astro's rendered-notes store is cached between runs, keyed on the markdown plugins/config/schema/lockfile, so only changed notes re-render. The built `site/dist` is uploaded as the `site-dist` artifact.
2. **Deploy job** (as `DEPLOY_USER`, no sudo for the upload):
   - `rsync` the build to `~/personal-website-web/releases/<run>/`, hard-linking files unchanged from the live release.
   - Swap `~/personal-website-web/current` to it atomically — the site is live from this moment, since Caddy bind-mounts that directory (`docker-compose.prod.yml`, `root * /web/current` in `Caddyfile.prod`).
   - `sudo /opt/personal-website/deploy/update.sh`: `git reset --hard origin/main`, then `docker compose … up -d --build` for the Caddy-only `server` image target (cached unless the Dockerfile/Caddy changed).
   - Prune all but the newest five releases.

Rolling back is a symlink swap on the VM: `ln -sfn releases/<older> ~/personal-website-web/current.tmp && mv -Tf ~/personal-website-web/current.tmp ~/personal-website-web/current`.

## Manual deploy

**Actions → Deploy → Run workflow**, or push to `main`.

## Troubleshooting

- **Permission denied (publickey)** — wrong `DEPLOY_SSH_KEY` or key not in `authorized_keys`.
- **sudo: a password is required** — fix sudoers rule in step 1.
- **Missing deploy/update.sh** — pull latest `main` on the VM once.
- **HTTPS / certificate errors after deploy** — DNS must still point at the VM; Caddy renews certs from persisted volumes.
