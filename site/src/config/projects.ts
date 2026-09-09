export type Project = {
	/** GitHub repo name — used for the Source link and to match GitHub stars. */
	repo: string;
	/** Optional display name. Defaults to repo. */
	name?: string;
	/** Hand-written description — always this, never GitHub's auto description. */
	blurb?: string;
	/** Human-friendly "when" (e.g. "March 2026"). Used for display + sort. */
	year: string;
	/** Optional one-line role, e.g. "Solo project", "Team lead". */
	role?: string;
	/** Optional internal link to a writeup note. */
	writeup?: string;
	/** Optional live demo URL — a second link next to Source when set. */
	demo?: string;
};

export const githubUsername = 'vaibhav-mattoo';

/**
 * To add a project:
 *   1. Push the repo to GitHub under `vaibhav-mattoo/<repo>`.
 *   2. Add an entry below — `repo` and `year` are the only required fields.
 *      `blurb` is yours to write; it's never replaced by GitHub's
 *      description (unlike the old `tagline` fallback this replaced).
 *   3. git commit && git push — CI rebuilds with fresh star counts.
 *
 * Order in this array = order on the page (top-first).
 */
export const projects: Project[] = [
	{
		repo: 'bitchat-tui',
		year: 'February 2026',
	},
	{
		repo: 'alman',
		year: 'January 2026',
	},
];
