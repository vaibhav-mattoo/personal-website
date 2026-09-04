import { backlinksFor } from './links';
import { getPublicVault } from './vault';

export type Backlink = {
	id: string;
	title: string;
};

/**
 * Backlinks are a listing (of notes that mention this one), so — like every
 * other listing — they must go through isVisible(): a draft or shared note
 * that links to a public note must never surface as a "Mentioned in" entry,
 * since that would leak its existence/title. getPublicVault()'s index
 * already drops any edge touching a non-visible node, so this falls out for
 * free rather than needing its own filter here.
 */
export async function getBacklinks(currentId: string): Promise<Backlink[]> {
	const { index } = await getPublicVault();
	return backlinksFor(index, currentId).map((node) => ({ id: node.id, title: node.title }));
}
