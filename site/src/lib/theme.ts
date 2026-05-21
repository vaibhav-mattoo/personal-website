import { themeStorage } from '../config/site';

export function setScheme(id: string) {
	document.documentElement.dataset.scheme = id;
	localStorage.setItem(themeStorage.scheme, id);
}

export function setMode(mode: 'light' | 'dark') {
	document.documentElement.dataset.mode = mode;
	localStorage.setItem(themeStorage.mode, mode);
}

export function toggleMode() {
	setMode(document.documentElement.dataset.mode === 'dark' ? 'light' : 'dark');
}

export function bindThemeControls() {
	document.querySelectorAll<HTMLButtonElement>('[data-set-scheme]').forEach((btn) => {
		btn.addEventListener('click', () => {
			setScheme(btn.dataset.setScheme!);
			btn.closest('details')?.removeAttribute('open');
		});
	});
	document.getElementById('mode-toggle')?.addEventListener('click', toggleMode);
}
