#!/usr/bin/env node
// One-shot codemod (report only — never rewrites anything) for the
// theorem-environment callout rewrite: walks notes/**/*.md and reports
// every `[!TYPE]` marker and every hand-rolled `<details><summary>` block,
// so old content can be converted by hand. Choosing between
// THEOREM/LEMMA/REMARK (or which markers should fold) is a judgement
// call this script deliberately does not make.
//
// Usage:
//   node scripts/migrate-callouts.mjs [--dir <path>]
// Defaults to $NOTES_LOCAL_PATH/notes if --dir isn't given (matches the
// same env var deploy/sync-notes.sh and the npm scripts use locally).
//
// Not part of the build — run by hand when migrating old content.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, walkMarkdownFiles } from './frontmatter.mjs';

const MARKER_LINE = /^\s*>\s*\[!([A-Z]+)\]([-+])?/;
const DETAILS_OPEN = /<details\b/i;
const SUMMARY = /<summary[^>]*>(.*?)<\/summary>/i;

function parseArgs(argv) {
	const dirFlagIndex = argv.indexOf('--dir');
	const dir = dirFlagIndex !== -1 ? argv[dirFlagIndex + 1] : undefined;
	return { dir };
}

function resolveNotesDir(cliDir) {
	if (cliDir) return cliDir;
	if (process.env.NOTES_LOCAL_PATH) return path.join(process.env.NOTES_LOCAL_PATH, 'notes');
	return null;
}

/** Scans one file's body, tracking fenced-code-block state so a marker or
 *  a <details> tag typed inside a ```code fence``` isn't reported — those
 *  are examples, not real callouts to migrate. */
function scanBody(body) {
	const lines = body.split(/\r?\n/);
	const markers = [];
	const detailsBlocks = [];
	let inFence = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		const markerMatch = MARKER_LINE.exec(line);
		if (markerMatch) {
			markers.push({ lineNumber: i + 1, type: markerMatch[1], fold: markerMatch[2] ?? null, text: line.trim() });
		}

		if (DETAILS_OPEN.test(line)) {
			// The <summary> is very often on the line right after <details>,
			// occasionally the same line — check both before giving up.
			const summaryMatch = SUMMARY.exec(line) ?? SUMMARY.exec(lines[i + 1] ?? '');
			detailsBlocks.push({
				lineNumber: i + 1,
				summary: summaryMatch ? summaryMatch[1].replace(/<\/?[^>]+>/g, '').trim() : null,
			});
		}
	}

	return { markers, detailsBlocks };
}

async function main() {
	const { dir: cliDir } = parseArgs(process.argv.slice(2));
	const notesDir = resolveNotesDir(cliDir);

	if (!notesDir) {
		console.error('Usage: node scripts/migrate-callouts.mjs --dir <path-to-notes>');
		console.error('(or set NOTES_LOCAL_PATH so --dir can be inferred)');
		process.exitCode = 1;
		return;
	}

	const files = await walkMarkdownFiles(notesDir);
	if (files.length === 0) {
		console.log(`migrate-callouts: no .md/.mdx files found under ${notesDir}`);
		return;
	}

	let totalMarkers = 0;
	let totalDetails = 0;
	let filesWithFindings = 0;

	for (const { id, file } of files) {
		const raw = await readFile(file, 'utf8');
		const { body } = parseFrontmatter(raw);
		const { markers, detailsBlocks } = scanBody(body);

		if (markers.length === 0 && detailsBlocks.length === 0) continue;

		filesWithFindings++;
		totalMarkers += markers.length;
		totalDetails += detailsBlocks.length;

		console.log(`\n${id} (${file})`);
		for (const m of markers) {
			const flag = m.fold ? ` (fold: ${m.fold})` : '';
			console.log(`  L${m.lineNumber}: [!${m.type}]${flag} — ${m.text}`);
		}
		for (const d of detailsBlocks) {
			const summary = d.summary ? ` — summary: "${d.summary}"` : ' — summary not found on the same/next line';
			console.log(`  L${d.lineNumber}: <details>${summary}`);
		}
	}

	console.log(
		`\nmigrate-callouts: ${filesWithFindings} file(s), ${totalMarkers} marker(s), ${totalDetails} <details> block(s).`,
	);
	if (filesWithFindings === 0) {
		console.log('Nothing to migrate.');
	}
}

main();
