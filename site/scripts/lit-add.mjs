#!/usr/bin/env node
// `npm run lit:add -- <identifier> [<identifier> ...]`
//
// Resolves a DOI / arXiv id / DBLP key-or-URL / bare URL into a paper note
// under site/src/content/notes/lit/, using each source's public API. This is
// the ONLY place in the whole project that makes a network call — the build
// itself (astro.config.mjs, every page) only ever reads what's already on
// disk, so `npm run build` with the network off still succeeds.
//
// No XML library for the arXiv Atom response and no YAML library for
// reading/writing frontmatter: nothing in site/package.json depends on
// either, and CLAUDE.md says not to add a dependency without asking. Uses
// the global `fetch` built into Node.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, walkMarkdownFiles } from './frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const notesDir = path.resolve(__dirname, '../src/content/notes');
const litDir = path.join(notesDir, 'lit');

const USER_AGENT = 'personal-website-lit-add/1.0 (+https://vmattoo.dev)';

// ---------------------------------------------------------------------------
// Identifier classification
// ---------------------------------------------------------------------------

/** @returns {{ type: 'arxiv' | 'doi' | 'dblp' | 'url', value: string } | null} */
function classify(raw) {
	const s = raw.trim();

	const arxivUrl = s.match(/arxiv\.org\/(?:abs|pdf)\/([a-z-]*\/?\d{4,7}(?:\.\d{4,5})?)(v\d+)?(?:\.pdf)?/i);
	if (arxivUrl) return { type: 'arxiv', value: arxivUrl[1] };

	const arxivBare = s.match(/^(?:arxiv:)?(\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(v\d+)?$/i);
	if (arxivBare) return { type: 'arxiv', value: arxivBare[1] };

	const doiUrl = s.match(/doi\.org\/(10\.\S+)$/i);
	if (doiUrl) return { type: 'doi', value: decodeURIComponent(doiUrl[1]) };

	const doiBare = s.match(/^(?:doi:)?(10\.\d{4,9}\/\S+)$/i);
	if (doiBare) return { type: 'doi', value: doiBare[1] };

	const dblpUrl = s.match(/dblp\.org\/rec\/([^\s?#]+?)(?:\.html)?$/i);
	if (dblpUrl) return { type: 'dblp', value: dblpUrl[1] };

	if (/^dblp:/i.test(s)) return { type: 'dblp', value: s.slice(5) };
	if (/^(conf|journals|series|reference|tr|phd|books)\//i.test(s)) return { type: 'dblp', value: s };

	if (/^https?:\/\//i.test(s)) return { type: 'url', value: s };

	return null;
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function decodeXmlEntities(s) {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
}

function slugPart(s) {
	return (s || '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '')
		.trim();
}

const STOPWORDS = new Set(['a', 'an', 'the', 'on', 'of', 'for', 'in', 'to']);

function firstTitleWord(title) {
	const words = (title || '')
		.toLowerCase()
		.split(/\s+/)
		.map((w) => w.replace(/[^a-z0-9]/gi, ''))
		.filter(Boolean);
	return words.find((w) => !STOPWORDS.has(w)) ?? words[0] ?? 'untitled';
}

function lastName(author) {
	const a = author.trim();
	if (a.includes(',')) return a.split(',')[0].trim();
	const parts = a.split(/\s+/);
	return parts[parts.length - 1];
}

function makeSlug({ authors, year, title }) {
	const author = slugPart(lastName(authors[0] ?? 'unknown')) || 'unknown';
	const y = year ?? 'nd';
	const word = slugPart(firstTitleWord(title)) || 'untitled';
	return `${author}${y}-${word}`;
}

function yamlString(value) {
	return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function todayIso() {
	return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Resolvers — each returns a plain metadata object or throws
// ---------------------------------------------------------------------------

async function resolveArxiv(id) {
	const res = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, {
		headers: { 'User-Agent': USER_AGENT },
	});
	if (!res.ok) throw new Error(`arXiv API ${res.status}`);
	const xml = await res.text();

	const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
	if (!entryMatch) throw new Error(`arXiv: no entry found for ${id}`);
	const entry = entryMatch[1];

	const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
	const publishedMatch = entry.match(/<published>(\d{4})-/);
	const idMatch = entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+?)(?:v\d+)?<\/id>/);
	const authors = [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map((m) =>
		decodeXmlEntities(m[1]),
	);

	if (!titleMatch || authors.length === 0) {
		throw new Error(`arXiv: incomplete record for ${id}`);
	}

	return {
		title: decodeXmlEntities(titleMatch[1]),
		authors,
		year: publishedMatch ? Number(publishedMatch[1]) : undefined,
		arxiv: idMatch ? idMatch[1] : id,
		venue: undefined,
		doi: undefined,
		url: undefined,
	};
}

async function resolveDoi(doi) {
	const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
		headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
	});
	if (!res.ok) throw new Error(`Crossref API ${res.status} for ${doi}`);
	const { message } = await res.json();
	if (!message) throw new Error(`Crossref: no record for ${doi}`);

	const title = Array.isArray(message.title) ? message.title[0] : message.title;
	const authors = Array.isArray(message.author)
		? message.author.map((a) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean)
		: [];
	const dateParts =
		message['published']?.['date-parts']?.[0] ??
		message['published-print']?.['date-parts']?.[0] ??
		message['published-online']?.['date-parts']?.[0];
	const venue = Array.isArray(message['container-title'])
		? message['container-title'][0]
		: message['container-title'];

	if (!title || authors.length === 0) {
		throw new Error(`Crossref: incomplete record for ${doi}`);
	}

	return {
		title,
		authors,
		year: dateParts ? Number(dateParts[0]) : undefined,
		venue: venue || undefined,
		doi: message.DOI || doi,
		arxiv: undefined,
		url: message.URL || undefined,
	};
}

async function resolveDblp(key) {
	const query = key.split('/').join(' ');
	const res = await fetch(
		`https://dblp.org/search/publ/api?format=json&h=1&q=${encodeURIComponent(query)}`,
		{ headers: { 'User-Agent': USER_AGENT } },
	);
	if (!res.ok) throw new Error(`DBLP API ${res.status} for ${key}`);
	const json = await res.json();
	const hit = json?.result?.hits?.hit?.[0]?.info;
	if (!hit) throw new Error(`DBLP: no hit for ${key}`);

	const rawAuthors = hit.authors?.author;
	const authors = Array.isArray(rawAuthors)
		? rawAuthors.map((a) => (typeof a === 'string' ? a : a.text)).filter(Boolean)
		: rawAuthors
			? [typeof rawAuthors === 'string' ? rawAuthors : rawAuthors.text]
			: [];

	return {
		title: hit.title?.replace(/\.$/, ''),
		authors,
		year: hit.year ? Number(hit.year) : undefined,
		venue: hit.venue || undefined,
		doi: hit.doi || undefined,
		arxiv: undefined,
		url: hit.ee || hit.url || undefined,
	};
}

// ---------------------------------------------------------------------------
// Dedup against the whole vault
// ---------------------------------------------------------------------------

function normalizeTitle(title) {
	return (title || '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

async function loadExistingPapers() {
	const files = await walkMarkdownFiles(notesDir);
	const papers = [];
	for (const { id, file } of files) {
		const raw = await readFile(file, 'utf8');
		const { data } = parseFrontmatter(raw);
		papers.push({
			id,
			file,
			doi: typeof data.doi === 'string' ? data.doi : undefined,
			arxiv: typeof data.arxiv === 'string' ? data.arxiv : undefined,
			title: typeof data.title === 'string' ? data.title : undefined,
		});
	}
	return papers;
}

function findDuplicate(existing, meta) {
	if (meta.doi) {
		const hit = existing.find((p) => p.doi && p.doi.toLowerCase() === meta.doi.toLowerCase());
		if (hit) return hit;
	}
	if (meta.arxiv) {
		const hit = existing.find((p) => p.arxiv && p.arxiv.toLowerCase() === meta.arxiv.toLowerCase());
		if (hit) return hit;
	}
	if (meta.title) {
		const wanted = normalizeTitle(meta.title);
		const hit = existing.find((p) => p.title && normalizeTitle(p.title) === wanted);
		if (hit) return hit;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// File writer
// ---------------------------------------------------------------------------

function buildFrontmatter(meta, { bibkey, stub }) {
	const lines = ['---'];
	lines.push(`title: ${yamlString(meta.title ?? 'Untitled')}`);
	lines.push(`date: ${todayIso()}`);
	lines.push(`added: ${todayIso()}`);
	lines.push(`kind: paper`);
	lines.push(`status: to-read`);
	if (meta.authors && meta.authors.length > 0) {
		lines.push('authors:');
		for (const a of meta.authors) lines.push(`  - ${yamlString(a)}`);
	} else {
		lines.push('authors: []');
	}
	if (meta.year !== undefined) lines.push(`year: ${meta.year}`);
	if (meta.venue) lines.push(`venue: ${yamlString(meta.venue)}`);
	if (meta.doi) lines.push(`doi: ${yamlString(meta.doi)}`);
	if (meta.arxiv) lines.push(`arxiv: ${yamlString(meta.arxiv)}`);
	if (meta.url) lines.push(`url: ${yamlString(meta.url)}`);
	if (meta.code) lines.push(`code: ${yamlString(meta.code)}`);
	lines.push(`bibkey: ${bibkey}`);
	lines.push('tags: []');
	lines.push('cites: []');
	lines.push('---');
	lines.push('');
	if (stub) {
		lines.push(
			'<!-- lit-add: only a bare URL was given. Fill in authors, year, and bibkey above (and doi/arxiv if you have them) before this note will pass schema validation. -->',
		);
		lines.push('');
	}
	lines.push('## Notes');
	lines.push('');
	return lines.join('\n');
}

async function writeNote(meta, { stub } = {}) {
	const slug = makeSlug(meta);
	const bibkey = slug;
	const filePath = path.join(litDir, `${slug}.md`);

	try {
		await readFile(filePath);
		return { status: 'skipped', reason: 'target file already exists', path: filePath };
	} catch {
		// Doesn't exist — good, proceed.
	}

	await mkdir(litDir, { recursive: true });
	const frontmatter = buildFrontmatter(meta, { bibkey, stub });
	await writeFile(filePath, frontmatter, { flag: 'wx' });
	return { status: 'created', path: filePath };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function resolveIdentifier(identifier) {
	const classified = classify(identifier);
	if (!classified) {
		return { status: 'error', reason: `could not classify "${identifier}"` };
	}

	if (classified.type === 'url') {
		return { status: 'stub', meta: { title: undefined, authors: [], url: classified.value } };
	}

	try {
		let meta;
		if (classified.type === 'arxiv') meta = await resolveArxiv(classified.value);
		else if (classified.type === 'doi') meta = await resolveDoi(classified.value);
		else meta = await resolveDblp(classified.value);
		return { status: 'resolved', meta };
	} catch (err) {
		return { status: 'error', reason: err.message };
	}
}

async function main() {
	const identifiers = process.argv.slice(2).filter((a) => !a.startsWith('--'));
	if (identifiers.length === 0) {
		console.error('Usage: npm run lit:add -- <doi|arxiv-id|dblp-key|url> [...]');
		process.exitCode = 1;
		return;
	}

	const existing = await loadExistingPapers();
	const summary = [];

	for (const identifier of identifiers) {
		const resolution = await resolveIdentifier(identifier);

		if (resolution.status === 'error') {
			console.log(`✗ ${identifier}: ${resolution.reason}`);
			summary.push({ identifier, outcome: 'error' });
			continue;
		}

		const meta = resolution.meta;
		const duplicate = findDuplicate(existing, meta);
		if (duplicate) {
			console.log(`= ${identifier}: already in the library -> ${duplicate.file}`);
			summary.push({ identifier, outcome: 'skipped', path: duplicate.file });
			continue;
		}

		const isStub = resolution.status === 'stub';
		const result = await writeNote(meta, { stub: isStub });

		if (result.status === 'skipped') {
			console.log(`= ${identifier}: ${result.reason} -> ${result.path}`);
			summary.push({ identifier, outcome: 'skipped', path: result.path });
			continue;
		}

		// Track it so later identifiers in the same invocation dedup against it too.
		existing.push({
			id: path.relative(notesDir, result.path).replace(/\.(md|mdx)$/, '').split(path.sep).join('/'),
			file: result.path,
			doi: meta.doi,
			arxiv: meta.arxiv,
			title: meta.title,
		});

		if (isStub) {
			console.log(`+ ${identifier}: wrote a URL-only stub -> ${result.path}`);
			console.log('  warning: fill in authors, year, and bibkey by hand before this passes schema validation.');
			summary.push({ identifier, outcome: 'created-stub', path: result.path });
		} else {
			console.log(`+ ${identifier}: created -> ${result.path}`);
			summary.push({ identifier, outcome: 'created', path: result.path });
		}
	}

	console.log('\nSummary:');
	for (const s of summary) {
		console.log(`  ${s.outcome.padEnd(14)} ${s.identifier}${s.path ? ` (${s.path})` : ''}`);
	}

	if (summary.some((s) => s.outcome === 'error')) {
		process.exitCode = 1;
	}
}

main();
