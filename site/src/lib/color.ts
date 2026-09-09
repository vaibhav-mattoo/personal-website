// Pure color math — no DOM/astro:content import, safe to unit test and to
// import from the client-side Graph component. Converts the site's actual
// --accent hex value into an OKLCH hue, then generates N evenly-spaced
// hues around the wheel starting there, so the graph's per-topic palette
// is reconciled with whichever of the 5 accent schemes is active instead
// of a fixed, unrelated set of hues.

function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** #rrggbb (or #rgb) -> OKLCH hue in degrees [0, 360). */
export function hexToOklchHue(hex: string): number {
	const normalized = hex.replace('#', '');
	const full =
		normalized.length === 3
			? normalized
					.split('')
					.map((c) => c + c)
					.join('')
			: normalized;
	const r = srgbToLinear(parseInt(full.slice(0, 2), 16) / 255);
	const g = srgbToLinear(parseInt(full.slice(2, 4), 16) / 255);
	const b = srgbToLinear(parseInt(full.slice(4, 6), 16) / 255);

	// Linear sRGB -> LMS (OKLab's intermediate space).
	const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
	const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
	const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

	const l_ = Math.cbrt(l);
	const m_ = Math.cbrt(m);
	const s_ = Math.cbrt(s);

	const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const bLab = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

	const hueRad = Math.atan2(bLab, a);
	const hueDeg = (hueRad * 180) / Math.PI;
	return (hueDeg + 360) % 360;
}

/** N hues, evenly spaced starting at baseHueDeg — index 0 is exactly baseHueDeg. */
export function evenlySpacedHues(baseHueDeg: number, count: number): number[] {
	if (count <= 0) return [];
	const step = 360 / count;
	return Array.from({ length: count }, (_, i) => (baseHueDeg + step * i) % 360);
}

/** oklch() string for a top-level topic at the given hue. */
export function topicOklch(hueDeg: number): string {
	return `oklch(0.72 0.1 ${hueDeg.toFixed(1)}deg)`;
}

/** Subtopics inherit their parent's hue at reduced lightness/chroma per depth. */
export function subtopicOklch(hueDeg: number, depth: number): string {
	const lightness = Math.max(0.42, 0.72 - depth * 0.08);
	const chroma = Math.max(0.05, 0.1 - depth * 0.015);
	return `oklch(${lightness.toFixed(2)} ${chroma.toFixed(3)} ${hueDeg.toFixed(1)}deg)`;
}
