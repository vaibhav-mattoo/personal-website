import { getCollection } from 'astro:content';
import { buildGraphData, type GraphData } from './graph';
import { buildTopicTree, type NoteEntry, type TopicEntry, type TopicTree } from './topics';
import { getPublicVault } from './vault';

// Memoized at module scope, same rationale as vault.ts: one Astro build
// loads this module once, so every page shares the same computed
// tree/notes/graph instead of recomputing it per page (graph.json, graph.astro,
// and every note page's local-graph rail all ask for the same data).
let cachedTree: TopicTree | null = null;
let cachedNotes: NoteEntry[] | null = null;
let cachedGraph: GraphData | null = null;

async function loadNoteEntries(): Promise<NoteEntry[]> {
	if (!cachedNotes) {
		const { entries } = await getPublicVault();
		cachedNotes = entries.map((e) => ({
			id: e.id,
			title: e.title,
			tags: e.tags,
			date: e.date,
			summary: e.summary,
		}));
	}
	return cachedNotes;
}

/**
 * Every public note (drafts/shared notes excluded via getPublicVault, same
 * rule as every other public listing), in topics.ts's NoteEntry shape.
 * Exposed so pages can pass the full pool to `orderNotes` — sequence entries
 * are authoritative and may name a note outside the topic's own tag rollup.
 */
export async function getPublicNoteEntries(): Promise<NoteEntry[]> {
	return loadNoteEntries();
}

/** The topic tree built from public notes only. */
export async function getTopicTree(): Promise<TopicTree> {
	if (cachedTree) return cachedTree;

	const topics = await getCollection('topics');
	const topicEntries: TopicEntry[] = topics.map((t) => ({
		id: t.id,
		title: t.data.title,
		summary: t.data.summary,
		parent: t.data.parent,
		kind: t.data.kind,
		sequence: t.data.sequence,
		hidden: t.data.hidden,
	}));

	const noteEntries = await loadNoteEntries();
	cachedTree = buildTopicTree(topicEntries, noteEntries);
	return cachedTree;
}

/** The full public graph (notes + topics), memoized — see graph.ts. */
export async function getGraphData(): Promise<GraphData> {
	if (!cachedGraph) {
		const { entries, index } = await getPublicVault();
		const tree = await getTopicTree();
		cachedGraph = buildGraphData(entries, index, tree);
	}
	return cachedGraph;
}
