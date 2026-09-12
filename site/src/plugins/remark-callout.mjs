// Remark plugin: note-taking environments (theorem/definition/proof/...)
// plus GitHub's five alert types for back-compat, all driven from one
// CALLOUT_TYPES registry below. Syntax (Obsidian-style):
//
//   > [!TYPE]        body
//   > [!TYPE] Title  body starts on the next line
//   > [!TYPE]- Title collapsible, starts closed
//   > [!TYPE]+ Title collapsible, starts open
//
// Operates on the already-parsed mdast tree, same pattern as
// remark-wikilink.mjs: a manual recursive walk, no unist-util-visit
// dependency. Runs on `blockquote` nodes specifically — code nodes are
// opaque leaves with no `children` array, so a marker typed inside a
// fenced code block is never touched, and a blockquote with no
// recognized marker is left completely alone. A callout nested inside
// another callout (a proof inside a theorem) is still a `blockquote` in
// its own right and gets its own pass via the same recursion, so nesting
// "just works" without any special-casing here.

/**
 * The single source of truth for every environment: canonical marker name
 * (the object key), its aliases, display label, which of the three visual
 * registers it belongs to (assertion/support/aside — see prose.css), and
 * its default fold behavior ('static' = always a plain, non-collapsible
 * block; 'closed'/'open' = a <details> that starts collapsed/expanded). A
 * `-`/`+` in the source always overrides this default, for every type — a
 * default of 'static' does not mean "cannot be foldable", just "isn't by
 * default".
 */
export const CALLOUT_TYPES = {
	// "assertion" environments — claims.
	DEFINITION: { label: 'Definition', aliases: ['DEF'], family: 'assertion', defaultFold: 'static' },
	FORMULA: { label: 'Formula', aliases: ['FORM'], family: 'assertion', defaultFold: 'static' },
	THEOREM: { label: 'Theorem', aliases: ['THM'], family: 'assertion', defaultFold: 'static' },
	LEMMA: { label: 'Lemma', aliases: [], family: 'assertion', defaultFold: 'static' },
	PROPOSITION: { label: 'Proposition', aliases: ['PROP'], family: 'assertion', defaultFold: 'static' },
	COROLLARY: { label: 'Corollary', aliases: ['COR'], family: 'assertion', defaultFold: 'static' },
	// Visually "support" — worked examples/exercises read as subordinate
	// material, not claims.
	EXAMPLE: { label: 'Example', aliases: ['EG'], family: 'support', defaultFold: 'static' },
	EXERCISE: { label: 'Exercise', aliases: [], family: 'support', defaultFold: 'static' },

	// "support" environments.
	PROOF: { label: 'Proof', aliases: [], family: 'support', defaultFold: 'closed' },
	DERIVATION: { label: 'Derivation', aliases: [], family: 'support', defaultFold: 'closed' },
	SOLUTION: { label: 'Solution', aliases: [], family: 'support', defaultFold: 'closed' },
	ALGORITHM: { label: 'Algorithm', aliases: [], family: 'support', defaultFold: 'static' },

	// "aside" environments — includes GitHub's five alert types (NOTE/
	// WARNING keep their original meaning; TIP/IMPORTANT/CAUTION are pure
	// back-compat for older notes, not remapped onto anything else).
	INTUITION: { label: 'Intuition', aliases: [], family: 'aside', defaultFold: 'static' },
	REMARK: { label: 'Remark', aliases: [], family: 'aside', defaultFold: 'static' },
	CONVENTION: { label: 'Convention', aliases: ['NOTATION'], family: 'aside', defaultFold: 'static' },
	NOTE: { label: 'Note', aliases: [], family: 'aside', defaultFold: 'static' },
	WARNING: { label: 'Warning', aliases: ['PITFALL'], family: 'aside', defaultFold: 'static' },
	TIP: { label: 'Tip', aliases: [], family: 'aside', defaultFold: 'static' },
	IMPORTANT: { label: 'Important', aliases: [], family: 'aside', defaultFold: 'static' },
	CAUTION: { label: 'Caution', aliases: [], family: 'aside', defaultFold: 'static' },
};

function buildAliasLookup() {
	const map = new Map();
	for (const [canonical, def] of Object.entries(CALLOUT_TYPES)) {
		map.set(canonical, canonical);
		for (const alias of def.aliases) map.set(alias, canonical);
	}
	return map;
}

const ALIAS_LOOKUP = buildAliasLookup();
const MARKER_WORDS = [...ALIAS_LOOKUP.keys()].join('|');
// Group 1: the type word (canonical or alias). Group 2: an optional `-`/`+`
// fold flag, with no space before it, immediately after the closing `]`.
// Any spaces/tabs right after that (the separator before a title, if any)
// are consumed as part of the marker match itself, not left dangling at
// the front of the title text — but not newlines, since a `[!TYPE]` with
// nothing else before the line ends must still hit the "no title" path.
const MARKER_PATTERN = new RegExp(`^\\[!(${MARKER_WORDS})\\]([-+])?[ \\t]*`);

function isWhitespaceOnly(node) {
	return node.type === 'text' && node.value.trim() === '';
}

function resolveFold(explicitFlag, defaultFold) {
	if (explicitFlag === '-') return 'closed';
	if (explicitFlag === '+') return 'open';
	return defaultFold;
}

function matchMarker(blockquote) {
	const firstParagraph = blockquote.children?.[0];
	if (!firstParagraph || firstParagraph.type !== 'paragraph') return null;
	const firstChild = firstParagraph.children?.[0];
	if (!firstChild || firstChild.type !== 'text') return null;
	const match = MARKER_PATTERN.exec(firstChild.value);
	if (!match) return null;
	const canonical = ALIAS_LOOKUP.get(match[1]);
	if (!canonical) return null;
	return { canonical, foldFlag: match[2] ?? null, firstParagraph, markerLength: match[0].length };
}

/**
 * Splits the first paragraph's children into "title" (everything up to
 * the first raw `\n` inside a text child) and "body" (everything after
 * it, becoming a new leading paragraph). Titles are kept as real mdast
 * nodes — not flattened to a string — so inline markdown/math in a title
 * is still processed by later plugins (remarkMath, remarkWikilink, etc.)
 * and still renders. A `\n` nested inside a non-text inline node (e.g.
 * inside a link label) is not detected — a documented, acceptable
 * simplification; that content just carries over into the title as-is.
 *
 * Returns `bodyFirstParagraphChildren: null` when no `\n` was found at
 * all — the whole first paragraph was the title, with no body content of
 * its own (the common "marker alone on its own line" case, generalized).
 */
function splitTitleAndBody(children, markerLength) {
	const titleChildren = [];
	let bodyFirstParagraphChildren = null;

	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child.type !== 'text') {
			titleChildren.push(child);
			continue;
		}
		const value = i === 0 ? child.value.slice(markerLength) : child.value;
		const newlineIndex = value.indexOf('\n');
		if (newlineIndex === -1) {
			if (value.length > 0) titleChildren.push({ type: 'text', value });
			continue;
		}
		const before = value.slice(0, newlineIndex);
		const after = value.slice(newlineIndex + 1);
		if (before.length > 0) titleChildren.push({ type: 'text', value: before });
		const rest = children.slice(i + 1);
		bodyFirstParagraphChildren = after.length > 0 ? [{ type: 'text', value: after }, ...rest] : rest;
		break;
	}

	return { titleChildren, bodyFirstParagraphChildren };
}

/** A <span class="callout-label"> containing plain text (never inline
 *  markdown — it's always a fixed word like "Proof" or "Theorem"), via
 *  hChildren so it renders exactly as given regardless of mdast-to-hast's
 *  normal per-type conversion. */
function labelSpan(text) {
	return {
		type: 'callout-label',
		data: { hName: 'span', hProperties: { className: ['callout-label'] }, hChildren: [{ type: 'text', value: text }] },
	};
}

/** A <span class="callout-name"> wrapping real title children (inline
 *  markdown/math included) — a `paragraph`-shaped node purely as a
 *  vehicle for mdast-to-hast's generic children-walking, same trick the
 *  callout-title wrapper itself uses one level up. */
function nameSpan(children) {
	return {
		type: 'paragraph',
		data: { hName: 'span', hProperties: { className: ['callout-name'] } },
		children,
	};
}

function qedParagraph() {
	return {
		type: 'paragraph',
		data: { hName: 'p', hProperties: { className: ['callout-qed'] } },
		children: [{ type: 'text', value: '∎' }],
	};
}

function transformCallouts(node, options) {
	if (!node || !Array.isArray(node.children)) return;

	for (const child of node.children) {
		transformCallouts(child, options);
	}

	if (node.type !== 'blockquote') return;
	const match = matchMarker(node);
	if (!match) return;

	const { canonical, foldFlag, firstParagraph, markerLength } = match;
	const def = CALLOUT_TYPES[canonical];
	const fold = resolveFold(foldFlag, def.defaultFold);

	const { titleChildren, bodyFirstParagraphChildren } = splitTitleAndBody(firstParagraph.children, markerLength);

	let bodyChildren;
	if (bodyFirstParagraphChildren === null || bodyFirstParagraphChildren.length === 0) {
		// Whole first paragraph was the title (or nothing survived after the
		// newline) — drop it rather than render an empty <p>.
		bodyChildren = node.children.slice(1);
	} else {
		bodyChildren = [{ ...firstParagraph, children: bodyFirstParagraphChildren }, ...node.children.slice(1)];
	}

	const realTitleChildren = titleChildren.filter((c) => !isWhitespaceOnly(c));
	const titleNode = {
		type: 'paragraph',
		data: { hName: fold === 'static' ? 'p' : 'summary', hProperties: { className: ['callout-title'] } },
		children: realTitleChildren.length > 0 ? [labelSpan(def.label), nameSpan(realTitleChildren)] : [labelSpan(def.label)],
	};

	if (canonical === 'PROOF' && options.qed) {
		bodyChildren = [...bodyChildren, qedParagraph()];
	}

	node.children = [titleNode, ...bodyChildren];

	const className = ['callout', `callout-${canonical.toLowerCase()}`, `callout-family-${def.family}`];
	if (fold !== 'static') className.push('is-foldable');

	const hProperties = { className, 'data-callout': canonical.toLowerCase() };
	if (fold === 'open') hProperties.open = true;

	node.data = { ...node.data, hName: fold === 'static' ? 'div' : 'details', hProperties };
}

export default function remarkCallout(options = {}) {
	const opts = { qed: true, ...options };
	return (tree) => {
		transformCallouts(tree, opts);
	};
}
