import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	parseWikilinks,
	parseMarkdownLinks,
	buildIndex,
	backlinksFor,
	neighborhood,
} from '../src/lib/links.ts';

function entry(overrides) {
	return {
		id: 'placeholder',
		title: 'Placeholder',
		tags: [],
		kind: 'note',
		aliases: [],
		relations: [],
		draft: false,
		body: '',
		...overrides,
	};
}

test('parseWikilinks: plain [[note-id]] has no alias or anchor', () => {
	const matches = parseWikilinks('See [[note-b]] for more.');
	assert.deepEqual(matches, [{ target: 'note-b' }]);
});

test('parseWikilinks: [[note-id|display text]] captures the alias', () => {
	const matches = parseWikilinks('See [[note-b|the second note]] for more.');
	assert.deepEqual(matches, [{ target: 'note-b', alias: 'the second note' }]);
});

test('parseWikilinks: [[note-id#heading]] captures the anchor', () => {
	const matches = parseWikilinks('See [[note-b#a-heading]] for more.');
	assert.deepEqual(matches, [{ target: 'note-b', anchor: 'a-heading' }]);
});

test('parseWikilinks: [[note-id#heading|alias]] captures both', () => {
	const matches = parseWikilinks('See [[note-b#a-heading|Note B]] for more.');
	assert.deepEqual(matches, [{ target: 'note-b', anchor: 'a-heading', alias: 'Note B' }]);
});

test('parseWikilinks: ignores a wikilink inside a fenced code block', () => {
	const body = [
		'Before the fence: [[note-a]].',
		'',
		'```',
		'[[note-b]]',
		'```',
		'',
		'After the fence: [[note-c]].',
	].join('\n');
	const matches = parseWikilinks(body);
	assert.deepEqual(
		matches.map((m) => m.target),
		['note-a', 'note-c'],
	);
});

test('parseWikilinks: ignores a wikilink inside an inline code span', () => {
	const body = 'Real link [[note-a]], but `[[note-b]]` is just code.';
	const matches = parseWikilinks(body);
	assert.deepEqual(
		matches.map((m) => m.target),
		['note-a'],
	);
});

test('parseMarkdownLinks: recognizes /notes/<id>/ and relative ./id.md links, ignores external links', () => {
	const body = [
		'[absolute](/notes/note-b/)',
		'[relative](./note-c.md)',
		'[relative no ext](./note-d)',
		'[external](https://example.com/notes/note-e/)',
	].join('\n');
	const ids = parseMarkdownLinks(body);
	assert.deepEqual(ids, ['note-b', 'note-c', 'note-d']);
});

test('parseMarkdownLinks: ignores image embeds (![alt](./sample.svg)) and non-md/mdx relative assets', () => {
	const body = [
		'![Sample diagram](./sample.svg)',
		'[actual link](./note-b.md)',
		'[bare relative to an asset](./sample.svg)',
	].join('\n');
	assert.deepEqual(parseMarkdownLinks(body), ['note-b']);
});

test('parseMarkdownLinks: ignores links inside fenced code blocks', () => {
	const body = ['```', '[relative](./note-b.md)', '```', '[real](./note-c.md)'].join('\n');
	assert.deepEqual(parseMarkdownLinks(body), ['note-c']);
});

test('buildIndex: resolves an alias to its canonical id and marks the edge unbroken', () => {
	const entries = [
		entry({ id: 'note-a', title: 'Note A', body: 'Links to [[b-alias]].' }),
		entry({ id: 'note-b', title: 'Note B', aliases: ['b-alias'] }),
	];
	const { edges } = buildIndex(entries);
	assert.equal(edges.length, 1);
	assert.equal(edges[0].source, 'note-a');
	assert.equal(edges[0].target, 'note-b');
	assert.equal(edges[0].type, 'link');
	assert.equal(edges[0].broken, false);
});

test('buildIndex: marks an edge to an unresolvable target as broken instead of dropping it', () => {
	const entries = [
		entry({ id: 'note-a', title: 'Note A', body: 'Links to [[does-not-exist]].' }),
	];
	const { edges } = buildIndex(entries);
	assert.equal(edges.length, 1);
	assert.equal(edges[0].target, 'does-not-exist');
	assert.equal(edges[0].broken, true);
});

test('buildIndex: frontmatter relations keep their declared edge type', () => {
	const entries = [
		entry({
			id: 'note-a',
			title: 'Note A',
			relations: [{ type: 'cites', target: 'note-b' }],
		}),
		entry({ id: 'note-b', title: 'Note B' }),
	];
	const { edges } = buildIndex(entries);
	assert.equal(edges.length, 1);
	assert.equal(edges[0].type, 'cites');
	assert.equal(edges[0].broken, false);
});

test('backlinksFor: returns notes that link in, sorted by title, excluding broken edges and self-links', () => {
	const entries = [
		entry({ id: 'note-a', title: 'Note A', body: 'See [[note-c]].' }),
		entry({ id: 'note-b', title: 'Note B', body: 'See [[note-c]] and [[note-c]] again.' }),
		entry({ id: 'note-c', title: 'Note C', body: 'Self link [[note-c]], and [[missing]].' }),
	];
	const index = buildIndex(entries);
	const backlinks = backlinksFor(index, 'note-c');
	assert.deepEqual(
		backlinks.map((n) => n.id),
		['note-a', 'note-b'],
	);
});

test('neighborhood: depth 0 returns just the starting node with no edges', () => {
	const entries = [
		entry({ id: 'note-a', title: 'Note A', body: 'See [[note-b]].' }),
		entry({ id: 'note-b', title: 'Note B' }),
	];
	const index = buildIndex(entries);
	const result = neighborhood(index, 'note-a', 0);
	assert.deepEqual(
		result.nodes.map((n) => n.id),
		['note-a'],
	);
	assert.equal(result.edges.length, 0);
});

test('neighborhood: depth 1 includes direct neighbors in either direction', () => {
	const entries = [
		entry({ id: 'note-a', title: 'Note A', body: 'See [[note-b]].' }),
		entry({ id: 'note-b', title: 'Note B' }),
		entry({ id: 'note-c', title: 'Note C', body: 'See [[note-a]].' }),
		entry({ id: 'note-d', title: 'Note D', body: 'See [[note-c]].' }),
	];
	const index = buildIndex(entries);
	const result = neighborhood(index, 'note-a', 1);
	assert.deepEqual(
		result.nodes.map((n) => n.id).sort(),
		['note-a', 'note-b', 'note-c'],
	);
	// note-d is two hops away via note-c and should not appear at depth 1.
	assert.ok(!result.nodes.some((n) => n.id === 'note-d'));
});

test('neighborhood: does not traverse through a broken edge', () => {
	const entries = [entry({ id: 'note-a', title: 'Note A', body: 'See [[does-not-exist]].' })];
	const index = buildIndex(entries);
	const result = neighborhood(index, 'note-a', 2);
	assert.deepEqual(
		result.nodes.map((n) => n.id),
		['note-a'],
	);
});
