import { test } from 'node:test';
import assert from 'node:assert/strict';
import remarkCallout, { CALLOUT_TYPES } from '../src/plugins/remark-callout.mjs';

function text(value) {
	return { type: 'text', value };
}

function blockquote(paragraphChildrenList) {
	return {
		type: 'blockquote',
		children: paragraphChildrenList.map((children) => ({
			type: 'paragraph',
			children: Array.isArray(children) ? children : [text(children)],
		})),
	};
}

function run(tree, options) {
	remarkCallout(options)(tree);
	return tree;
}

function labelText(titleNode) {
	return titleNode.children[0].data.hChildren[0].value;
}

function nameChildren(titleNode) {
	return titleNode.children[1]?.children;
}

test('title on the same line as the marker becomes real title children, not a flattened string', () => {
	const tree = { type: 'root', children: [blockquote(['[!THEOREM] Chain rule for $H$'])] };
	const [node] = run(tree).children;
	const title = node.children[0];

	assert.equal(labelText(title), 'Theorem 1');
	assert.equal(nameChildren(title).length, 1);
	assert.equal(nameChildren(title)[0].value, 'Chain rule for $H$');
	// Body: nothing left after the title on this line, and none after it.
	assert.equal(node.children.length, 1);
});

test('title on its own line, body starting on the next line, is split at the newline', () => {
	const tree = { type: 'root', children: [blockquote(['[!THEOREM] Chain rule\nThe body starts here.'])] };
	const [node] = run(tree).children;
	const [title, body] = node.children;

	assert.equal(nameChildren(title)[0].value, 'Chain rule');
	assert.equal(body.children[0].value, 'The body starts here.');
});

test('no title: marker with nothing else on its line has just the label span', () => {
	// Per spec, everything after the marker up to the first newline is the
	// title — so the only way to get "no title" is nothing at all before
	// that newline (the marker-alone-on-its-line case below), not any
	// same-line text (that's always a title, even a short one — see the
	// [!THEOREM] Chain rule for $H$ example).
	const tree = { type: 'root', children: [blockquote(['[!NOTE]', 'Just the body, no title.'])] };
	const [node] = run(tree).children;
	const title = node.children[0];

	assert.equal(title.children.length, 1);
	assert.equal(node.children[1].children[0].value, 'Just the body, no title.');
});

test('marker alone on its own line (blank `>` line before the body) drops the empty paragraph', () => {
	const tree = { type: 'root', children: [blockquote(['[!WARNING]', 'Be careful.'])] };
	const [node] = run(tree).children;

	assert.equal(node.children.length, 2);
	assert.equal(node.children[1].children[0].value, 'Be careful.');
});

test('fold flags: `-` and `+` override the type default, in both directions', () => {
	// PROOF defaults to closed; `+` should open it.
	const openProof = run({ type: 'root', children: [blockquote(['[!PROOF]+ x'])] }).children[0];
	assert.equal(openProof.data.hName, 'details');
	assert.equal(openProof.data.hProperties.open, true);

	// DEFINITION defaults to static; `-` should make it a closed <details>.
	const closedDefinition = run({ type: 'root', children: [blockquote(['[!DEFINITION]- x'])] }).children[0];
	assert.equal(closedDefinition.data.hName, 'details');
	assert.equal(closedDefinition.data.hProperties.open, undefined);

	// No flag at all: PROOF's own default (closed) applies, still foldable.
	const defaultProof = run({ type: 'root', children: [blockquote(['[!PROOF] x'])] }).children[0];
	assert.equal(defaultProof.data.hName, 'details');
	assert.equal(defaultProof.data.hProperties.open, undefined);

	// No flag, static default (THEOREM): plain div, not foldable at all.
	const staticTheorem = run({ type: 'root', children: [blockquote(['[!THEOREM] x'])] }).children[0];
	assert.equal(staticTheorem.data.hName, 'div');
});

test('alias resolution: short forms resolve to the canonical type', () => {
	const byAlias = run({ type: 'root', children: [blockquote(['[!THM] x'])] }).children[0];
	const byCanonical = run({ type: 'root', children: [blockquote(['[!THEOREM] x'])] }).children[0];

	assert.equal(byAlias.data.hProperties['data-callout'], 'theorem');
	assert.equal(byAlias.data.hProperties['data-callout'], byCanonical.data.hProperties['data-callout']);
	assert.equal(labelText(byAlias.children[0]), 'Theorem 1');
});

test('every alias in the registry resolves to its own canonical entry', () => {
	for (const [canonical, def] of Object.entries(CALLOUT_TYPES)) {
		for (const alias of def.aliases) {
			const node = run({ type: 'root', children: [blockquote([`[!${alias}] x`])] }).children[0];
			assert.equal(node.data.hProperties['data-callout'], canonical.toLowerCase(), `alias ${alias}`);
		}
	}
});

test('numbering: one counter shared across every numbered type, in document order', () => {
	const tree = {
		type: 'root',
		children: [
			blockquote(['[!DEFINITION] x']),
			blockquote(['[!THEOREM] x']),
			blockquote(['[!LEMMA] x']),
			blockquote(['[!EXAMPLE] x']), // numbered, but family: support — still shares the counter
		],
	};
	const [def, thm, lem, ex] = run(tree).children;

	assert.equal(labelText(def.children[0]), 'Definition 1');
	assert.equal(labelText(thm.children[0]), 'Theorem 2');
	assert.equal(labelText(lem.children[0]), 'Lemma 3');
	assert.equal(labelText(ex.children[0]), 'Example 4');

	assert.equal(def.data.hProperties.id, 'definition-1');
	assert.equal(thm.data.hProperties.id, 'theorem-2');
});

test('counter resets between documents (fresh transformer call = fresh closure)', () => {
	const first = run({ type: 'root', children: [blockquote(['[!THEOREM] x']), blockquote(['[!THEOREM] x'])] });
	assert.equal(labelText(first.children[0].children[0]), 'Theorem 1');
	assert.equal(labelText(first.children[1].children[0]), 'Theorem 2');

	// A brand new tree/transformer call — as a new file would get in a
	// real build — must start back at 1, not continue from 2.
	const second = run({ type: 'root', children: [blockquote(['[!THEOREM] x'])] });
	assert.equal(labelText(second.children[0].children[0]), 'Theorem 1');
});

test('numbering: false suppresses numbers and ids but still resolves the type', () => {
	const node = run({ type: 'root', children: [blockquote(['[!THEOREM] x'])] }, { numbering: false }).children[0];
	assert.equal(labelText(node.children[0]), 'Theorem');
	assert.equal(node.data.hProperties.id, undefined);
	assert.ok(!node.data.hProperties.className.includes('is-numbered'));
});

test('qed: PROOF gets a trailing ∎ paragraph by default, other types never do', () => {
	const proof = run({ type: 'root', children: [blockquote(['[!PROOF] x'])] }).children[0];
	const last = proof.children.at(-1);
	assert.equal(last.data.hProperties.className[0], 'callout-qed');
	assert.equal(last.children[0].value, '∎');

	const theorem = run({ type: 'root', children: [blockquote(['[!THEOREM] x'])] }).children[0];
	assert.ok(!theorem.children.some((c) => c.data?.hProperties?.className?.[0] === 'callout-qed'));
});

test('qed: false suppresses the marker even on PROOF', () => {
	const proof = run({ type: 'root', children: [blockquote(['[!PROOF] x'])] }, { qed: false }).children[0];
	assert.ok(!proof.children.some((c) => c.data?.hProperties?.className?.[0] === 'callout-qed'));
});

test('back-compat: GitHub alert types still work, unremapped', () => {
	for (const type of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
		const node = run({ type: 'root', children: [blockquote([`[!${type}] x`])] }).children[0];
		assert.equal(node.data.hProperties['data-callout'], type.toLowerCase());
		assert.equal(node.data.hName, 'div'); // all five default to static
	}
});

test('family classes group types into the three visual registers', () => {
	const assertion = run({ type: 'root', children: [blockquote(['[!LEMMA] x'])] }).children[0];
	const support = run({ type: 'root', children: [blockquote(['[!PROOF] x'])] }).children[0];
	const aside = run({ type: 'root', children: [blockquote(['[!NOTE] x'])] }).children[0];

	assert.ok(assertion.data.hProperties.className.includes('callout-family-assertion'));
	assert.ok(support.data.hProperties.className.includes('callout-family-support'));
	assert.ok(aside.data.hProperties.className.includes('callout-family-aside'));
});

test('a blockquote with no recognized marker is left completely alone', () => {
	const tree = { type: 'root', children: [blockquote(['Just a regular quote.'])] };
	const [node] = run(tree).children;
	assert.equal(node.data, undefined);
	assert.equal(node.children[0].children[0].value, 'Just a regular quote.');
});

test('an unrecognized bracket tag is left as a plain blockquote', () => {
	const tree = { type: 'root', children: [blockquote(['[!NOTABLE] not a real type'])] };
	const [node] = run(tree).children;
	assert.equal(node.data, undefined);
});

test('marker text inside a fenced code block is untouched (code nodes have no children to recurse into)', () => {
	const codeNode = { type: 'code', lang: 'text', value: '> [!NOTE] this is inside a code fence' };
	const tree = { type: 'root', children: [codeNode] };
	run(tree);
	assert.equal(tree.children[0], codeNode);
	assert.equal(tree.children[0].data, undefined);
});

test('nested callout (a proof inside a theorem) transforms both independently', () => {
	const proof = blockquote(['[!PROOF] Direct evaluation.']);
	const theorem = { type: 'blockquote', children: [{ type: 'paragraph', children: [text('[!THEOREM] Outer claim.')] }, proof] };
	const tree = { type: 'root', children: [theorem] };
	const [outer] = run(tree).children;

	assert.equal(outer.data.hProperties['data-callout'], 'theorem');
	const inner = outer.children.find((c) => c.type === 'blockquote');
	assert.equal(inner.data.hProperties['data-callout'], 'proof');
	assert.equal(inner.data.hName, 'details');
});
