import { getCollection } from 'astro:content';

export type Backlink = {
	id: string;
	title: string;
};

export async function getBacklinks(currentId: string): Promise<Backlink[]> {
	const all = await getCollection('notes');
	const patterns = [
		`/notes/${currentId}/`,
		`/notes/${currentId}`,
		`(./${currentId})`,
		`(./${currentId}.md)`,
		`(./${currentId}.mdx)`,
	];

	const matches: Backlink[] = [];
	for (const note of all) {
		if (note.id === currentId) continue;
		const body = note.body ?? '';
		if (patterns.some((p) => body.includes(p))) {
			matches.push({ id: note.id, title: note.data.title });
		}
	}
	matches.sort((a, b) => a.title.localeCompare(b.title));
	return matches;
}
