import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	tagAncestors,
	buildTopicTree,
	orderNotes,
	sequenceNeighbors,
	unresolvedParents,
	untopicedTags,
} from '../src/lib/topics.ts';

function topic(overrides) {
	return {
		id: 'placeholder',
		title: 'Placeholder',
		kind: 'area',
		sequence: [],
		hidden: false,
		...overrides,
	};
}

function note(overrides) {
	return {
		id: 'placeholder',
		title: 'Placeholder',
		tags: [],
		date: new Date('2026-01-01'),
		...overrides,
	};
}

test('tagAncestors: returns every prefix of a path-like tag, including itself', () => {
	assert.deepEqual(tagAncestors('research/cheminformatics/enzymes'), [
		'research',
		'research/cheminformatics',
		'research/cheminformatics/enzymes',
	]);
});

test('tagAncestors: a tag with no slash is its own only ancestor', () => {
	assert.deepEqual(tagAncestors('research'), ['research']);
});

test('buildTopicTree: a deep tag rolls the note up to every ancestor topic page', () => {
	const notes = [note({ id: 'n1', tags: ['research/cheminformatics/enzymes'] })];
	const { byId } = buildTopicTree([], notes);

	assert.deepEqual(
		byId.get('research').notes.map((n) => n.id),
		['n1'],
	);
	assert.deepEqual(
		byId.get('research/cheminformatics').notes.map((n) => n.id),
		['n1'],
	);
	assert.deepEqual(
		byId.get('research/cheminformatics/enzymes').notes.map((n) => n.id),
		['n1'],
	);
});

test('buildTopicTree: synthesizes a title and marks the node synthesized when no topic file exists', () => {
	const notes = [note({ id: 'n1', tags: ['some-area'] })];
	const { byId } = buildTopicTree([], notes);
	const node = byId.get('some-area');
	assert.equal(node.synthesized, true);
	assert.equal(node.title, 'Some Area');
});

test('buildTopicTree: a real topic file supplies metadata and is not synthesized', () => {
	const notes = [note({ id: 'n1', tags: ['research'] })];
	const topics = [topic({ id: 'research', title: 'Research', summary: 'My areas.' })];
	const { byId } = buildTopicTree(topics, notes);
	const node = byId.get('research');
	assert.equal(node.synthesized, false);
	assert.equal(node.title, 'Research');
	assert.equal(node.summary, 'My areas.');
});

test('buildTopicTree: nests topics by path when no parent is declared', () => {
	const topics = [
		topic({ id: 'research', title: 'Research' }),
		topic({ id: 'research/cheminformatics', title: 'Cheminformatics' }),
	];
	const { roots, byId } = buildTopicTree(topics, []);
	assert.deepEqual(
		roots.map((n) => n.id),
		['research'],
	);
	assert.deepEqual(
		byId.get('research').children.map((n) => n.id),
		['research/cheminformatics'],
	);
	assert.equal(byId.get('research/cheminformatics').parent, 'research');
	assert.equal(byId.get('research').parent, undefined);
});

test('buildTopicTree: a declared parent overrides the path-derived one', () => {
	const topics = [
		topic({ id: 'research', title: 'Research' }),
		topic({ id: 'scratch-area', title: 'Scratch', parent: 'research' }),
	];
	const { roots, byId } = buildTopicTree(topics, []);
	assert.deepEqual(
		roots.map((n) => n.id),
		['research'],
	);
	assert.deepEqual(
		byId.get('research').children.map((n) => n.id),
		['scratch-area'],
	);
	assert.equal(byId.get('scratch-area').parent, 'research');
});

test('buildTopicTree: a tag with no topic file still gets a node — nothing is dropped', () => {
	const notes = [note({ id: 'n1', tags: ['untitled-topic'] })];
	const { byId } = buildTopicTree([], notes);
	assert.ok(byId.has('untitled-topic'));
});

test('orderNotes: sequence entries come first in declared order, then the rest by date descending', () => {
	const notes = [
		note({ id: 'a', date: new Date('2026-01-01') }),
		note({ id: 'b', date: new Date('2026-03-01') }),
		note({ id: 'c', date: new Date('2026-02-01') }),
	];
	const result = orderNotes(topic({ sequence: ['c', 'a'] }), notes, notes);
	assert.deepEqual(
		result.sequenced.map((n) => n.id),
		['c', 'a'],
	);
	assert.deepEqual(
		result.rest.map((n) => n.id),
		['b'],
	);
	assert.deepEqual(result.unresolved, []);
	assert.deepEqual(result.untagged, []);
});

test('orderNotes: a sequence entry with no matching note anywhere is reported as unresolved (broken)', () => {
	const notes = [note({ id: 'a' })];
	const result = orderNotes(topic({ sequence: ['a', 'does-not-exist'] }), notes, notes);
	assert.deepEqual(
		result.sequenced.map((n) => n.id),
		['a'],
	);
	assert.deepEqual(result.unresolved, ['does-not-exist']);
	assert.deepEqual(result.untagged, []);
});

test('orderNotes: sequence is authoritative — a real note not tagged into the topic still renders in position, flagged as untagged', () => {
	const outsider = note({ id: 'outsider', title: 'Outsider', date: new Date('2026-05-01') });
	const tagged = note({ id: 'tagged-note', title: 'Tagged', date: new Date('2026-01-01') });
	const allNotes = [outsider, tagged];
	const taggedNotes = [tagged];

	const result = orderNotes(topic({ sequence: ['outsider', 'tagged-note'] }), allNotes, taggedNotes);

	assert.deepEqual(
		result.sequenced.map((n) => n.id),
		['outsider', 'tagged-note'],
	);
	assert.deepEqual(result.rest, []);
	assert.deepEqual(result.unresolved, []);
	assert.deepEqual(result.untagged, ['outsider']);
});

test('orderNotes: rest only draws from taggedNotes, never from notes outside the topic', () => {
	const tagged = note({ id: 'tagged-note', date: new Date('2026-01-01') });
	const outsider = note({ id: 'outsider', date: new Date('2026-06-01') });
	const result = orderNotes(topic({ sequence: [] }), [tagged, outsider], [tagged]);
	assert.deepEqual(
		result.rest.map((n) => n.id),
		['tagged-note'],
	);
});

test('sequenceNeighbors: returns prev/next/position/total for a note in the middle', () => {
	const result = sequenceNeighbors(topic({ sequence: ['a', 'b', 'c'] }), 'b');
	assert.deepEqual(result, { prev: 'a', next: 'c', position: 2, total: 3 });
});

test('sequenceNeighbors: first and last entries have a null prev/next respectively', () => {
	const seq = topic({ sequence: ['a', 'b', 'c'] });
	assert.deepEqual(sequenceNeighbors(seq, 'a'), { prev: null, next: 'b', position: 1, total: 3 });
	assert.deepEqual(sequenceNeighbors(seq, 'c'), { prev: 'b', next: null, position: 3, total: 3 });
});

test('sequenceNeighbors: a note not in the sequence gets nulls but still reports total', () => {
	const result = sequenceNeighbors(topic({ sequence: ['a', 'b'] }), 'z');
	assert.deepEqual(result, { prev: null, next: null, position: null, total: 2 });
});

test('unresolvedParents: flags a parent that does not match any topic id', () => {
	const topics = [topic({ id: 'a' }), topic({ id: 'b', parent: 'does-not-exist' })];
	assert.deepEqual(unresolvedParents(topics), [{ id: 'b', parent: 'does-not-exist' }]);
});

test('untopicedTags: lists tags used directly on notes with no matching topic file', () => {
	const topics = [topic({ id: 'research' })];
	const notes = [note({ id: 'n1', tags: ['research', 'research/cheminformatics'] })];
	assert.deepEqual(untopicedTags(topics, notes), ['research/cheminformatics']);
});
