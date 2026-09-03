import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageStats } from '../src/lib/reading.ts';

function paper(overrides) {
	return {
		status: 'to-read',
		date: new Date('2026-01-01'),
		...overrides,
	};
}

test('coverageStats: empty input gives all-zero counts and a null lastActivity', () => {
	assert.deepEqual(coverageStats([]), {
		total: 0,
		read: 0,
		reading: 0,
		skimmed: 0,
		toRead: 0,
		lastActivity: null,
	});
});

test('coverageStats: tallies each status bucket correctly', () => {
	const notes = [
		paper({ status: 'to-read' }),
		paper({ status: 'to-read' }),
		paper({ status: 'reading' }),
		paper({ status: 'skimmed' }),
		paper({ status: 'read' }),
		paper({ status: 'read' }),
		paper({ status: 'read' }),
	];
	const stats = coverageStats(notes);
	assert.equal(stats.total, 7);
	assert.equal(stats.toRead, 2);
	assert.equal(stats.reading, 1);
	assert.equal(stats.skimmed, 1);
	assert.equal(stats.read, 3);
});

test('coverageStats: lastActivity prefers updated, then added, then date', () => {
	const notes = [
		paper({ date: new Date('2026-01-01') }),
		paper({ date: new Date('2026-01-01'), added: new Date('2026-02-01') }),
		paper({
			date: new Date('2026-01-01'),
			added: new Date('2026-02-01'),
			updated: new Date('2026-03-01'),
		}),
	];
	assert.deepEqual(coverageStats(notes).lastActivity, new Date('2026-03-01'));
});

test('coverageStats: lastActivity is the max across all notes, not just the last one', () => {
	const notes = [
		paper({ date: new Date('2026-05-01') }),
		paper({ date: new Date('2026-01-01') }),
	];
	assert.deepEqual(coverageStats(notes).lastActivity, new Date('2026-05-01'));
});
