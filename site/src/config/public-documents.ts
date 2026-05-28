export type PublicDocument = {
	title: string;
	description?: string;
	/** Human-friendly date, e.g. "March 2026". Optional. */
	date?: string;
	/** Where the document lives — any URL (arxiv, Drive, an S3 bucket, etc.). */
	url: string;
};

/**
 * Documents I want to surface on /notes/documents/.
 *
 * To publish:
 *   1. Get the public URL of the document (must be reachable without auth).
 *   2. Add an entry below.
 *   3. git commit && git push — CI rebuilds the site.
 * To unpublish: delete the entry.
 *
 * Order in this array = order on the page (top-first).
 */
export const publicDocuments: PublicDocument[] = [
	// Example — replace or remove:
	// {
	//   title: 'Anonymous communication: a survey',
	//   description: 'Background reading I keep coming back to.',
	//   date: 'March 2026',
	//   url: 'https://arxiv.org/abs/0000.00000',
	// },
	{
	  title: 'Algorithmic game theory',
	  description: 'My annotations of the book "Algorithmic game theory"',
	  date: 'May 2026',
	  url: 'https://web.goodnotes.com/s/5NUwlIiQHp5SFoKXEUb5BV#page-1',
	},
];
