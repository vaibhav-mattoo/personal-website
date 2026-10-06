// Pure node-sizing helpers shared by the client-side Graph component (which
// draws with them) and the build-time seed layout (lib/graphSeed.ts), so
// both agree on how big each node is. No DOM or astro:content imports.

import type { GraphNode } from './graph';

export function nodeRadius(node: GraphNode): number {
	const base = Math.min(4 + Math.sqrt(node.degree) * 2.2, 16);
	// Documents (kind: 'document' — an external resource like a book/PDF,
	// not a written note) get a visibly bigger circle so they read as a
	// different category of thing at a glance, not just another note.
	return node.kind === 'document' ? base * 1.6 : base;
}

/**
 * Topic nodes render as text, not a shape — sized by how deep they are in
 * the tag path (`topics` is that node's own ancestor-or-self chain, so its
 * length *is* the depth: 1 = top-level) and, secondarily, by how many
 * notes it has — log-scaled and capped so a heavily-populated topic
 * doesn't dwarf everything and an empty one stays legible.
 */
export function topicFontSize(node: GraphNode): number {
	const depth = node.topics.length || 1;
	const base = Math.max(14, Math.round(64 * 0.5 ** (depth - 1)));
	const noteCount = node.noteCount ?? 0;
	const countFactor = Math.min(1.35, 1 + Math.log2(noteCount + 1) * 0.08);
	return Math.round(base * countFactor);
}

/** Half-width of a topic label when no canvas is available to measure it. */
export function estimateTopicHalfWidth(node: GraphNode, size: number): number {
	return node.title.length * size * 0.32 + 8;
}
