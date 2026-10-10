// Remark plugin: Obsidian block identifiers, so `[[note#^some-id]]` can link
// to a specific paragraph, list item, callout, table or plot rather than
// only to headings (remark-wikilink.mjs turns `#^some-id` into `#some-id`).
//
// Two forms, matching Obsidian:
//
//   Some paragraph or list item text. ^some-id
//       → the paragraph (or, inside a list, the list item) gets id="some-id"
//
//   ```plot
//   …
//   ```
//
//   ^some-id
//       → a paragraph that is only `^some-id` is removed and its id goes to
//         the block right before it (callout, table, list, code/plot block)
//
// Runs first in astro.config.mjs, before remark-plot (which copies the id
// onto its <figure>) and remark-callout (which keeps it on the callout).

const TRAILING_ID = /(^|\s)\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/;
const ONLY_ID = /^\s*\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/;

function setId(node, id) {
	node.data ??= {};
	node.data.hProperties = { ...node.data.hProperties, id };
}

function standaloneId(node) {
	if (node.type !== 'paragraph' || node.children.length !== 1) return null;
	const [only] = node.children;
	return only.type === 'text' ? (only.value.match(ONLY_ID)?.[1] ?? null) : null;
}

function trailingId(paragraph) {
	const last = paragraph.children.at(-1);
	if (last?.type !== 'text') return null;
	const match = last.value.match(TRAILING_ID);
	if (!match) return null;
	last.value = last.value.slice(0, match.index + match[1].length).replace(/\s+$/, '');
	if (!last.value) paragraph.children.pop();
	return match[2];
}

function visit(node) {
	if (!Array.isArray(node.children)) return;
	const kept = [];
	for (const child of node.children) {
		const id = standaloneId(child);
		if (id && kept.length > 0) {
			setId(kept.at(-1), id);
			continue;
		}
		if (child.type === 'paragraph') {
			const own = trailingId(child);
			// A compact list renders its items' paragraphs without a <p>, so
			// an id there would vanish — name the list item instead.
			if (own) setId(node.type === 'listItem' ? node : child, own);
		}
		visit(child);
		kept.push(child);
	}
	node.children = kept;
}

export default function remarkBlockIds() {
	return (tree) => visit(tree);
}
