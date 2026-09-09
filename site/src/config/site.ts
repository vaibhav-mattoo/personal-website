import { isSchemeId } from './themes';

export const site = {
	name: import.meta.env.PUBLIC_SITE_NAME ?? 'vmattoo.dev',
	tabTitle: import.meta.env.PUBLIC_TAB_TITLE ?? 'Vaibhav on HTTPS',
	/** Site-wide fallback for <meta name="description">/OG tags — pages
	 *  should pass their own via Base's `description` prop where the
	 *  content warrants something more specific. */
	description: 'Notes, projects, and what I’m working on.',
	defaultScheme: isSchemeId(import.meta.env.PUBLIC_DEFAULT_SCHEME)
		? import.meta.env.PUBLIC_DEFAULT_SCHEME
		: 'green',
	defaultMode:
		import.meta.env.PUBLIC_DEFAULT_MODE === 'light' ? ('light' as const) : ('dark' as const),
	handle: import.meta.env.PUBLIC_SITE_HANDLE ?? '~vaibhav',
	terminalUser: import.meta.env.PUBLIC_TERMINAL_USER ?? 'you',
	terminalHost: import.meta.env.PUBLIC_TERMINAL_HOST ?? 'here',
} as const;

export const themeStorage = {
	scheme: 'theme-scheme',
	mode: 'theme-mode',
} as const;
