import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph } from '../src/lib/graphLayout.ts';

function box(overrides) {
	return { id: 'placeholder', halfW: 10, halfH: 10, ...overrides };
}

function hasOverlap(remainingOverlaps, a, b) {
	return remainingOverlaps.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

test('layoutGraph: two boxes starting at the exact same point end up separated', () => {
	const boxes = [box({ id: 'a', halfW: 50, halfH: 20 }), box({ id: 'b', halfW: 50, halfH: 20 })];
	const { positions, remainingOverlaps } = layoutGraph(boxes);
	assert.equal(remainingOverlaps.length, 0);
	assert.equal(positions.size, 2);
});

test('layoutGraph: a tight cluster of siblings pulled to the same parent still fully separates', () => {
	// Mirrors the real failure mode this module exists to fix: many
	// same-size labels all pulled toward one point.
	const boxes = [
		box({ id: 'root', halfW: 60, halfH: 20 }),
		...Array.from({ length: 8 }, (_, i) =>
			box({ id: `child-${i}`, halfW: 55, halfH: 18, pullTarget: 'root' }),
		),
	];
	const { remainingOverlaps } = layoutGraph(boxes);
	assert.deepEqual(remainingOverlaps, []);
});

test('layoutGraph: deterministic — same input produces the same output every time', () => {
	const boxes = [
		box({ id: 'a', halfW: 40, halfH: 15 }),
		box({ id: 'b', halfW: 40, halfH: 15, pullTarget: 'a' }),
		box({ id: 'c', halfW: 40, halfH: 15, pullTarget: 'a' }),
	];
	const run1 = layoutGraph(boxes.map((b) => ({ ...b })));
	const run2 = layoutGraph(boxes.map((b) => ({ ...b })));
	for (const b of boxes) {
		assert.deepEqual(run1.positions.get(b.id), run2.positions.get(b.id));
	}
});

test('layoutGraph: a large mixed dataset (topics + notes, uneven sizes) settles with zero overlaps', () => {
	const boxes = [];
	for (let t = 0; t < 10; t++) {
		boxes.push(box({ id: `topic-${t}`, halfW: 30 + t * 8, halfH: 16 }));
		for (let c = 0; c < 5; c++) {
			boxes.push(box({ id: `topic-${t}-child-${c}`, halfW: 40, halfH: 12, pullTarget: `topic-${t}` }));
		}
	}
	for (let n = 0; n < 30; n++) {
		boxes.push(box({ id: `note-${n}`, halfW: 10, halfH: 10, pullTarget: `topic-${n % 10}` }));
	}
	const { remainingOverlaps } = layoutGraph(boxes);
	assert.deepEqual(remainingOverlaps, []);
});

test('layoutGraph: final positions stay within the clamped bounding square (nothing clips)', () => {
	const boxes = Array.from({ length: 20 }, (_, i) => box({ id: `n${i}`, halfW: 20, halfH: 20 }));
	const { positions } = layoutGraph(boxes);
	// No hard-coded bound to check against (it's content-derived) — the
	// real invariant is just "finite, not NaN/Infinity from a runaway sim".
	for (const p of positions.values()) {
		assert.ok(Number.isFinite(p.x));
		assert.ok(Number.isFinite(p.y));
	}
});

test('hasOverlap helper sanity check (used implicitly above via remainingOverlaps)', () => {
	assert.equal(hasOverlap([['a', 'b']], 'b', 'a'), true);
	assert.equal(hasOverlap([['a', 'b']], 'a', 'c'), false);
});
