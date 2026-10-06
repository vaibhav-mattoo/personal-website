import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedLayoutBoxes, estimateHalfExtent, withSeedLayout } from '../src/lib/graphSeed.ts';

function node(overrides) {
	return { id: 'n', title: 'Node', kind: 'note', topics: [], degree: 1, status: 'connected', ...overrides };
}

const graph = {
	nodes: [
		node({ id: 'math', title: 'Mathematics', kind: 'topic', topics: ['math'], noteCount: 2 }),
		node({ id: 'math/prob', title: 'Probability', kind: 'topic', topics: ['math', 'math/prob'], parent: 'math', noteCount: 2 }),
		node({ id: 'a', topics: ['math/prob', 'math'] }),
		node({ id: 'b', topics: ['math/prob', 'math'] }),
	],
	edges: [{ source: 'a', target: 'b', type: 'link' }],
};

test('seedLayoutBoxes pulls topics to their parent and notes to their first topic', () => {
	const boxes = seedLayoutBoxes(graph.nodes, estimateHalfExtent);
	const pull = Object.fromEntries(boxes.map((b) => [b.id, b.pullTarget]));
	assert.deepEqual(pull, { math: undefined, 'math/prob': 'math', a: 'math/prob', b: 'math/prob' });
});

test('seedLayoutBoxes ignores a pull target outside the node set', () => {
	const [box] = seedLayoutBoxes([node({ id: 'x', topics: ['gone'] })], estimateHalfExtent);
	assert.equal(box.pullTarget, undefined);
});

test('withSeedLayout gives every node a seed and is deterministic', () => {
	const first = withSeedLayout(graph);
	const second = withSeedLayout(graph);
	for (const n of first.nodes) {
		assert.ok(Number.isFinite(n.seed?.x) && Number.isFinite(n.seed?.y), `${n.id} has a seed`);
	}
	assert.deepEqual(first.nodes.map((n) => n.seed), second.nodes.map((n) => n.seed));
	assert.equal(first.edges, graph.edges);
	assert.equal(graph.nodes[0].seed, undefined, 'input nodes are not mutated');
});
