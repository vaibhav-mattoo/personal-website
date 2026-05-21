import { isSchemeId, schemes } from './themes';

export const site = {
	name: import.meta.env.PUBLIC_SITE_NAME ?? 'vmattoo.dev',
	defaultScheme: isSchemeId(import.meta.env.PUBLIC_DEFAULT_SCHEME)
		? import.meta.env.PUBLIC_DEFAULT_SCHEME
		: schemes[0].id,
	defaultMode:
		import.meta.env.PUBLIC_DEFAULT_MODE === 'dark' ? ('dark' as const) : ('light' as const),
	handle: import.meta.env.PUBLIC_SITE_HANDLE ?? '~vaibhav',
	terminalUser: import.meta.env.PUBLIC_TERMINAL_USER ?? 'you',
	terminalHost: import.meta.env.PUBLIC_TERMINAL_HOST ?? 'here',
} as const;

export const themeStorage = {
	scheme: 'theme-scheme',
	mode: 'theme-mode',
} as const;
