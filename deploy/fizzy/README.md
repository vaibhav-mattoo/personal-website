# Fizzy deployment via Kamal

Fizzy (37signals' kanban) runs at `https://tasks.vmattoo.dev/` as a Docker
container deployed by [Kamal](https://kamal-deploy.org) from your local
machine into the same Azure VM as the personal site.

## Architecture

- Caddy (in this repo's Compose stack) handles TLS + routing for the
  subdomain.
- Fizzy is on a shared Docker network (`vmattoo-shared`) that Caddy also
  joins; Caddy reverse-proxies `tasks.vmattoo.dev` → `fizzy-web:80`.
- Kamal's own proxy is disabled; no port conflict with Caddy.

## One-time setup

### 1. Prerequisites

- DNS A record `tasks.vmattoo.dev` → VM IP (skip if you have wildcard).
- Fork `basecamp/fizzy` on GitHub; clone the fork locally.
- Install Kamal: `gem install kamal` (or the Docker wrapper at
  https://kamal-deploy.org/docs/installation).
- A container-registry access token (Docker Hub PAT or GHCR token).

### 2. Make sure this repo's changes are deployed first

The shared network and Caddy proxy block must exist on the VM BEFORE
running `kamal setup`. Push any pending changes to this repo, wait for
CI, then verify on the VM:

```bash
ssh vaibhav@<vm-ip> 'sudo docker network inspect vmattoo-shared >/dev/null && echo OK'
```

### 3. Configure Kamal in your Fizzy fork

From your Fizzy fork directory:

```bash
kamal init
```

Then replace the generated `config/deploy.yml` with the template at
`<this-repo>/deploy/fizzy/deploy.yml.example`. Fill in the placeholders
(`<REGISTRY-USERNAME>`, `<VM-IP>`, `<SSH-USER>`).

Copy `<this-repo>/deploy/fizzy/secrets.example` to `.kamal/secrets` in the
fork and fill in real values. **Add `.kamal/secrets` to the fork's
`.gitignore`** — never commit it.

Generate `SECRET_KEY_BASE`: `openssl rand -hex 64`.

Generate VAPID keys (used for browser push notifications). From the fork:

```bash
bundle install
bin/rails c
```

In the Rails console:

```ruby
k = WebPush.generate_key
puts "VAPID_PUBLIC_KEY=#{k.public_key}"
puts "VAPID_PRIVATE_KEY=#{k.private_key}"
exit
```

Paste those two lines into `.kamal/secrets`.

### 4. First deploy

From the fork:

```bash
bin/kamal setup
```

This installs Docker on the VM (if missing), builds + pushes the Fizzy
image to your registry, pulls + runs it on the VM in the shared network.
First run takes ~5–10 minutes.

### 5. Verify

```bash
curl -sI https://tasks.vmattoo.dev/ | head -1   # expect HTTP/2 200
```

Open `https://tasks.vmattoo.dev/` and sign up. The first account is the
owner.

## Updates

From your fork, after any code change:

```bash
bin/kamal deploy
```

Or use the wrapper:

```bash
cd <fizzy-fork>
ln -s ../personal-website/deploy/fizzy/deploy-fizzy.sh ./deploy.sh
./deploy.sh           # deploy
./deploy.sh logs      # tail logs
./deploy.sh ssh       # exec into the container
```

## Teardown

```bash
bin/kamal app remove
```

Removes the Fizzy container, volumes, and image from the VM. Caddy and
the shared network remain (they belong to this repo).
