/**
 * Fastfetch-style key/value rows on the home page (FastFetch.astro).
 * Plain-English keys only — non-technical visitors land here, this isn't
 * `uname -a`. Notes/Projects counts are computed at render time and
 * appended by FastFetch.astro itself; keep this list at 4 rows or fewer
 * so the combined total stays within the 7-row cap.
 */
export type AboutRow = {
	key: string;
	value: string;
};

export const aboutRows: AboutRow[] = [
	{ key: 'Name', value: 'Vaibhav' },
	// TODO: fill these in — left as placeholders rather than guessed.
	{ key: 'Role', value: 'add a one-line role/focus here' },
	{ key: 'Based in', value: 'add a location, or delete this row' },
	{ key: 'Currently', value: "add what you're working on right now" },
];
