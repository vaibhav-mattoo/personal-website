import { isSchemeId } from './themes';

export const site = {
	name: import.meta.env.PUBLIC_SITE_NAME ?? 'vmattoo.dev',
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
