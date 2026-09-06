# Notes/topics content repo

Notes and topics content (`site/src/content/notes/`, `site/src/content/topics/`)
lives in a separate, private repo: `vaibhav-mattoo/notes` (local clone at
`~/Projects/notes`). This repo (`personal-website`) never tracks that
content — see `.gitignore` — it's synced in by `deploy/sync-notes.sh`
before anything that reads it (`npm run dev`/`check`/`build`, via the
`predev`/`precheck`/`prebuild` hooks in `package.json`).

## How it flows

1. A note/topic is edited and pushed to `master` in the notes repo.
2. Its `.github/workflows/notify-deploy.yml` fires and dispatches a
   `notes-updated` event to this repo's `deploy.yml`
   (`repository_dispatch`).
3. That runs CI (typecheck + build, with the notes repo cloned in for
   real content) and then, on success, SSHes into the Azure VM and runs
   `deploy/update.sh`, which itself calls `deploy/sync-notes.sh` to pull
   the latest notes content before rebuilding the Docker image.

Locally, `deploy/sync-notes.sh` prefers `NOTES_LOCAL_PATH` (a plain
`rsync`, no git) over cloning, so day-to-day editing in the notes repo's
working tree shows up in `npm run dev` immediately, committed or not.

## One-time manual setup (not something this repo's code can do for you)

- **Local dev**: export `NOTES_LOCAL_PATH=/home/vaibhav/Projects/notes`
  (e.g. in your shell profile) so `sync-notes.sh` rsyncs from the local
  checkout instead of cloning over the network.
- **CI** (`.github/workflows/ci.yml`): generate an SSH keypair, add the
  *public* half as a read-only Deploy Key on the `vaibhav-mattoo/notes`
  GitHub repo, and add the *private* half as this repo's
  `NOTES_DEPLOY_KEY` secret (Settings → Secrets and variables → Actions).
- **VM deploy** (`deploy/update.sh`, runs as root via
  `sudo /opt/personal-website/deploy/update.sh`): install a (or the same)
  deploy-key private half somewhere root's SSH can use it — e.g.
  `/root/.ssh/notes_deploy_key` plus a `~/.ssh/config` entry:
  ```
  Host github.com-notes
      HostName github.com
      User git
      IdentityFile /root/.ssh/notes_deploy_key
      IdentitiesOnly yes
  ```
  and point `sync-notes.sh` at it by setting `NOTES_REPO_URL` in
  `/var/lib/personal-website/deploy.env` to
  `git@github.com-notes:vaibhav-mattoo/notes.git`. Also make sure
  `rsync` is installed on the VM (`apt install rsync` / `apk add rsync`).
- **Dispatch token** (notes repo's `notify-deploy.yml`): create a
  fine-grained GitHub PAT scoped to `vaibhav-mattoo/personal-website`
  with "Actions: Read and write" permission, and add it as the notes
  repo's `PERSONAL_WEBSITE_DISPATCH_TOKEN` secret.

None of the above can be done from a git checkout alone — they're GitHub
repo/secret settings and VM-side SSH config.
