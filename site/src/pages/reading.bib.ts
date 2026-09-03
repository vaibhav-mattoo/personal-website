import type { APIRoute } from 'astro';
import { getPublicVault } from '../lib/vault';
import type { VaultEntry } from '../lib/vault';

// Static BibTeX export — prerendered at build time, like every other page.
// Only notes with a bibkey are included; everything else (kind, status,
// etc.) is irrelevant here. getPublicVault() means drafts/shared notes never
// appear, same rule as every other public listing.
export const prerender = true;

// Braces delimit fields in BibTeX/biblatex, so a literal '{' or '}' in a
// title/venue/author must be escaped or it would prematurely close the
// field. UTF-8 text (accents, etc.) is left as-is — biber reads UTF-8 .bib
// files natively, no LaTeX-escaping needed.
function escapeBib(value: string): string {
	return value.replace(/([{}])/g, '\\$1');
}

function bibEntry(p: VaultEntry): string {
	const fields: string[] = [];
	if (p.authors.length > 0) {
		fields.push(`  author = {${escapeBib(p.authors.join(' and '))}}`);
	}
	fields.push(`  title = {${escapeBib(p.title)}}`);
	if (p.year !== undefined) fields.push(`  year = {${p.year}}`);
	if (p.venue) fields.push(`  note = {${escapeBib(p.venue)}}`);
	if (p.doi) fields.push(`  doi = {${p.doi}}`);
	if (p.arxiv) {
		fields.push(`  eprint = {${p.arxiv}}`);
		fields.push(`  eprinttype = {arxiv}`);
		fields.push(`  archiveprefix = {arXiv}`);
	}
	if (p.url) fields.push(`  url = {${p.url}}`);

	// @misc keeps every entry valid under biber regardless of venue —
	// @article/@inproceedings each have their own required fields
	// (journal/booktitle) that not every note here will have filled in.
	return `@misc{${p.bibkey},\n${fields.join(',\n')}\n}`;
}

export const GET: APIRoute = async () => {
	const { entries } = await getPublicVault();
	const withBibkey = entries.filter((e): e is VaultEntry & { bibkey: string } => Boolean(e.bibkey));
	const body = `${withBibkey.map(bibEntry).join('\n\n')}\n`;

	return new Response(body, {
		headers: { 'Content-Type': 'application/x-bibtex; charset=utf-8' },
	});
};
