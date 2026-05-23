export type PublicBoard = {
	title: string;
	description?: string;
	url: string;
};

/**
 * Boards I've made public in Fizzy and want to surface here.
 * To add a new board:
 *   1. Publish the board in Fizzy (Board settings → "Public link").
 *   2. Copy the public URL (looks like https://tasks.vmattoo.dev/1/public/boards/<token>).
 *   3. Add an entry below.
 *   4. git commit && git push — CI rebuilds the site.
 * To remove: delete the entry (and unpublish in Fizzy if you also want the
 * URL to stop working).
 */
export const publicBoards: PublicBoard[] = [
	// Example entry — replace token with a real one or remove this entry
	// entirely if no boards are published yet.
	{
		title: 'Research',
		description: 'Thesis work in flight',
		url: 'https://tasks.vmattoo.dev/1/boards/03g6jp2dys7fyse43m3h9a0pc',
	},
];

/**
 * URL to Fizzy's session menu (login). Small subdued link on the boards
 * page — only useful to me, signing in from a new device. Public signup
 * is disabled (MULTI_TENANT=false in deploy.yml).
 */
export const fizzyLoginUrl = 'https://tasks.vmattoo.dev/session/menu';
