import { test } from 'node:test';
import assert from 'node:assert/strict';
import remarkCallout from '../src/plugins/remark-callout.mjs';

function blockquote(paragraphs) {
	return {
		type: 'blockquote',
		children: paragraphs.map((text) => ({
			type: 'paragraph',
			children: [{ type: 'text', value: text }],
		})),
	};
}

function run(tree) {
	remarkCallout()(tree);
	return tree;
}

test('remarkCallout: [!NOTE] on the same line as content rewrites to a callout div', () => {
	const tree = { type: 'root', children: [blockquote(['[!NOTE] This is a note.'])] };
	const [node] = run(tree).children;

	assert.equal(node.data.hName, 'div');
	assert.deepEqual(node.data.hProperties.className, ['callout', 'callout-note']);
	assert.equal(node.data.hProperties['data-callout'], 'note');

	assert.equal(node.children[0].data.hName, 'p');
	assert.deepEqual(node.children[0].data.hProperties.className, ['callout-title']);
	assert.equal(node.children[0].children[0].value, 'Note');

	assert.equal(node.children[1].children[0].value, 'This is a note.');
});

test('remarkCallout: marker alone on its own line drops the now-empty paragraph', () => {
	const tree = { type: 'root', children: [blockquote(['[!WARNING]', 'Be careful.'])] };
	const [node] = run(tree).children;

	// Just the title paragraph + the real content — no leftover empty <p>.
	assert.equal(node.children.length, 2);
	assert.equal(node.children[1].children[0].value, 'Be careful.');
	assert.deepEqual(node.data.hProperties.className, ['callout', 'callout-warning']);
});

test('remarkCallout: recognizes all five GitHub alert types', () => {
	for (const type of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
		const tree = { type: 'root', children: [blockquote([`[!${type}] x`])] };
		const [node] = run(tree).children;
		assert.equal(node.data.hProperties['data-callout'], type.toLowerCase());
	}
});

test('remarkCallout: a plain blockquote with no marker is left untouched', () => {
	const tree = { type: 'root', children: [blockquote(['Just a regular quote.'])] };
	const [node] = run(tree).children;
	assert.equal(node.data, undefined);
	assert.equal(node.children[0].children[0].value, 'Just a regular quote.');
});

test('remarkCallout: an unrecognized bracket tag is left as a plain blockquote', () => {
	const tree = { type: 'root', children: [blockquote(['[!NOTABLE] not a real type'])] };
	const [node] = run(tree).children;
	assert.equal(node.data, undefined);
});
