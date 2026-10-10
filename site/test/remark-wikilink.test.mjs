import { test } from 'node:test';
import assert from 'node:assert/strict';
import remarkWikilink, { headingSlug, wikilinkHref } from '../src/plugins/remark-wikilink.mjs';

test('headingSlug matches the ids Astro gives headings', () => {
	assert.equal(
		headingSlug('Relative entropy (Kullback–Leibler distance)'),
		'relative-entropy-kullbackleibler-distance',
	);
	assert.equal(headingSlug('Mutual information'), 'mutual-information');
	assert.equal(headingSlug("Bayes' formula"), 'bayes-formula');
	assert.equal(headingSlug('Consequence: data compression'), 'consequence-data-compression');
	assert.equal(headingSlug('First-step analysis'), 'first-step-analysis');
});

test('headingSlug treats a wrapped line as a single space', () => {
	assert.equal(
		headingSlug('Limits of cross-monotonicity: the\nprobabilistic method'),
		'limits-of-cross-monotonicity-the-probabilistic-method',
	);
});

test('wikilinkHref slugs the anchor for links to another note', () => {
	assert.equal(
		wikilinkHref('entropy-mutual-information', 'Mutual information'),
		'/notes/entropy-mutual-information/#mutual-information',
	);
	assert.equal(wikilinkHref('entropy-mutual-information'), '/notes/entropy-mutual-information/');
});

test('wikilinkHref keeps same-note links on the current page', () => {
	assert.equal(wikilinkHref('', 'Approximate equilibria'), '#approximate-equilibria');
});

test('same-note wikilink without alias shows the heading text', () => {
	const tree = {
		type: 'root',
		children: [{ type: 'paragraph', children: [{ type: 'text', value: 'see [[#Open questions]]' }] }],
	};
	remarkWikilink()(tree);
	const link = tree.children[0].children[1];
	assert.equal(link.url, '#open-questions');
	assert.equal(link.children[0].value, 'Open questions');
});

test('wikilinkHref passes #^block-id through as an element id', () => {
	assert.equal(
		wikilinkHref('entropy-mutual-information', '^whole-bit-trap'),
		'/notes/entropy-mutual-information/#whole-bit-trap',
	);
	assert.equal(wikilinkHref('', '^my-plot'), '#my-plot');
});
