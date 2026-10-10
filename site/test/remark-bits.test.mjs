import { test } from 'node:test';
import assert from 'node:assert/strict';
import remarkBits, { parseBitsSpec, renderBitsBlock } from '../src/plugins/remark-bits.mjs';

const BLOCK = [
	'title: The two-part code  # comment',
	'Typical tape 1111011111 → 5 bits: flag 0 | index in typical pile 0100',
	'Atypical tape 1110111011 → 11 bits: flag 1 | the tape itself 1110111011',
].join('\n');

test('parseBitsSpec reads the title, row labels and fields', () => {
	const spec = parseBitsSpec(BLOCK);
	assert.equal(spec.title, 'The two-part code');
	assert.equal(spec.rows[0].label, 'Typical tape 1111011111 → 5 bits');
	assert.deepEqual(spec.rows[0].fields, [
		{ name: 'flag', bits: '0' },
		{ name: 'index in typical pile', bits: '0100' },
	]);
	assert.deepEqual(spec.rows[1].fields[1], { name: 'the tape itself', bits: '1110111011' });
});

test('parseBitsSpec rejects malformed blocks', () => {
	assert.throws(() => parseBitsSpec(''), /no rows/);
	assert.throws(() => parseBitsSpec('row: flag x'), /should end with its bits/);
	assert.throws(() => parseBitsSpec('just text'), /can't read/);
});

test('renderBitsBlock draws one cell per bit and colors fields by name', () => {
	const { html, error } = renderBitsBlock(BLOCK, 'two-part-code');
	assert.equal(error, undefined);
	assert.match(html, /^<figure class="bits" id="two-part-code">/);
	assert.equal((html.match(/class="bits__cell"/g) ?? []).length, 1 + 4 + 1 + 10);
	// "flag" is the same color in both rows; the second distinct name gets color 2, the third color 3.
	assert.equal((html.match(/bits__field--1/g) ?? []).length, 2);
	assert.equal((html.match(/bits__field--2/g) ?? []).length, 1);
	assert.equal((html.match(/bits__field--3/g) ?? []).length, 1);
	assert.match(html, /aria-label="Typical tape 1111011111 → 5 bits: flag 0, index in typical pile 0100 \(5 bits\)"/);
});

test('renderBitsBlock escapes text and shows errors as a box', () => {
	assert.match(renderBitsBlock('a < b: x 1').html, /a &lt; b/);
	const bad = renderBitsBlock('row: flag x');
	assert.match(bad.html, /bits--error/);
});

test('remarkBits replaces ```bits code nodes and keeps a block id', () => {
	const tree = {
		type: 'root',
		children: [
			{ type: 'code', lang: 'bits', value: 'r: f 01', data: { hProperties: { id: 'x' } } },
			{ type: 'code', lang: 'js', value: 'let a' },
		],
	};
	remarkBits()(tree, {});
	assert.equal(tree.children[0].type, 'html');
	assert.match(tree.children[0].value, /id="x"/);
	assert.equal(tree.children[1].type, 'code');
});
