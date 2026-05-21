# Azure VM deployment

One-time **Azure prerequisites** (portal or CLI):

1. Linux VM (Ubuntu 22.04+ recommended) with a **static public IP**.
2. **NSG inbound rules**: allow TCP **80** and **443** from the Internet.
3. **DNS**: create an **A record** pointing your domain (e.g. `vmattoo.dev`) to the VM public IP.

Then on the VM (SSH as a user with `sudo`):

## Deploy (one command)

```bash
sudo bash -c 'git clone https://github.com/vaibhav-mattoo/personal-website.git /opt/personal-website && /opt/personal-website/deploy/bootstrap.sh vmattoo.dev'
```

Replace `vmattoo.dev` with your domain and the clone URL if your fork differs.

### Deploy (two commands)

```bash
git clone https://github.com/vaibhav-mattoo/personal-website.git /opt/personal-website
sudo /opt/personal-website/deploy/bootstrap.sh vmattoo.dev
```

The script installs Docker, opens UFW (if active), clones/updates the repo, builds the Astro site inside Docker, starts Caddy on ports 80/443 with automatic HTTPS, and runs as a daemon (`restart: always`).

Re-run the same bootstrap command to pull latest `main` and rebuild.

## Teardown (one command)

```bash
sudo /opt/personal-website/deploy/teardown.sh
```

This stops the stack, deletes containers, images, named volumes (including TLS data), removes `/opt/personal-website`, and clears `/var/lib/personal-website/deploy.env`. Delete the DNS A record separately when you want the domain fully detached.

## Verify

```bash
curl -sI "https://vmattoo.dev/"
docker compose -p personal-website -f /opt/personal-website/docker-compose.yml -f /opt/personal-website/docker-compose.prod.yml ps
```

## Private repo

Clone with your credentials first, then run bootstrap from that directory (it will use the existing tree):

```bash
git clone git@github.com:you/personal-website.git /opt/personal-website
sudo /opt/personal-website/deploy/bootstrap.sh vmattoo.dev
```
