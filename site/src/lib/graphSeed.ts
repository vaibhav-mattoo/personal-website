// Build-time seed layout for the full notes graph. lib/graphLayout.ts's
// layoutGraph is deterministic but O(n²) per tick — for the full graph it
// took ~2.6s, which used to run on the main thread on every visit to
// /notes/. Running it once here (getGraphData is memoized per build) and
// shipping the positions with the graph data lets the client skip it.
// Label widths are estimated rather than canvas-measured; the client's live
// rectangle-collision force cleans up any small differences.

import type { GraphData, GraphNode } from './graph';
import { layoutGraph, type LayoutBox } from './graphLayout.ts';
import { estimateTopicHalfWidth, nodeRadius, topicFontSize } from './graphSizing.ts';

export type HalfExtent = { halfW: number; halfH: number };

/** Layout boxes for `nodes`: each node pulled toward its parent topic (for
 *  topics) or its primary topic (for notes), sized by `extentOf`. */
export function seedLayoutBoxes(nodes: GraphNode[], extentOf: (n: GraphNode) => HalfExtent): LayoutBox[] {
	const ids = new Set(nodes.map((n) => n.id));
	return nodes.map((n) => {
		const { halfW, halfH } = extentOf(n);
		let pullTarget: string | undefined;
		if (n.kind === 'topic') {
			pullTarget = n.parent;
		} else if (n.topics[0] && ids.has(n.topics[0])) {
			pullTarget = n.topics[0];
		}
		return { id: n.id, halfW, halfH, pullTarget };
	});
}

export function estimateHalfExtent(n: GraphNode): HalfExtent {
	if (n.kind === 'topic') {
		const size = topicFontSize(n);
		return { halfW: estimateTopicHalfWidth(n, size), halfH: size / 2 + 4 };
	}
	const half = nodeRadius(n) + 6;
	return { halfW: half, halfH: half };
}

/** Returns `graph` with every node's precomputed `seed` position attached. */
export function withSeedLayout(graph: GraphData): GraphData {
	const { positions } = layoutGraph(seedLayoutBoxes(graph.nodes, estimateHalfExtent));
	return {
		...graph,
		nodes: graph.nodes.map((n) => {
			const p = positions.get(n.id);
			return p ? { ...n, seed: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } } : n;
		}),
	};
}
