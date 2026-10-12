// Pure helpers for a note's `flow` (see content.config.ts) — no astro:content
// import, so they can be unit tested.

export interface FlowStep {
	term: string;
	text: string;
	aside?: boolean;
	/** For an aside: the main step it branches off (default: the one above). */
	of?: string;
	/** Heading text to link to, when it isn't the first one starting with the term. */
	at?: string;
}

export interface FlowHeading {
	depth: number;
	slug: string;
	text: string;
}

export interface FlowRow {
	step: FlowStep;
	asides: FlowStep[];
}

function normalize(s: string): string {
	return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** For matching a term to a heading: also drops a leading article. */
function headingKey(s: string): string {
	return normalize(s).replace(/^(the|a|an) /, '');
}

/**
 * The heading a step's term names: the first heading whose text starts
 * with the term as whole words, ignoring a leading "The"/"A"/"An" on
 * either, and also trying the term without a plural "s" ("Chain rules"
 * finds "Chain rule of entropy", "Typical set" finds "The typical set",
 * "Consequence" finds "Consequence: data compression").
 */
export function headingForTerm(term: string, headings: FlowHeading[]): FlowHeading | undefined {
	const t = headingKey(term);
	const candidates = t.endsWith('s') ? [t, t.slice(0, -1)] : [t];
	return headings.find((h) => {
		const text = headingKey(h.text);
		return candidates.some((c) => text.startsWith(c) && !/[\p{L}\p{N}]/u.test(text.charAt(c.length)));
	});
}

/**
 * Main-line rows, each with the asides branching off it. An aside goes to
 * the main step named by its `of`, else the nearest main step above it; an
 * aside with neither (nothing above, unknown `of` and nothing above) is
 * promoted to a main step rather than dropped.
 */
export function flowRows(steps: FlowStep[]): FlowRow[] {
	const rows: FlowRow[] = [];
	for (const step of steps) {
		if (!step.aside) {
			rows.push({ step, asides: [] });
			continue;
		}
		const named = step.of ? rows.find((r) => normalize(r.step.term) === normalize(step.of!)) : undefined;
		const host = named ?? rows.at(-1);
		if (host) host.asides.push(step);
		else rows.push({ step: { ...step, aside: false }, asides: [] });
	}
	return rows;
}
