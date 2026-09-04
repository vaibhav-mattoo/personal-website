#!/usr/bin/env node
// Standalone content checker: reads notes and topics straight off disk (no
// Astro runtime needed, since links.ts/topics.ts are pure) and reports:
//   - broken note-to-note links (wikilinks, markdown links, relations)
//   - topic `sequence` entries that don't match any real note
//   - topic `parent` values that don't match any real topic
//   - tags used by notes with no corresponding topic file (informational)
// Run directly with `npm run links` (exits 1 if anything but the last is
// found), or from astro.config.mjs's build hook, where it only warns.
//
// Frontmatter here is parsed with a tiny hand-rolled reader rather than a
// YAML library: nothing in site/package.json currently depends on one, and
// CLAUDE.md says not to add a dependency without asking. Note/topic
// frontmatter in this repo is a flat set of scalars, flow arrays
// (`tags: [a, b]`), and block lists of scalars/small maps
// (`relations:\n  - type: x\n    target: y`) — this parser covers exactly
// that shape, not arbitrary YAML.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../src/lib/links.ts';
import { buildTopicTree, orderNotes, unresolvedParents, untopicedTags } from '../src/lib/topics.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const notesDir = path.resolve(__dirname, '../src/content/notes');
const topicsDir = path.resolve(__dirname, '../src/content/topics');

function parseScalar(raw) {
	const v = raw.trim();
	if (v === '') return '';
	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
		return v.slice(1, -1);
	}
	if (v.startsWith('[') && v.endsWith(']')) {
		const inner = v.slice(1, -1).trim();
		return inner === '' ? [] : inner.split(',').map((s) => parseScalar(s));
	}
	if (v === 'true') return true;
	if (v === 'false') return false;
	if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
	return v;
}

function parseFrontmatterBlock(block) {
	const lines = block.split(/\r?\n/);
	const data = {};
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim() || line.trim().startsWith('#')) {
			i++;
			continue;
		}

		const topMatch = line.match(/^([\w-]+)\s*:\s*(.*)$/);
		if (!topMatch) {
			i++;
			continue;
		}
		const [, key, rest] = topMatch;

		if (rest.trim() !== '') {
			data[key] = parseScalar(rest);
			i++;
			continue;
		}

		// Block-style value: a list of scalars or a list of small maps,
		// e.g. "- item" or "- type: cites\n  target: fixture-a".
		const items = [];
		let j = i + 1;
		while (j < lines.length && /^\s*-\s*/.test(lines[j])) {
			const dashMatch = lines[j].match(/^(\s*)-\s*(.*)$/);
			const [, dashIndent, itemContent] = dashMatch;
			if (itemContent.includes(':')) {
				const map = {};
				const pairMatch = itemContent.match(/^([\w-]+)\s*:\s*(.*)$/);
				if (pairMatch) map[pairMatch[1]] = parseScalar(pairMatch[2]);
				let k = j + 1;
				const continuationIndent = dashIndent.length + 2;
				while (k < lines.length) {
					const indentMatch = lines[k].match(/^(\s*)(\S.*)?$/);
					const indent = indentMatch[1].length;
					if (!lines[k].trim() || indent < continuationIndent || /^\s*-\s*/.test(lines[k])) break;
					const nestedPair = lines[k].trim().match(/^([\w-]+)\s*:\s*(.*)$/);
					if (nestedPair) map[nestedPair[1]] = parseScalar(nestedPair[2]);
					k++;
				}
				items.push(map);
				j = k;
			} else {
				items.push(parseScalar(itemContent));
				j++;
			}
		}
		data[key] = items;
		i = j;
	}

	return data;
}

function parseFrontmatter(raw) {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { data: {}, body: raw };
	return { data: parseFrontmatterBlock(match[1]), body: match[2] };
}

/** Recursively lists .md/.mdx files under `dir`, returning ids relative to `dir` (slash-joined, extension stripped) — matches Astro's glob loader id scheme. */
async function walkMarkdownFiles(dir, baseDir = dir) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (err) {
		if (err.code === 'ENOENT') return [];
		throw err;
	}

	const out = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await walkMarkdownFiles(full, baseDir)));
		} else if (/\.(md|mdx)$/.test(entry.name)) {
			const relative = path.relative(baseDir, full).split(path.sep).join('/');
			out.push({ id: relative.replace(/\.(md|mdx)$/, ''), file: full });
		}
	}
	return out;
}

async function loadNoteEntries() {
	const files = await walkMarkdownFiles(notesDir);
	const entries = [];
	for (const { id, file } of files) {
		const raw = await readFile(file, 'utf8');
		const { data, body } = parseFrontmatter(raw);
		entries.push({
			id,
			title: typeof data.title === 'string' ? data.title : id,
			tags: Array.isArray(data.tags) ? data.tags : [],
			kind: typeof data.kind === 'string' ? data.kind : 'note',
			draft: data.draft === true,
			share: typeof data.share === 'string' ? data.share : undefined,
			aliases: Array.isArray(data.aliases) ? data.aliases : [],
			relations: Array.isArray(data.relations) ? data.relations : [],
			date: typeof data.date === 'string' ? new Date(data.date) : new Date(0),
			summary: typeof data.summary === 'string' ? data.summary : undefined,
			body,
		});
	}
	return entries;
}

async function loadTopicEntries() {
	const files = await walkMarkdownFiles(topicsDir);
	const entries = [];
	for (const { id, file } of files) {
		const raw = await readFile(file, 'utf8');
		const { data } = parseFrontmatter(raw);
		entries.push({
			id,
			title: typeof data.title === 'string' ? data.title : id,
			summary: typeof data.summary === 'string' ? data.summary : undefined,
			parent: typeof data.parent === 'string' ? data.parent : undefined,
			kind: typeof data.kind === 'string' ? data.kind : 'area',
			sequence: Array.isArray(data.sequence) ? data.sequence : [],
			hidden: data.hidden === true,
		});
	}
	return entries;
}

/**
 * Runs every check and returns the raw findings — used by both the CLI
 * entrypoint below and astro.config.mjs's build-time warning hook.
 */
export async function runLinkReport() {
	const noteEntries = await loadNoteEntries();
	const topicEntries = await loadTopicEntries();

	const { edges } = buildIndex(noteEntries);
	const brokenLinks = edges.filter((edge) => edge.broken);

	// Sequence entries are authoritative (see topics.ts): a sequence naming a
	// note that exists but isn't tagged into this topic still renders there,
	// so that's reported separately (untaggedSequences, informational) from
	// a sequence entry that names no real note at all (brokenSequences).
	const tree = buildTopicTree(topicEntries, noteEntries);
	const brokenSequences = [];
	const untaggedSequences = [];
	for (const topic of topicEntries) {
		const taggedNotes = tree.byId.get(topic.id)?.notes ?? [];
		const { unresolved, untagged } = orderNotes(topic, noteEntries, taggedNotes);
		for (const missing of unresolved) {
			brokenSequences.push({ topic: topic.id, missing });
		}
		for (const id of untagged) {
			untaggedSequences.push({ topic: topic.id, id });
		}
	}

	const brokenParents = unresolvedParents(topicEntries);
	const untopiced = untopicedTags(topicEntries, noteEntries);

	return { brokenLinks, brokenSequences, brokenParents, untopiced, untaggedSequences };
}

function printReport({ brokenLinks, brokenSequences, brokenParents, untopiced, untaggedSequences }) {
	for (const edge of brokenLinks) {
		console.log(`${edge.source} -> ${edge.target}`);
	}
	for (const { topic, missing } of brokenSequences) {
		console.log(`topic:${topic} -> ${missing} (sequence, broken)`);
	}
	for (const { id, parent } of brokenParents) {
		console.log(`topic:${id} -> ${parent} (parent)`);
	}

	if (untaggedSequences.length > 0) {
		console.log('\nSequence entries naming a real note not tagged into that topic (informational):');
		for (const { topic, id } of untaggedSequences) {
			console.log(`  topic:${topic} -> ${id}`);
		}
	}
	if (untopiced.length > 0) {
		console.log(`\nTags with no topic file (informational): ${untopiced.join(', ')}`);
	}
}

function isFailing({ brokenLinks, brokenSequences, brokenParents }) {
	return brokenLinks.length + brokenSequences.length + brokenParents.length > 0;
}

async function main() {
	const strict = process.argv.includes('--strict');
	const report = await runLinkReport();
	printReport(report);

	if (isFailing(report)) {
		const count =
			report.brokenLinks.length + report.brokenSequences.length + report.brokenParents.length;
		const message = `\n${count} broken reference${count === 1 ? '' : 's'} found.`;
		if (strict) {
			console.error(message);
			process.exitCode = 1;
		} else {
			console.warn(message);
			console.warn('(non-strict: exiting 0 — pass --strict to fail on this)');
		}
	} else {
		console.log('No broken links, sequence entries, or topic parents.');
	}
}

// Only run automatically when invoked directly (`npm run links`), not when
// imported by astro.config.mjs's build hook.
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
