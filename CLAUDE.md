# CLAUDE.md

Guidance for AI agents working in this repo.

## Project shape

npm workspaces root; the actual site lives in `site/` (Astro 5-style content
collections API, currently running on the Astro 6 package — see note below).
Root `package.json` only proxies scripts into the `site` workspace:

```
npm run dev      # -> site: astro dev
npm run check    # -> site: astro check
npm run build    # -> site: astro build (also runs pagefind indexing)
npm run preview  # -> site: astro preview
```

Always run `check` and `build` from the **repo root**, not from inside `site/`,
so they resolve the same way CI does.

## Content collections

- Notes are defined in `site/src/content.config.ts` using `defineCollection`
  with the `glob` loader (`astro/loaders`), pattern `**/*.{md,mdx}` rooted at
  `site/src/content/notes`.
- A note's `id` **is its slug** — this is the glob loader's default and pages
  rely on it directly (e.g. `pages/notes/[...slug].astro` maps `params.slug`
  straight to `note.id`, and `/notes/${note.id}/` is used as the canonical
  URL everywhere: notes index, tag pages, backlinks).
- Frontmatter schema (Zod): `title: string`, `date: coerce.date()`,
  `summary?: string`, `tags: string[]` (default `[]`).
- Don't add a second content collection or change the loader without checking
  whether `getBacklinks` (`site/src/lib/backlinks.ts`) and the tag pages still
  hold up — they assume `note.id`/`note.data` shapes exactly as above.

## Code organization

- **Pure logic vs. Astro-aware wrappers.** Modules that do parsing, graph
  building (e.g. backlink resolution), or filtering should not import
  `astro:content`, so they can be unit tested with `node --test`. Keep the
  `astro:content`-importing wrapper (the part that calls `getCollection()`)
  as thin as possible and leave it untested — it's glue, not logic.
  `site/src/lib/backlinks.ts` currently violates this (the graph-walk and the
  `getCollection` call are fused in one function) — new code should split
  this pattern going forward rather than copy it.
- `site/src/lib/` — logic shared across pages/components (backlinks, theme
  persistence, GitHub API fetch, UI event binding).
- `site/src/config/` — static, hand-edited data (site metadata, color
  schemes, sidebar nav, projects list, public boards/documents). These are
  plain `.ts` files with exported consts, not content collections — that's
  intentional for small hand-maintained lists.
- `site/src/components/` — one Astro (or `.tsx` for the one interactive
  piece, `SidebarDrawer`) component per concern. Components own their own
  `<style>` block (scoped by Astro by default); shared cross-cutting styles
  live in `site/src/styles/`.
- `site/src/pages/` — thin: fetch via `getCollection`/props, then render.
  Page-specific one-off styles are inlined in the page's own `<style>` block;
  styles used by more than one page/component move to `site/src/styles/`.

## Styling conventions

- **Indentation is tabs** in `.astro`, `.ts`, and `.css` files. Match
  whatever surrounds the code you're editing.
- **All colors come from CSS custom properties** defined in
  `site/src/styles/tokens.css` (`--bg`, `--fg`, `--muted`, `--border`,
  `--accent`, `--accent-soft`, `--card`, `--code-bg`, `--rail`, plus layout
  tokens like `--radius`, `--radius-lg`, `--content-width`, `--toc-width`).
  Never hardcode a hex/rgb value in a component or page — add a token if one
  doesn't exist yet.
- Theming is two independent axes set as `data-*` attributes on `<html>`:
  `data-mode` (`light` | `dark`) and `data-scheme` (`lavender` | `pink` |
  `yellow` | `green` | `blue`, see `site/src/config/themes.ts`). Every visual
  change must be checked in **both** `data-mode="light"` and
  `data-mode="dark"` — tokens.css defines the full palette per mode, and
  scheme accents are defined per `[data-scheme][data-mode]` pair.
  `ThemeScript.astro` applies the stored/default values before first paint to
  avoid a flash; `lib/theme.ts` handles runtime switching + persistence to
  `localStorage`.
- `color-mix(in srgb, ...)` is the established way to derive translucent /
  blended variants of a token (e.g. `--accent-soft`, toolbar backdrop tint)
  rather than adding a new static color token for every blend.
- Font stacks are tokens too: `--font-body` (system-ui) for prose/UI text,
  `--font-display` (ui-monospace) for headings-as-labels, meta lines, and
  anything meant to read as terminal/code.

## Astro/content patterns already in place

- `astro.config.mjs` wires: `@astrojs/react` (for `SidebarDrawer`),
  `astro-expressive-code` (code blocks — themed via CSS vars through
  `styleOverrides`, not hardcoded colors), `@astrojs/mdx`, `astro-mermaid`,
  `remark-math` + `rehype-katex` (KaTeX), `rehype-autolink-headings` (adds
  `.heading-anchor` `#` links), `rehype-figure`, and a custom `pagefind`
  integration hook that runs `npx pagefind --site <dir>` after build.
- Search (`pages/search.astro` / `SearchBox.astro`) only returns real results
  after a full `build` — pagefind indexes are generated at build time, not in
  dev.
- `getStaticPaths` is used for both the note slug pages and the tag pages
  (`pages/notes/tags/[...tag].astro` — a rest param, so `/notes/tags/research/`
  and `/notes/tags/research/cheminformatics/` both route through it); tag
  pages pass pre-filtered/sorted notes through `props`, not by re-querying in
  the page body.

## Fixtures & known content

- `site/src/content/notes/fixture-a.md` contains a deliberate broken wikilink,
  `[[does-not-exist]]` — it's there specifically to exercise broken-link
  detection (`site/test/links.test.mjs`, `npm run links`). **Do not "fix" it**;
  removing it or pointing it at a real note breaks that test's coverage.
  The `fixture-a`/`fixture-b`/`fixture-c` notes (tag: `fixture`) are all
  disposable test fixtures for the link/topic system, safe to delete as a set
  if the fixture approach is ever replaced, but not to "clean up" individually.
- A topic's `hidden: true` (`site/src/content.config.ts`'s `topics` schema)
  only suppresses that node from its parent's "Subtopics" list and from the
  nested tree on `/notes/tags/`. It does **not** 404 the topic's own page
  (still reachable directly, and still generated by
  `pages/notes/tags/[...tag].astro`'s `getStaticPaths`), and it does **not**
  remove the topic's notes from ancestor rollups — rollup is purely tag-path
  based (`tagAncestors` in `site/src/lib/topics.ts`) and doesn't consult
  `hidden` at all.

## Process rules

- **Never commit to `main`** (this repo's default branch — there is no
  `master`). Every task gets its own branch, created off whatever the current
  branch is at the time.
- **Never push** anywhere unless explicitly asked.
- **Do not add a dependency without asking first.**
- **Before claiming a task is done**, run `npm run check` and `npm run build`
  from the repo root and confirm both pass. If either fails, the task isn't
  done yet — fix it or report the failure, don't report success.
