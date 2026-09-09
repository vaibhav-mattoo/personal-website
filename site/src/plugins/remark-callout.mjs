// Remark plugin: GitHub-style alert blocks. A blockquote whose first line is
// `[!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` (the
// same five types and syntax GitHub-flavored markdown uses) renders as a
// labeled callout div instead of a plain blockquote — see prose.css for the
// per-type color/icon.
//
// Operates on the already-parsed mdast tree, same pattern as
// remark-wikilink.mjs: a manual recursive walk, no unist-util-visit
// dependency. Runs on `blockquote` nodes specifically, so it doesn't touch
// unrelated text elsewhere (a `[!NOTE]` typed inside a code block, for
// instance, is untouched — code nodes are leaves with no paragraph/text
// children for this to match against).

const MARKER_PATTERN = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

function isWhitespaceOnly(node) {
	return node.type === 'text' && node.value.trim() === '';
}

function matchMarker(blockquote) {
	const firstParagraph = blockquote.children?.[0];
	if (!firstParagraph || firstParagraph.type !== 'paragraph') return null;
	const firstText = firstParagraph.children?.[0];
	if (!firstText || firstText.type !== 'text') return null;
	const match = MARKER_PATTERN.exec(firstText.value);
	if (!match) return null;
	return { type: match[1], firstParagraph, firstText, matchedLength: match[0].length };
}

function titleCase(type) {
	return type.charAt(0) + type.slice(1).toLowerCase();
}

function transformCallouts(node) {
	if (!node || !Array.isArray(node.children)) return;

	for (const child of node.children) {
		transformCallouts(child);
	}

	if (node.type !== 'blockquote') return;
	const marker = matchMarker(node);
	if (!marker) return;

	const { type, firstParagraph, firstText, matchedLength } = marker;

	// Strip the marker text from the front of the paragraph it was in.
	firstText.value = firstText.value.slice(matchedLength);
	// A marker alone on its own line (blank `>` line before the real
	// content) leaves this paragraph empty once stripped — drop it rather
	// than render an empty <p>.
	const remaining = firstParagraph.children.filter((c) => !isWhitespaceOnly(c));
	if (remaining.length === 0) {
		node.children = node.children.slice(1);
	}

	const titleNode = {
		type: 'paragraph',
		data: { hName: 'p', hProperties: { className: ['callout-title'] } },
		children: [{ type: 'text', value: titleCase(type) }],
	};
	node.children = [titleNode, ...node.children];

	node.data = {
		...node.data,
		hName: 'div',
		hProperties: {
			className: ['callout', `callout-${type.toLowerCase()}`],
			'data-callout': type.toLowerCase(),
		},
	};
}

export default function remarkCallout() {
	return (tree) => {
		transformCallouts(tree);
	};
}
