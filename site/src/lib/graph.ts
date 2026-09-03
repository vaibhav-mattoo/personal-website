// Pure graph-shaping logic — no `astro:content` import here on purpose,
// mirroring links.ts/topics.ts. `graph.json.ts` is the thin astro-aware
// endpoint that loads the real vault/topic tree and calls `buildGraphData`.
// This module (types included) is also imported by the client-side Graph
// components — keeping it free of any server-only import means it's safe to
// end up in the browser bundle.

import type { LinkIndex } from './links';
import { tagAncestors, type TopicKind, type TopicTree } from './topics';

export type GraphNode = {
	id: string;
	title: string;
	/** A note's `kind` (note/concept/experiment/review/idea/paper), or 'topic'. */
	kind: string;
	/**
	 * Every ancestor-or-self topic id this node belongs to, root-first — so
	 * `topics[0]` is always the top-level cluster, the thing node color is
	 * keyed on. For a topic node this is its own ancestor chain; for a note
	 * it's the flattened, order-preserving union of every declared tag's
	 * ancestor chain (so the note's first tag wins ties for "top-level").
	 */
	topics: string[];
	/** Edge count touching this node in the full public graph. */
	degree: number;
	/** 'orphan' | 'connected' for notes; 'synthesized' | 'real' for topics. */
	status: string;
	summary?: string;
	/** Only for kind: 'paper' — drives opacity in the graph view. */
	readingStatus?: 'to-read' | 'skimmed' | 'reading' | 'read';
	/** Only for kind: 'paper' — the timeline toggle fixes x by this. */
	year?: number;
	/** Only for kind: 'topic' — its own area/course/paper-thread/scratch kind. */
	topicKind?: TopicKind;
};

export type GraphEdge = {
	source: string;
	target: string;
	/** 'link' (wikilink/markdown link), a frontmatter relation type, or 'topic'. */
	type: string;
};

export type GraphData = {
	nodes: GraphNode[];
	edges: GraphEdge[];
};

export type GraphNoteEntry = {
	id: string;
	title: string;
	tags: string[];
	kind: string;
	summary?: string;
	status?: 'to-read' | 'skimmed' | 'reading' | 'read';
	year?: number;
};

/**
 * Combines the link index and topic tree into one renderable graph. Topic
 * nodes are included alongside notes — they're what makes clusters legible —
 * linked to their parent topic and to the notes tagged directly into them.
 *
 * Membership edges (topic -> note) use each note's raw declared tags, not
 * the rolled-up ancestor closure: the topic hierarchy edges already provide
 * that transitively, so this avoids one edge per ancestor per note.
 */
export function buildGraphData(entries: GraphNoteEntry[], index: LinkIndex, tree: TopicTree): GraphData {
	const edges: GraphEdge[] = [];
	const degree = new Map<string, number>();
	const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);

	for (const edge of index.edges) {
		if (edge.broken) continue;
		edges.push({ source: edge.source, target: edge.target, type: edge.type });
		bump(edge.source);
		bump(edge.target);
	}

	for (const node of tree.byId.values()) {
		if (node.parent) {
			edges.push({ source: node.parent, target: node.id, type: 'topic' });
			bump(node.parent);
			bump(node.id);
		}
	}

	for (const entry of entries) {
		for (const tag of entry.tags) {
			if (tree.byId.has(tag)) {
				edges.push({ source: tag, target: entry.id, type: 'topic' });
				bump(tag);
				bump(entry.id);
			}
		}
	}

	const noteNodes: GraphNode[] = entries.map((e) => {
		const topics = [...new Set(e.tags.flatMap((tag) => tagAncestors(tag)))];
		const d = degree.get(e.id) ?? 0;
		return {
			id: e.id,
			title: e.title,
			kind: e.kind,
			topics,
			degree: d,
			status: d === 0 ? 'orphan' : 'connected',
			summary: e.summary,
			readingStatus: e.kind === 'paper' ? e.status : undefined,
			year: e.kind === 'paper' ? e.year : undefined,
		};
	});

	const topicNodes: GraphNode[] = [...tree.byId.values()].map((node) => {
		const d = degree.get(node.id) ?? 0;
		return {
			id: node.id,
			title: node.title,
			kind: 'topic',
			topics: tagAncestors(node.id),
			degree: d,
			status: node.synthesized ? 'synthesized' : 'real',
			summary: node.summary,
			topicKind: node.kind,
		};
	});

	return { nodes: [...topicNodes, ...noteNodes], edges };
}
