import { getCollection } from 'astro:content';
import { buildIndex, type LinkEntry, type LinkIndex } from './links';
import { isVisible } from './visibility';

export type VaultEntry = LinkEntry & {
	date: Date;
	summary?: string;
	updated?: Date;

	// Bibliographic fields — populated for kind: 'paper' notes, undefined
	// (or default) for everything else. See content.config.ts for the schema
	// and its superRefine.
	rating?: number;
	added?: Date;
	authors: string[];
	year?: number;
	venue?: string;
	doi?: string;
	arxiv?: string;
	url?: string;
	code?: string;
	bibkey?: string;
	suggestedBy?: string;

	/** Past this date, the note's /s/<share>/ page stops being built. */
	shareUntil?: Date;
};

export type Vault = {
	entries: VaultEntry[];
	index: LinkIndex;
};

// Memoized at module scope: a single Astro build loads this module once, so
// every page that calls getVault()/getPublicVault() shares one computed
// index instead of re-walking every note body per page.
let cached: Vault | null = null;

async function loadVault(): Promise<Vault> {
	const notes = await getCollection('notes');
	const entries: VaultEntry[] = notes.map((note) => ({
		id: note.id,
		title: note.data.title,
		tags: note.data.tags,
		kind: note.data.kind,
		draft: note.data.draft,
		aliases: note.data.aliases,
		relations: note.data.relations,
		cites: note.data.cites,
		body: note.body ?? '',
		date: note.data.date,
		summary: note.data.summary,
		updated: note.data.updated,
		rating: note.data.rating,
		added: note.data.added,
		authors: note.data.authors,
		year: note.data.year,
		venue: note.data.venue,
		doi: note.data.doi,
		arxiv: note.data.arxiv,
		url: note.data.url,
		code: note.data.code,
		bibkey: note.data.bibkey,
		suggestedBy: note.data.suggestedBy,
		share: note.data.share,
		shareUntil: note.data.shareUntil,
	}));
	return { entries, index: buildIndex(entries) };
}

/** The full vault (all notes, regardless of draft/share status), memoized. */
export async function getVault(): Promise<Vault> {
	if (!cached) {
		cached = await loadVault();
	}
	return cached;
}

/** The subset of the vault that `isVisible` allows into public listings. */
export async function getPublicVault(): Promise<Vault> {
	const vault = await getVault();
	const isDev = import.meta.env.DEV;
	const visibleIds = new Set(
		vault.entries.filter((entry) => isVisible(entry, { isDev })).map((entry) => entry.id),
	);

	return {
		entries: vault.entries.filter((entry) => visibleIds.has(entry.id)),
		index: {
			nodes: vault.index.nodes.filter((node) => visibleIds.has(node.id)),
			edges: vault.index.edges.filter(
				(edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
			),
		},
	};
}
