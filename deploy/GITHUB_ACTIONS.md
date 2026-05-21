# GitHub Actions → Azure VM deploy

Pushes to `main` run CI (typecheck + full Astro/Pagefind build), then SSH to your VM and run `deploy/update.sh` (git pull + `docker compose` rebuild).

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

1. **CI job** — `npm ci`, `astro check`, `astro build` (Pagefind index included).
2. **Deploy job** — SSH `sudo /opt/personal-website/deploy/update.sh`:
   - `git reset --hard origin/main`
   - `docker compose … up -d --build` (rebuilds static site + Caddy image on the VM)

Search and other features stay working because the production image runs the same `npm run build` pipeline as CI (including Pagefind).

## Manual deploy

**Actions → Deploy → Run workflow**, or push to `main`.

## Troubleshooting

- **Permission denied (publickey)** — wrong `DEPLOY_SSH_KEY` or key not in `authorized_keys`.
- **sudo: a password is required** — fix sudoers rule in step 1.
- **Missing deploy/update.sh** — pull latest `main` on the VM once.
- **HTTPS / certificate errors after deploy** — DNS must still point at the VM; Caddy renews certs from persisted volumes.
