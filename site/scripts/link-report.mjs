#!/usr/bin/env node
// Standalone content checker: reads notes and topics straight off disk (no
// Astro runtime needed, since links.ts/topics.ts are pure) and reports:
//   - broken note-to-note links (wikilinks, markdown links, relations)
//   - topic `sequence` entries that don't match any real note
//   - topic `parent` values that don't match any real topic
//   - tags used by notes with no corresponding topic file (informational)
//   - `cites` entries with no matching note yet (informational)
// Run directly with `npm run links` (exits 1 if anything but the last two is
// found), or from astro.config.mjs's build hook, where it only warns.
//
// Frontmatter parsing (parseFrontmatter/walkMarkdownFiles) lives in
// ./frontmatter.mjs, shared with lit-add.mjs and lit-cites.mjs.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, unresolvedCites } from '../src/lib/links.ts';
import { buildTopicTree, orderNotes, unresolvedParents, untopicedTags } from '../src/lib/topics.ts';
import { parseFrontmatter, walkMarkdownFiles } from './frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const notesDir = path.resolve(__dirname, '../src/content/notes');
const topicsDir = path.resolve(__dirname, '../src/content/topics');

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
			cites: Array.isArray(data.cites) ? data.cites : [],
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
	const uncitedTargets = unresolvedCites(noteEntries);

	return { brokenLinks, brokenSequences, brokenParents, untopiced, untaggedSequences, uncitedTargets };
}

function printReport({
	brokenLinks,
	brokenSequences,
	brokenParents,
	untopiced,
	untaggedSequences,
	uncitedTargets,
}) {
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
	if (uncitedTargets.length > 0) {
		console.log('\ncites entries with no matching note yet (informational):');
		for (const { source, target } of uncitedTargets) {
			console.log(`  ${source} -> ${target}`);
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
