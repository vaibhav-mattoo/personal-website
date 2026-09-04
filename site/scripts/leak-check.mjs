#!/usr/bin/env node
// `npm run leak-check` — run against a finished `site/dist` build. For every
// note with a `share` token, asserts it only exists at its own /s/<token>/
// page and nowhere else in the built output: not its body text, not its id
// or title, not a canary string from its body, not in graph.json. Also
// asserts the share page itself carries noindex + data-pagefind-ignore.
//
// Wired into `npm run build` (site/package.json: `astro build &&
// node scripts/leak-check.mjs`) so a leak fails the build, not just this
// standalone check.

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, walkMarkdownFiles } from './frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const notesDir = path.resolve(__dirname, '../src/content/notes');
const distDir = path.resolve(__dirname, '../dist');

/** Recursively lists every file under `dir` (any extension), absolute paths. */
async function walkAllFiles(dir) {
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
		if (entry.isDirectory()) out.push(...(await walkAllFiles(full)));
		else out.push(full);
	}
	return out;
}

/**
 * A distinctive, markdown-syntax-free plain-text signature for a note body:
 * the longest "prose" line (no heading/list/fence markers), with the most
 * common inline markdown tokens stripped and whitespace collapsed, so it
 * should appear verbatim (module reflow/whitespace) in the rendered HTML.
 */
function bodySignature(body) {
	const lines = body
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l && !/^(#{1,6}\s|```|~~~|[-*+]\s|\d+\.\s|>)/.test(l));
	if (lines.length === 0) return null;
	const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), lines[0]);
	const plain = longest
		.replace(/[*_`]/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
	// A short/degenerate line isn't a reliable signature — better to skip the
	// body-text check for this note than to false-positive on common words.
	return plain.length >= 20 ? plain : null;
}

function stripHtmlToText(html) {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

async function loadSharedNotes() {
	const files = await walkMarkdownFiles(notesDir);
	const shared = [];
	for (const { id, file } of files) {
		const raw = await readFile(file, 'utf8');
		const { data, body } = parseFrontmatter(raw);
		if (typeof data.share !== 'string' || !data.share) continue;
		shared.push({
			id,
			title: typeof data.title === 'string' ? data.title : id,
			token: data.share,
			signature: bodySignature(body),
		});
	}
	return shared;
}

async function exists(p) {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

async function main() {
	if (!(await exists(distDir))) {
		console.error(`leak-check: ${distDir} does not exist — run \`astro build\` first.`);
		process.exitCode = 1;
		return;
	}

	const shared = await loadSharedNotes();
	if (shared.length === 0) {
		console.log('leak-check: no notes carry a share token — nothing to check.');
		return;
	}

	const allFiles = await walkAllFiles(distDir);
	const htmlFiles = allFiles.filter((f) => f.endsWith('.html'));
	const graphJsonFiles = allFiles.filter((f) => path.basename(f) === 'graph.json');

	const textCache = new Map();
	async function readText(f) {
		if (!textCache.has(f)) textCache.set(f, await readFile(f, 'utf8').catch(() => ''));
		return textCache.get(f);
	}

	const failures = [];

	for (const note of shared) {
		const shareDirPrefix = path.join(distDir, 's', note.token) + path.sep;
		const expectedPath = path.join(distDir, 's', note.token, 'index.html');

		if (!(await exists(expectedPath))) {
			failures.push(
				`${note.id} (share ${note.token}): expected page missing — ${path.relative(distDir, expectedPath)} was not built.`,
			);
			continue;
		}

		// 1. Body text appears in exactly one file, and it's the share page.
		if (note.signature) {
			const matches = [];
			for (const f of htmlFiles) {
				const text = stripHtmlToText(await readText(f));
				if (text.includes(note.signature)) matches.push(f);
			}
			const onlyExpected = matches.length === 1 && matches[0] === expectedPath;
			if (!onlyExpected) {
				const rel = matches.map((f) => path.relative(distDir, f)).join(', ') || '(none)';
				failures.push(
					`${note.id}: body text found in ${matches.length} file(s) — [${rel}] — expected exactly dist/s/${note.token}/index.html`,
				);
			}
		}

		// 2. id / title / canary nowhere else in dist, outside the share dir.
		const needles = [note.id, note.title];
		if (note.signature) needles.push(note.signature);
		for (const f of allFiles) {
			if (f.startsWith(shareDirPrefix)) continue;
			const raw = await readText(f);
			for (const needle of needles) {
				if (needle && raw.includes(needle)) {
					failures.push(
						`${note.id}: "${needle}" found in ${path.relative(distDir, f)} (outside its share directory)`,
					);
				}
			}
		}

		// 3. graph.json specifically must not contain the id (named explicitly,
		// on top of the general sweep above, for a clearer failure message).
		for (const f of graphJsonFiles) {
			const raw = await readText(f);
			if (raw.includes(`"${note.id}"`)) {
				failures.push(`${note.id}: found in ${path.relative(distDir, f)}`);
			}
		}

		// 4. The share page itself carries noindex + data-pagefind-ignore.
		const shareHtml = await readText(expectedPath);
		if (!/<meta\s+name=["']robots["']\s+content=["']noindex,\s*nofollow["']/i.test(shareHtml)) {
			failures.push(`${note.id}: share page is missing <meta name="robots" content="noindex, nofollow">`);
		}
		if (!/data-pagefind-ignore/.test(shareHtml)) {
			failures.push(`${note.id}: share page is missing data-pagefind-ignore`);
		}
	}

	if (failures.length > 0) {
		console.error(`leak-check: ${failures.length} problem(s) found:\n`);
		for (const f of failures) console.error(`  ✗ ${f}`);
		console.error('');
		process.exitCode = 1;
		return;
	}

	console.log(`leak-check: ${shared.length} shared note(s) checked, no leaks found.`);
}

main();
