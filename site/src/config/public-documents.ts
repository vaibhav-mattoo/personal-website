export type PublicDocument = {
	/** Filename inside site/public/documents/ (e.g. "thesis-draft.pdf"). */
	file: string;
	/** Display title shown as the tile heading. */
	title: string;
	/** Short description below the title. Optional. */
	description?: string;
	/** Human-friendly date, e.g. "March 2026". */
	date: string;
};

/**
 * To publish a document:
 *   1. Drop the PDF in site/public/documents/.
 *   2. Add an entry below referencing the filename.
 *   3. git push — CI rebuilds and the tile appears.
 *
 * To unpublish:
 *   1. Remove the entry from this array (tile disappears).
 *   2. Optionally also delete the file from site/public/documents/
 *      (otherwise the URL keeps working for anyone who has the link).
 *
 * Order in this array = order on the page (top-first).
 */
export const publicDocuments: PublicDocument[] = [
	// Example. Replace or empty out as needed.
	// {
	//   file: "anonymous-comms-overview.pdf",
	//   title: "Anonymous communications: an overview",
	//   description: "Background reading for the thesis intro.",
	//   date: "March 2026",
	// },
	{
	  file: "CS563Presentation.pdf",
	  title: "CS563 Presentation",
	  description: "Presentation for CS563.",
	  date: "May 2026",
	},
];

export const stirlingLoginUrl = 'https://pdfs.vmattoo.dev/';
