// Pure topic-tree logic — no `astro:content` import here on purpose, so this
// module can be unit tested with `node --test` and reused by the standalone
// link-report script, mirroring links.ts. `topicVault.ts` is the thin
// astro-aware wrapper that feeds real topic/note data into `buildTopicTree`.
//
// Tags are path-like ("research/cheminformatics/enzymes"): a note tagged
// that way belongs on the "research", "research/cheminformatics", and full
// path topic pages. A topic file (site/src/content/topics/**) gives one of
// those paths editorial metadata and a curated note order; a path with no
// topic file still gets a node with a synthesized title — nothing 404s.

export type TopicKind = 'area' | 'course' | 'paper-thread' | 'scratch';

export type TopicEntry = {
	id: string;
	title: string;
	summary?: string;
	parent?: string;
	kind: TopicKind;
	sequence: string[];
	hidden: boolean;
};

export type NoteEntry = {
	id: string;
	title: string;
	tags: string[];
	date: Date;
	summary?: string;
};

export type TopicNode = {
	id: string;
	title: string;
	summary?: string;
	kind: TopicKind;
	sequence: string[];
	hidden: boolean;
	/** True when no topic file exists for this id — title/kind are synthesized. */
	synthesized: boolean;
	children: TopicNode[];
	/** Every note tagged with this node's id or any deeper path under it. */
	notes: NoteEntry[];
};

export type TopicTree = {
	roots: TopicNode[];
	byId: Map<string, TopicNode>;
};

export type OrderedNotes = {
	/** Sequence entries that resolved, in declared order. */
	sequenced: NoteEntry[];
	/** Tagged notes not already shown in `sequenced`, sorted by date descending. */
	rest: NoteEntry[];
	/** Sequence entries that don't match any real note — broken. */
	unresolved: string[];
	/**
	 * Sequence entries that resolve to a real note, but one that isn't tagged
	 * into this topic. The note still renders in `sequenced` at its declared
	 * position — sequence is authoritative — this is purely informational.
	 */
	untagged: string[];
};

export type SequenceNeighbors = {
	prev: string | null;
	next: string | null;
	/** 1-based position in the sequence, or null if the note isn't in it. */
	position: number | null;
	total: number;
};

/** Every prefix of a path-like tag, including the tag itself. */
export function tagAncestors(tag: string): string[] {
	const parts = tag.split('/').filter(Boolean);
	const paths: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		paths.push(parts.slice(0, i + 1).join('/'));
	}
	return paths;
}

function parentOf(id: string): string | undefined {
	const idx = id.lastIndexOf('/');
	return idx === -1 ? undefined : id.slice(0, idx);
}

function humanize(id: string): string {
	const last = id.slice(id.lastIndexOf('/') + 1);
	return last
		.split(/[-_]/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

/**
 * Builds the full topic tree from topic files and notes. Every tag-path
 * prefix that appears on any note (or any topic file's own id) becomes a
 * node — synthesized when no topic file matches it. A node's `notes` is the
 * rollup of every note tagged with its id or any deeper path under it.
 *
 * A topic file's own `parent` field, when it resolves to another known
 * node, wins over the path-derived parent (the id with its last segment
 * removed) — that fallback is what synthesized nodes always use, since they
 * have no file to declare one.
 */
export function buildTopicTree(topicEntries: TopicEntry[], noteEntries: NoteEntry[]): TopicTree {
	const topicById = new Map(topicEntries.map((t) => [t.id, t]));
	const ids = new Set<string>();

	for (const topic of topicEntries) {
		for (const ancestor of tagAncestors(topic.id)) {
			ids.add(ancestor);
		}
	}
	for (const note of noteEntries) {
		for (const tag of note.tags) {
			for (const ancestor of tagAncestors(tag)) {
				ids.add(ancestor);
			}
		}
	}

	const nodeById = new Map<string, TopicNode>();
	for (const id of ids) {
		const topic = topicById.get(id);
		nodeById.set(id, {
			id,
			title: topic?.title ?? humanize(id),
			summary: topic?.summary,
			kind: topic?.kind ?? 'area',
			sequence: topic?.sequence ?? [],
			hidden: topic?.hidden ?? false,
			synthesized: !topic,
			children: [],
			notes: [],
		});
	}

	// Roll up notes: every node whose id is an ancestor-or-self of one of a
	// note's tags collects that note.
	for (const note of noteEntries) {
		const owningIds = new Set<string>();
		for (const tag of note.tags) {
			for (const ancestor of tagAncestors(tag)) {
				owningIds.add(ancestor);
			}
		}
		for (const id of owningIds) {
			nodeById.get(id)?.notes.push(note);
		}
	}
	for (const node of nodeById.values()) {
		node.notes.sort((a, b) => b.date.valueOf() - a.date.valueOf());
	}

	// Link parent -> children.
	const roots: TopicNode[] = [];
	for (const [id, node] of nodeById) {
		const topic = topicById.get(id);
		const declaredParent = topic?.parent;
		const parentId =
			declaredParent && declaredParent !== id && nodeById.has(declaredParent)
				? declaredParent
				: parentOf(id);
		if (parentId && nodeById.has(parentId)) {
			nodeById.get(parentId)!.children.push(node);
		} else {
			roots.push(node);
		}
	}

	for (const node of nodeById.values()) {
		node.children.sort((a, b) => a.title.localeCompare(b.title));
	}
	roots.sort((a, b) => a.title.localeCompare(b.title));

	return { roots, byId: nodeById };
}

/**
 * Sequence entries are authoritative: every id in `topic.sequence` that
 * resolves against `allNotes` renders in that declared position, even if the
 * note isn't tagged into this topic at all (flagged in `untagged`, not
 * dropped). Anything in `taggedNotes` not already placed by the sequence
 * fills `rest`, sorted by date descending. A sequence entry matching no note
 * anywhere is reported in `unresolved` rather than silently dropped.
 */
export function orderNotes(
	topic: { sequence: string[] },
	allNotes: NoteEntry[],
	taggedNotes: NoteEntry[],
): OrderedNotes {
	const allById = new Map(allNotes.map((n) => [n.id, n]));
	const taggedIds = new Set(taggedNotes.map((n) => n.id));
	const usedIds = new Set<string>();
	const sequenced: NoteEntry[] = [];
	const unresolved: string[] = [];
	const untagged: string[] = [];

	for (const id of topic.sequence) {
		const note = allById.get(id);
		if (!note) {
			unresolved.push(id);
			continue;
		}
		sequenced.push(note);
		usedIds.add(id);
		if (!taggedIds.has(id)) {
			untagged.push(id);
		}
	}

	const rest = taggedNotes
		.filter((n) => !usedIds.has(n.id))
		.sort((a, b) => b.date.valueOf() - a.date.valueOf());

	return { sequenced, rest, unresolved, untagged };
}

/** Where `noteId` sits in `topic.sequence`, or nulls if it isn't in it. */
export function sequenceNeighbors(
	topic: { sequence: string[] },
	noteId: string,
): SequenceNeighbors {
	const index = topic.sequence.indexOf(noteId);
	const total = topic.sequence.length;
	if (index === -1) {
		return { prev: null, next: null, position: null, total };
	}
	return {
		prev: index > 0 ? topic.sequence[index - 1] : null,
		next: index < topic.sequence.length - 1 ? topic.sequence[index + 1] : null,
		position: index + 1,
		total,
	};
}

/** Topic entries whose declared `parent` doesn't match any topic entry's id. */
export function unresolvedParents(
	topicEntries: TopicEntry[],
): { id: string; parent: string }[] {
	const ids = new Set(topicEntries.map((t) => t.id));
	const result: { id: string; parent: string }[] = [];
	for (const topic of topicEntries) {
		if (topic.parent && !ids.has(topic.parent)) {
			result.push({ id: topic.id, parent: topic.parent });
		}
	}
	return result;
}

/** Tags used directly on notes (not their rolled-up ancestors) with no matching topic file. */
export function untopicedTags(topicEntries: TopicEntry[], noteEntries: NoteEntry[]): string[] {
	const topicIds = new Set(topicEntries.map((t) => t.id));
	const tags = new Set<string>();
	for (const note of noteEntries) {
		for (const tag of note.tags) {
			if (!topicIds.has(tag)) tags.add(tag);
		}
	}
	return [...tags].sort();
}
