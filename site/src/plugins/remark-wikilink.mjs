// Remark plugin: rewrites [[wikilink]] syntax in note bodies into mdast
// `link` nodes pointing at /notes/<target>/ (plus #anchor when given), with
// a `wikilink` class for styling. It does NOT check whether the target
// actually resolves to a real note — that's `buildIndex`'s job (see
// site/src/lib/links.ts) and `npm run links` (site/scripts/link-report.mjs)
// surfaces anything broken. This plugin only has to run before remarkMath in
// astro.config.mjs so wikilinks inside prose (not inside math) get rewritten
// before math delimiters are parsed.
//
// Operates on the already-parsed mdast tree, so fenced code blocks (`code`
// nodes) and inline code spans (`inlineCode` nodes) are naturally untouched:
// this only ever rewrites `text` node children, and code nodes are leaves of
// a different type.

const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g;

function parseWikilinkInner(inner) {
	let target = inner.trim();
	let alias;

	const pipeIndex = inner.indexOf('|');
	if (pipeIndex !== -1) {
		target = inner.slice(0, pipeIndex).trim();
		alias = inner.slice(pipeIndex + 1).trim();
	}

	let anchor;
	const hashIndex = target.indexOf('#');
	if (hashIndex !== -1) {
		anchor = target.slice(hashIndex + 1).trim();
		target = target.slice(0, hashIndex).trim();
	}

	return { target, alias, anchor };
}

function wikilinkHref(target, anchor) {
	const base = `/notes/${target}/`;
	return anchor ? `${base}#${anchor}` : base;
}

function splitTextWithWikilinks(value) {
	WIKILINK_PATTERN.lastIndex = 0;
	let match = WIKILINK_PATTERN.exec(value);
	if (!match) return null;

	const nodes = [];
	let lastIndex = 0;
	while (match) {
		if (match.index > lastIndex) {
			nodes.push({ type: 'text', value: value.slice(lastIndex, match.index) });
		}

		const { target, alias, anchor } = parseWikilinkInner(match[1]);
		nodes.push({
			type: 'link',
			url: wikilinkHref(target, anchor),
			data: {
				hProperties: {
					className: ['wikilink'],
					'data-wikilink-target': target,
				},
			},
			children: [{ type: 'text', value: alias || target }],
		});

		lastIndex = match.index + match[0].length;
		match = WIKILINK_PATTERN.exec(value);
	}

	if (lastIndex < value.length) {
		nodes.push({ type: 'text', value: value.slice(lastIndex) });
	}

	return nodes;
}

function transformChildren(node) {
	if (!node || !Array.isArray(node.children)) return;

	const result = [];
	for (const child of node.children) {
		if (child.type === 'text' && typeof child.value === 'string' && child.value.includes('[[')) {
			const split = splitTextWithWikilinks(child.value);
			if (split) {
				result.push(...split);
				continue;
			}
		}
		// `code`/`inlineCode` nodes have no `children` array, so this recursion
		// is a no-op for them — their raw value is never treated as prose text.
		transformChildren(child);
		result.push(child);
	}
	node.children = result;
}

export default function remarkWikilink() {
	return (tree) => {
		transformChildren(tree);
	};
}
