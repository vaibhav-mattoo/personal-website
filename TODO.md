# Build Order (todo.md)

Build in this order. Each step produces something you can verify **in
isolation** before the next step exists. Do not start step N+1 until step N's
checkpoint passes. The ordering follows dependencies: dependency-free core
first, infrastructure last, the optional backend only when actually needed.

The principle: every layer wraps an already-known-good core, so when something
breaks you know it is in the layer you just added.

---

## Step 1 — Astro skeleton + one plain page

**Build:** `npm create astro@latest site` (minimal template). One page at
`src/pages/index.astro` with literal "hello" content. Nothing else.

**Isolation test:** `npm run dev`, open the page. It renders. View source:
confirm **zero JavaScript** is shipped. This proves the toolchain and the
zero-JS-by-default property before any complexity exists.

---

## Step 2 — Design tokens + theming system

**Build:** `styles/tokens.css` (all color variables; one block per scheme; a
`light`/`dark` block), `config/themes.ts` (scheme registry),
`components/ThemeScript.astro` (no-flash init), `ThemePicker.astro`,
`ModeToggle.astro`. Wire onto a static throwaway page.

**Isolation test:** in the browser, switch schemes (purple→pink→…) and toggle
dark mode; the page recolors with no flash on reload; choice persists across
refresh. No content, no layout, no backend involved — this is pure CSS + ~10
lines of init script, fully testable alone.

---

## Step 3 — Layout shell: full-screen + texture + togglable sidebar

**Build:** `layouts/Base.astro` (full-screen shell), `texture.css`,
`Sidebar.astro` (sections hardcoded *for now*), `SidebarToggle.astro` with the
`data-sidebar` state + `localStorage` persistence. Implement the responsive
control placement (top-right phone / top-left laptop) here.

**Isolation test:** at a desktop width the sidebar collapses/expands and content
goes full-screen; at a phone width it overlays; state survives reload; theme
controls sit on the correct side at each breakpoint. Still no real content, no
backend — a pure layout/CSS checkpoint.

---

## Step 4 — Terminal header component

**Build:** `TerminalHeader.astro` — the `user@vmattoo.dev:~$` prompt motif,
clean, monospace only for the prompt.

**Isolation test:** drop it on the throwaway page; it reads as a terminal banner
in both light and dark and with every color scheme. Single isolated component.

---

## Step 5 — Content collections + sample content

**Build:** `src/content/config.ts` with typed schemas for
`notes/papers/projects/tasks`; add 2–3 sample `.md`/`.mdx` files per collection
(include an image and a code block in one note); section list/detail page
templates (`notes/index.astro`, `notes/[...slug].astro`).

**Isolation test:** the sample notes render with correct typography, syntax
highlighting, and an optimized image; breaking the frontmatter fails the build
(schema works). This validates the entire notes system with no backend.

---

## Step 6 — Data-drive the sidebar

**Build:** `config/sidebar.ts`; refactor `Sidebar.astro` to generate from it;
delete the hardcoded list.

**Isolation test:** add a fake section in one line of config → it appears and
routes correctly. Remove it → gone. Proves "extensible by editing data."

---

## Step 7 — Containerize the static build + Caddy

**Build:** `site/Dockerfile` (build → static `dist/`), minimal `Caddyfile`
serving the folder, a one-service `docker-compose.yml`.

**Isolation test:** `docker compose up`; the fully built site is served by Caddy
locally and behaves identically to `npm run dev`. Isolates "does it containerize
and serve correctly" from app logic.

---

## Step 8 — Compose + Caddy edge concerns

**Build:** add local TLS, access logging, and an edge rate-limit rule to the
`Caddyfile`; add `override`/`prod` compose files.

**Isolation test:** HTTPS works locally; access logs are structured JSON;
hammering a path triggers the rate limit. Edge layer verified against an
already-good static site.

---

## Step 9 — (Only if needed) API sidecar

Skip entirely unless/until you have a genuine heavy dynamic service.

**Build:** `api/` FastAPI app — factory, config, structlog, `/healthz`,
`/metrics`, one real endpoint, `slowapi` on it. Add to compose as an off-by-
default profile; Caddy proxies `/api/*`.

**Isolation test:** first test the API alone with FastAPI `TestClient` (no
Docker, no Caddy). Then enable the profile and confirm `/api/...` works through
Caddy while the static site is unaffected when the profile is off.

---

## Step 10 — CI/CD

**Build:** `.github/workflows/ci.yml` (lint + typecheck + `astro build` on PRs)
and `deploy.yml` (build, push image, deploy on `main`).

**Isolation test:** open a PR → CI runs and blocks on a deliberate type error.
Merge → site updates with no manual commands.

---

## Step 11 — Provisioning as code

**Build:** `deploy/cloud-init.yaml` + `bootstrap.sh`; optionally
`deploy/terraform/` for the Azure VM/IP/NSG.

**Isolation test:** a fresh VM (or local VM) boots from cloud-init and serves
the site with no manual steps. Proves "deployable elsewhere."

---

## Step 12 — Observability (last)

**Build:** `observability/` Prometheus + Loki + Grafana as an off-by-default
compose profile; dashboards as code.

**Isolation test:** enable the profile; Grafana shows Caddy traffic (and API
metrics if the sidecar exists). Disable it; the site is unaffected. Observability
never blocks the site.

---

### Summary of the dependency logic

1–6 are the site itself, each a pure browser/build checkpoint with no
infrastructure. 7–8 wrap it in the edge. 9 is optional and additive. 10–12 are
automation and operations around an already-working system. At no point are you
debugging two new layers at once.
