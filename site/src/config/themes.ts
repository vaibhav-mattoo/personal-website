export const schemes = [
	{ id: 'lavender', label: 'Lavender', swatch: '#a455be' },
	{ id: 'pink', label: 'Pink', swatch: '#d33682' },
	{ id: 'yellow', label: 'Yellow', swatch: '#ac7c14' },
	{ id: 'green', label: 'Green', swatch: '#2d922d' },
	{ id: 'blue', label: 'Blue', swatch: '#2f71b4' },
] as const;

export type SchemeId = (typeof schemes)[number]['id'];

export const schemeIds: SchemeId[] = schemes.map((s) => s.id);

export function isSchemeId(value: string | undefined): value is SchemeId {
	return !!value && (schemeIds as readonly string[]).includes(value);
}
