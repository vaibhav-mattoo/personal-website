#!/usr/bin/env node
// `npm run lit:cites [-- --write]`
//
// For every paper note with a DOI, fetches its OpenAlex `referenced_works`,
// intersects them against the DOIs already in the library, and proposes
// `cites` entries — this is what builds citation lineage without hand-
// linking anything. Prints the proposed diff; writes nothing to disk unless
// `--write` is passed. Like lit-add.mjs, this is one of the only places in
// the project that makes a network call — never invoked by the build.
//
// No YAML library for editing frontmatter in place: nothing in
// site/package.json depends on one, and CLAUDE.md says not to add a
// dependency without asking. Only the `cites` field's raw text is touched;
// everything else in the file (including exact formatting) is left as-is.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, walkMarkdownFiles } from './frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const notesDir = path.resolve(__dirname, '../src/content/notes');

const USER_AGENT = 'personal-website-lit-cites/1.0 (+https://vmattoo.dev)';
const OPENALEX_BATCH_SIZE = 50;

function normalizeDoi(doi) {
	return (doi || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase();
}

async function loadPapers() {
	const files = await walkMarkdownFiles(notesDir);
	const papers = [];
	for (const { id, file } of files) {
		const raw = await readFile(file, 'utf8');
		const { data } = parseFrontmatter(raw);
		if (data.kind !== 'paper') continue;
		papers.push({
			id,
			file,
			doi: typeof data.doi === 'string' ? data.doi : undefined,
			cites: Array.isArray(data.cites) ? data.cites : [],
		});
	}
	return papers;
}

async function fetchReferencedWorks(doi) {
	const res = await fetch(
		`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`,
		{ headers: { 'User-Agent': USER_AGENT } },
	);
	if (!res.ok) throw new Error(`OpenAlex ${res.status} for ${doi}`);
	const work = await res.json();
	return Array.isArray(work.referenced_works) ? work.referenced_works : [];
}

/** Batch-resolves OpenAlex work ids (e.g. "https://openalex.org/W123") to DOIs. */
async function resolveDois(openAlexIds) {
	const shortIds = openAlexIds.map((id) => id.replace(/^https?:\/\/openalex\.org\//i, ''));
	const doiById = new Map();

	for (let i = 0; i < shortIds.length; i += OPENALEX_BATCH_SIZE) {
		const batch = shortIds.slice(i, i + OPENALEX_BATCH_SIZE);
		const res = await fetch(
			`https://api.openalex.org/works?filter=ids.openalex:${batch.join('|')}&select=id,doi&per-page=${batch.length}`,
			{ headers: { 'User-Agent': USER_AGENT } },
		);
		if (!res.ok) throw new Error(`OpenAlex batch lookup ${res.status}`);
		const { results } = await res.json();
		for (const r of results ?? []) {
			if (r.doi) doiById.set(r.id.replace(/^https?:\/\/openalex\.org\//i, ''), normalizeDoi(r.doi));
		}
	}

	return doiById;
}

// ---------------------------------------------------------------------------
// In-place `cites` field editing — touches only that one field's raw text.
// ---------------------------------------------------------------------------

function splitFrontmatter(raw) {
	const match = raw.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/);
	if (!match) return null;
	return { open: match[1], fm: match[2], close: match[3], body: match[4] };
}

function upsertCitesField(fm, mergedCites) {
	const block =
		mergedCites.length > 0
			? `cites:\n${mergedCites.map((c) => `  - ${c}`).join('\n')}`
			: 'cites: []';

	const flowRe = /^cites:\s*\[[^\]]*\]\s*$/m;
	if (flowRe.test(fm)) return fm.replace(flowRe, block);

	const blockRe = /^cites:\s*\n(?:[ \t]*-[ \t]*.*(?:\n|$))*/m;
	if (blockRe.test(fm)) return fm.replace(blockRe, `${block}\n`);

	return `${fm}\n${block}`;
}

async function applyProposal(paper, additions) {
	const raw = await readFile(paper.file, 'utf8');
	const parts = splitFrontmatter(raw);
	if (!parts) throw new Error(`${paper.file}: could not locate frontmatter block`);

	const merged = [...paper.cites];
	for (const a of additions) if (!merged.includes(a)) merged.push(a);

	const newFm = upsertCitesField(parts.fm, merged);
	await writeFile(paper.file, parts.open + newFm + parts.close + parts.body);
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main() {
	const write = process.argv.includes('--write');
	const papers = await loadPapers();
	const withDoi = papers.filter((p) => p.doi);

	if (withDoi.length === 0) {
		console.log('No paper notes with a doi — nothing to check.');
		return;
	}

	const libraryByDoi = new Map();
	for (const p of papers) {
		if (p.doi) libraryByDoi.set(normalizeDoi(p.doi), p);
	}

	const proposals = [];

	for (const paper of withDoi) {
		let referencedWorks;
		try {
			referencedWorks = await fetchReferencedWorks(paper.doi);
		} catch (err) {
			console.log(`✗ ${paper.id}: ${err.message}`);
			continue;
		}
		if (referencedWorks.length === 0) continue;

		let doiById;
		try {
			doiById = await resolveDois(referencedWorks);
		} catch (err) {
			console.log(`✗ ${paper.id}: ${err.message}`);
			continue;
		}

		const additions = [];
		for (const doi of doiById.values()) {
			const match = libraryByDoi.get(doi);
			if (match && match.id !== paper.id && !paper.cites.includes(match.id)) {
				if (!additions.includes(match.id)) additions.push(match.id);
			}
		}

		if (additions.length > 0) {
			proposals.push({ paper, additions });
		}
	}

	if (proposals.length === 0) {
		console.log('No new citation links found among papers already in the library.');
		return;
	}

	console.log(write ? 'Applying proposed citation links:\n' : 'Proposed citation links (dry run — pass --write to apply):\n');
	for (const { paper, additions } of proposals) {
		console.log(`${paper.id}:`);
		for (const a of additions) console.log(`  + ${a}`);
	}

	if (write) {
		for (const { paper, additions } of proposals) {
			await applyProposal(paper, additions);
		}
		console.log(`\nWrote ${proposals.length} note(s).`);
	} else {
		console.log('\n(dry run — nothing written; re-run with --write to apply)');
	}
}

main();
