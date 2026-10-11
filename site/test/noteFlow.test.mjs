import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headingForTerm } from '../src/lib/noteFlow.ts';

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
