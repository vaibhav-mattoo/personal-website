export type Project = {
	/** GitHub repo name (matches the slug in the URL). */
	slug: string;
	/** Optional display name. Defaults to slug. */
	name?: string;
	/** Optional override. Defaults to the repo's GitHub description. */
	tagline?: string;
	/** Human-friendly date (e.g. "March 2026"). Used for display + sort. */
	date: string;
	/** Optional internal link to a writeup note. */
	writeup?: string;
	/** Optional live demo URL. */
	url?: string;
};

export const githubUsername = 'vaibhav-mattoo';

/**
 * To add a project:
 *   1. Push the repo to GitHub under `vaibhav-mattoo/<slug>`.
 *   2. Add an entry below — `slug` and `date` are the only required fields.
 *   3. (Optional) override `tagline` or `name` if the GitHub description
 *      isn't what you want shown.
 *   4. git commit && git push — CI rebuilds with fresh star counts.
 *
 * Order in this array = order on the page (top-first).
 */
export const projects: Project[] = [
	{
		slug: 'bitchat-tui',
		date: 'February 2026',
	},
	{
		slug: 'alman',
		date: 'January 2026',
	},
];
