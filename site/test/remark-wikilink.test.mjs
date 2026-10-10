import { test } from 'node:test';
import assert from 'node:assert/strict';
import remarkWikilink, { anchorSlug, headingSlug, wikilinkHref } from '../src/plugins/remark-wikilink.mjs';

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

function paragraph(children) {
	return { type: 'root', children: [{ type: 'paragraph', children }] };
}

test('a wikilink whose alias contains formatting becomes one link, formatting kept', () => {
	// What the markdown parser produces for
	// `[[lit/cover2006-elements|Cover & Thomas, *Elements*]]: Chapter 3`
	const tree = paragraph([
		{ type: 'text', value: 'See [[lit/cover2006-elements|Cover & Thomas, ' },
		{ type: 'emphasis', children: [{ type: 'text', value: 'Elements' }] },
		{ type: 'text', value: ']]: Chapter 3' },
	]);
	remarkWikilink()(tree);
	const [before, link, after] = tree.children[0].children;
	assert.deepEqual(before, { type: 'text', value: 'See ' });
	assert.equal(link.type, 'link');
	assert.equal(link.url, '/notes/lit/cover2006-elements/');
	assert.deepEqual(link.children, [
		{ type: 'text', value: 'Cover & Thomas, ' },
		{ type: 'emphasis', children: [{ type: 'text', value: 'Elements' }] },
	]);
	assert.deepEqual(after, { type: 'text', value: ': Chapter 3' });
});

test('formatted aliases keep anchors and leave later wikilinks working', () => {
	const tree = paragraph([
		{ type: 'text', value: '[[note#Some heading|the ' },
		{ type: 'strong', children: [{ type: 'text', value: 'bold' }] },
		{ type: 'text', value: ' part]] and [[other]]' },
	]);
	remarkWikilink()(tree);
	const links = tree.children[0].children.filter((n) => n.type === 'link');
	assert.deepEqual(
		links.map((l) => l.url),
		['/notes/note/#some-heading', '/notes/other/'],
	);
	assert.equal(links[0].children.at(-1).value, ' part');
});

test('an unmatched [[ followed by formatting is left as text', () => {
	const tree = paragraph([
		{ type: 'text', value: 'array[[0' },
		{ type: 'emphasis', children: [{ type: 'text', value: 'x' }] },
		{ type: 'text', value: ' done' },
	]);
	remarkWikilink()(tree);
	assert.ok(tree.children[0].children.every((n) => n.type !== 'link'));
});

test('anchorSlug matches heading ids Astro builds from rendered math', () => {
	assert.equal(anchorSlug('The three conditions we need on $h$'), 'the-three-conditions-we-need-on-hhh');
	assert.equal(anchorSlug('Joint entropy $H(X, Y)$'), 'joint-entropy-hxyhx-yhxy');
	assert.equal(anchorSlug('Mutual information'), 'mutual-information');
});

test('a wikilink with math in its target becomes one link to the math heading', () => {
	// `[[note#Joint entropy $H(X, Y)$|joint *entropy*]]` after the markdown parser.
	const tree = paragraph([
		{ type: 'text', value: 'see [[note#Joint entropy ' },
		{ type: 'inlineMath', value: 'H(X, Y)' },
		{ type: 'text', value: '|joint ' },
		{ type: 'emphasis', children: [{ type: 'text', value: 'entropy' }] },
		{ type: 'text', value: ']].' },
	]);
	remarkWikilink()(tree);
	const nodes = tree.children[0].children;
	const link = nodes.find((n) => n.type === 'link');
	assert.equal(link.url, '/notes/note/#joint-entropy-hxyhx-yhxy');
	assert.deepEqual(link.children, [
		{ type: 'text', value: 'joint ' },
		{ type: 'emphasis', children: [{ type: 'text', value: 'entropy' }] },
	]);
	assert.deepEqual(nodes.at(-1), { type: 'text', value: '.' });
});

test('emphasis inside a link target is left alone', () => {
	const tree = paragraph([
		{ type: 'text', value: '[[note#' },
		{ type: 'emphasis', children: [{ type: 'text', value: 'x' }] },
		{ type: 'text', value: ']]' },
	]);
	remarkWikilink()(tree);
	assert.ok(tree.children[0].children.every((n) => n.type !== 'link'));
});
