import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowRows, headingForTerm } from '../src/lib/noteFlow.ts';

const headings = [
	{ depth: 2, slug: 'history', text: 'History' },
	{ depth: 2, slug: 'information-surprise', text: 'Information (surprise)' },
	{ depth: 2, slug: 'joint-entropy-hx-y', text: 'Joint entropy H(X,Y)' },
	{ depth: 2, slug: 'chain-rule-of-entropy', text: 'Chain rule of entropy (two variables)' },
	{ depth: 2, slug: 'mutual-information', text: 'Mutual information' },
];

test('headingForTerm: matches a heading that starts with the term', () => {
	assert.equal(headingForTerm('Information', headings)?.slug, 'information-surprise');
	assert.equal(headingForTerm('joint entropy', headings)?.slug, 'joint-entropy-hx-y');
	assert.equal(headingForTerm('Mutual information', headings)?.slug, 'mutual-information');
});

test('headingForTerm: a plural term finds the singular heading', () => {
	assert.equal(headingForTerm('Chain rules', headings)?.slug, 'chain-rule-of-entropy');
});

test('headingForTerm: only whole-word prefixes match', () => {
	assert.equal(headingForTerm('Info', headings), undefined);
	assert.equal(headingForTerm('Entropy', headings), undefined);
});

test('headingForTerm: ignores a leading article and trailing punctuation', () => {
	const aep = [
		{ depth: 2, slug: 'the-aep-theorem', text: 'The AEP theorem' },
		{ depth: 2, slug: 'the-typical-set', text: 'The typical set' },
		{ depth: 2, slug: 'consequence-data-compression', text: 'Consequence: data compression' },
	];
	assert.equal(headingForTerm('AEP theorem', aep)?.slug, 'the-aep-theorem');
	assert.equal(headingForTerm('Typical set', aep)?.slug, 'the-typical-set');
	assert.equal(headingForTerm('Consequence', aep)?.slug, 'consequence-data-compression');
});

test('flowRows: asides branch off the main step above them', () => {
	const rows = flowRows([
		{ term: 'A', text: '' },
		{ term: 'a1', text: '', aside: true },
		{ term: 'B', text: '' },
		{ term: 'b1', text: '', aside: true },
		{ term: 'b2', text: '', aside: true },
	]);
	assert.deepEqual(
		rows.map((r) => [r.step.term, r.asides.map((a) => a.term)]),
		[
			['A', ['a1']],
			['B', ['b1', 'b2']],
		],
	);
});

test('flowRows: `of` attaches an aside to a named main step', () => {
	const rows = flowRows([
		{ term: 'Entropy', text: '' },
		{ term: 'Mutual information', text: '' },
		{ term: 'Properties', text: '', aside: true, of: 'entropy' },
	]);
	assert.deepEqual(rows[0].asides.map((a) => a.term), ['Properties']);
	assert.deepEqual(rows[1].asides, []);
});

test('flowRows: an aside with nothing to attach to becomes a main step', () => {
	const rows = flowRows([{ term: 'Lonely', text: '', aside: true }, { term: 'B', text: '' }]);
	assert.deepEqual(rows.map((r) => r.step.term), ['Lonely', 'B']);
});
