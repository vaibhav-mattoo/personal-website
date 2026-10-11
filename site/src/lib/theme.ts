import { themeStorage } from '../config/site';

/** Points <meta name="theme-color"> at the current --bg, so browser and
 *  home-screen app chrome match the page in either mode. */
export function syncThemeColor() {
	const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
	const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	if (meta && bg) meta.content = bg;
}

export function setScheme(id: string) {
	document.documentElement.dataset.scheme = id;
	localStorage.setItem(themeStorage.scheme, id);
	syncThemeColor();
}

export function setMode(mode: 'light' | 'dark') {
	document.documentElement.dataset.mode = mode;
	localStorage.setItem(themeStorage.mode, mode);
	syncThemeColor();
}

export function toggleMode() {
	setMode(document.documentElement.dataset.mode === 'dark' ? 'light' : 'dark');
}

export function bindThemeControls() {
	syncThemeColor();
	document.querySelectorAll<HTMLButtonElement>('[data-set-scheme]').forEach((btn) => {
		btn.addEventListener('click', () => {
			setScheme(btn.dataset.setScheme!);
			btn.closest('details')?.removeAttribute('open');
		});
	});
	document.getElementById('mode-toggle')?.addEventListener('click', toggleMode);
}
