import { githubUsername } from './projects';

export type SocialLink = {
	label: string;
	href: string;
	/** Which icon in Socials.astro to render. */
	icon: 'github' | 'email' | 'tilde';
};

export const socials: SocialLink[] = [
	{ label: 'GitHub', href: `https://github.com/${githubUsername}`, icon: 'github' },
	{ label: 'Email', href: 'mailto:vaibhavmattoo1@gmail.com', icon: 'email' },
];

/**
 * Tilde community pages — shared Unix-y community servers, unrelated to
 * the socials above. Username assumed to match this site's own handle
 * (~vaibhav); fix the path below if any of these actually use something
 * else.
 */
export const tildeCommunities: SocialLink[] = [
	{ label: 'tilde.team', href: 'https://tilde.team/~vaibhav/', icon: 'tilde' },
	{ label: 'tilde.pink', href: 'https://tilde.pink/~vaibhav/', icon: 'tilde' },
	{ label: 'tilde.club', href: 'https://tilde.club/~vaibhav/', icon: 'tilde' },
];
