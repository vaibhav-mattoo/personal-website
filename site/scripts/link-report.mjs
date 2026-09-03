#!/usr/bin/env node
// Standalone link checker: reads notes straight off disk (no Astro runtime
// needed, since links.ts is pure) and prints every broken edge in the link
// graph. Run directly with `npm run links` (exits 1 if anything is broken),
// or from astro.config.mjs's build hook, where it only warns.
//
// Frontmatter here is parsed with a tiny hand-rolled reader rather than a
// YAML library: nothing in site/package.json currently depends on one, and
// CLAUDE.md says not to add a dependency without asking. Note frontmatter in
// this repo is a flat set of scalars, flow arrays (`tags: [a, b]`), and
// block lists of scalars/small maps (`relations:\n  - type: x\n    target: y`)
// — this parser covers exactly that shape, not arbitrary YAML.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../src/lib/links.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const notesDir = path.resolve(__dirname, '../src/content/notes');

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

async function loadEntries() {
	const files = (await readdir(notesDir)).filter((f) => /\.(md|mdx)$/.test(f));
	const entries = [];
	for (const file of files) {
		const raw = await readFile(path.join(notesDir, file), 'utf8');
		const { data, body } = parseFrontmatter(raw);
		const id = file.replace(/\.(md|mdx)$/, '');
		entries.push({
			id,
			title: typeof data.title === 'string' ? data.title : id,
			tags: Array.isArray(data.tags) ? data.tags : [],
			kind: typeof data.kind === 'string' ? data.kind : 'note',
			draft: data.draft === true,
			share: typeof data.share === 'string' ? data.share : undefined,
			aliases: Array.isArray(data.aliases) ? data.aliases : [],
			relations: Array.isArray(data.relations) ? data.relations : [],
			body,
		});
	}
	return entries;
}

export async function findBrokenEdges() {
	const entries = await loadEntries();
	const { edges } = buildIndex(entries);
	return edges.filter((edge) => edge.broken);
}

async function main() {
	const broken = await findBrokenEdges();
	for (const edge of broken) {
		console.log(`${edge.source} -> ${edge.target}`);
	}
	if (broken.length > 0) {
		console.error(
			`\n${broken.length} broken link${broken.length === 1 ? '' : 's'} found.`,
		);
		process.exitCode = 1;
	} else {
		console.log('No broken links.');
	}
}

// Only run automatically when invoked directly (`npm run links`), not when
// imported by astro.config.mjs's build hook.
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
