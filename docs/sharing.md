# Sharing a note privately

A note can be published at an unguessable URL — `/s/<token>/` — without
appearing anywhere else on the site: not the notes index, not tag/topic
pages, not the graph, not search, not backlinks on other notes. Enforced at
build time by `npm run leak-check` (wired into `npm run build`, so a leak
fails the build, not just a manual check).

## How to share a note

1. Generate a token:

   ```sh
   npm run new-share
   ```

   This prints a 32-character hex string
   (`crypto.randomBytes(16).toString('hex')` — 128 bits of entropy).

2. Add it to the note's frontmatter:

   ```yaml
   share: 3f9c2a1e8b7d4f60a1c9e2d7b6f4a805
   ```

3. (Optional) Give it an expiry — past this date the page simply stops being
   built, and the link goes dead:

   ```yaml
   shareUntil: 2026-12-31
   ```

4. Build and deploy. The note is now at:

   ```
   https://<your-domain>/s/3f9c2a1e8b7d4f60a1c9e2d7b6f4a805/
   ```

   Send that URL to whoever you're sharing it with. The page carries
   `noindex, nofollow`, is excluded from the search index
   (`data-pagefind-ignore`), and shows no backlinks, no local graph, and no
   links to any other note — it doesn't reveal that anything else in the
   vault exists.

   The recipient can leave comments on the page without an account (Waline,
   nickname only) — replies land scoped to that page's own path, so they
   don't mix with comments anywhere else on the site.

## How to revoke access

A share has no server-side "off switch" — it's just a page that either gets
built or doesn't. To revoke:

- **Immediately**: remove the `share` field from the note's frontmatter (or
  set `shareUntil` to a past date) and rebuild + redeploy. The `/s/<token>/`
  page is no longer generated — the next deploy simply doesn't produce that
  file.
- **Rotate instead of revoke**: run `npm run new-share` again and replace the
  token. The old URL 404s; the new one is live once deployed.

Until you rebuild and redeploy, the existing link keeps working — see the
threat model below.

## Threat model — read this before sharing anything sensitive

**An unguessable URL is capability-based access, not authentication.**
Anyone who has the link — the person you sent it to, someone they forward it
to, a browser history sync, a link preview bot, a proxy log — can view the
page. There is no login, no password, no per-recipient identity. Possession
of the URL *is* the access control.

Concretely, this means:

- The link is only as private as every place it's ever been pasted (chat,
  email, a ticket, a Slack thread that gets archived and re-indexed
  somewhere).
- **Revocation is not instant.** The page exists in the *currently deployed*
  build until you remove the `share` field (or let `shareUntil` pass) **and**
  rebuild **and** redeploy. If someone has already fetched the page, or a
  cache/CDN in front of the site has it, removing it from the source doesn't
  retroactively un-fetch it.
- `noindex, nofollow` and `data-pagefind-ignore` keep well-behaved crawlers
  and this site's own search from indexing it — they do not stop a browser
  extension, an email/link-preview fetcher, or a person with the URL from
  reading it. They reduce *discoverability*, not *access*.
- Anything genuinely sensitive (credentials, anything you'd be unhappy to see
  leaked from a forwarded link) doesn't belong behind a capability URL at
  all — use the authenticated tier below instead.

If you need actual authentication — a real "only this specific person, with
a password, until I say otherwise" guarantee — the next tier up is HTTP
basic auth on the path in Caddy, in front of the same static file. It's
commented out below because it needs a hashed password you generate
yourself (`caddy hash-password`) and doesn't fit this repo's "one static
`npm run build` output, no server-side secrets" model — but it's a small,
well-understood step up when a capability link genuinely isn't enough.

```caddyfile
# Next tier up: real authentication instead of an unguessable URL.
# Uncomment and fill in a real hash (`caddy hash-password`) to require a
# password for a specific share path. Narrow the `handle` path to the one
# note you actually want gated — don't apply this to all of /s/*, or you've
# just re-invented "everyone shares one password" instead of per-note links.
#
# handle /s/3f9c2a1e8b7d4f60a1c9e2d7b6f4a805/* {
# 	basic_auth {
# 		<username> <bcrypt-hash-from-caddy-hash-password>
# 	}
# 	file_server
# }
```
