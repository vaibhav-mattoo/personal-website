import { backlinksFor } from './links';
import { getVault } from './vault';

export type Backlink = {
	id: string;
	title: string;
};

export async function getBacklinks(currentId: string): Promise<Backlink[]> {
	const { index } = await getVault();
	return backlinksFor(index, currentId).map((node) => ({ id: node.id, title: node.title }));
}
