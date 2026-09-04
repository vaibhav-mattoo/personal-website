// Shared hand-rolled frontmatter reader, used by every script under
// site/scripts/ that needs to read notes/topics off disk without booting
// Astro (link-report.mjs, lit-add.mjs, lit-cites.mjs).
//
// Not a YAML library: nothing in site/package.json depends on one, and
// CLAUDE.md says not to add a dependency without asking. Note/topic
// frontmatter in this repo is a flat set of scalars, flow arrays
// (`tags: [a, b]`), and block lists of scalars/small maps
// (`relations:\n  - type: x\n    target: y`) — this parser covers exactly
// that shape, not arbitrary YAML.

import { readdir } from 'node:fs/promises';
import path from 'node:path';

export function parseScalar(raw) {
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

export function parseFrontmatterBlock(block) {
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

export function parseFrontmatter(raw) {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { data: {}, body: raw };
	return { data: parseFrontmatterBlock(match[1]), body: match[2] };
}

/** Recursively lists .md/.mdx files under `dir`, returning ids relative to `dir` (slash-joined, extension stripped) — matches Astro's glob loader id scheme. */
export async function walkMarkdownFiles(dir, baseDir = dir) {
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
