import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPublicVault } from '../lib/vault';
import { site } from '../config/site';

// Description-only, not full rendered HTML: notes go through remark/rehype
// plugins (wikilinks, KaTeX, Mermaid, autolink headings) tuned for the
// actual page pipeline — re-rendering that safely outside a page isn't
// worth the risk here. A summary (falling back to a plain excerpt) is a
// fine, honest description for a feed reader either way.
function descriptionFor(summary: string | undefined, body: string): string {
	if (summary) return summary;
	const plain = body
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/[#>*_`[\]()~-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return plain.length > 240 ? `${plain.slice(0, 240)}…` : plain;
}

export async function GET(context: APIContext) {
	const { entries } = await getPublicVault();
	const notes = [...entries].sort((a, b) => b.date.valueOf() - a.date.valueOf());

	return rss({
		title: site.tabTitle,
		description: 'Notes and writing.',
		site: context.site!,
		items: notes.map((note) => ({
			title: note.title,
			pubDate: note.date,
			description: descriptionFor(note.summary, note.body),
			link: `/notes/${note.id}/`,
		})),
	});
}
