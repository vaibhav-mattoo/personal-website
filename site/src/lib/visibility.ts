// Pure visibility rule — no `astro:content` import here on purpose, so it
// stays unit-testable and is the *only* place that decides whether a note
// belongs in a public listing. Everything else (vault.ts, pages) must call
// this instead of re-deriving the logic.

export type VisibilityEntry = {
	draft: boolean;
	share?: string;
};

export type VisibilityOptions = {
	isDev: boolean;
};

/**
 * A note is publicly visible unless:
 *   - it carries a `share` token (meant to be reached only via a direct
 *     share link, never surfaced in a public listing), or
 *   - it's a draft and we're not in dev.
 */
export function isVisible(entry: VisibilityEntry, { isDev }: VisibilityOptions): boolean {
	if (entry.share) return false;
	if (entry.draft && !isDev) return false;
	return true;
}
