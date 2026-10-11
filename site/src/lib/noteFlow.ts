// Pure helpers for a note's `flow` (see content.config.ts) — no astro:content
// import, so they can be unit tested.

export interface FlowStep {
	term: string;
	text: string;
}

export interface FlowHeading {
	depth: number;
	slug: string;
	text: string;
}

function normalize(s: string): string {
	return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The heading a step's term names: the first heading whose text starts
 * with the term, also trying it without a plural "s" ("Chain rules" finds
 * "Chain rule of entropy").
 */
export function headingForTerm(term: string, headings: FlowHeading[]): FlowHeading | undefined {
	const t = normalize(term);
	const candidates = t.endsWith('s') ? [t, t.slice(0, -1)] : [t];
	return headings.find((h) => {
		const text = normalize(h.text);
		return candidates.some((c) => text === c || text.startsWith(`${c} `) || text.startsWith(`${c}(`));
	});
}
