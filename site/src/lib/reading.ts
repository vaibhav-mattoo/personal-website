// Pure reading-status aggregation — no `astro:content` import here on
// purpose, mirroring links.ts/topics.ts. Callers (topic pages) are
// responsible for narrowing a topic's notes down to its paper notes (kind
// === 'paper') before calling this — this module doesn't know what a
// "topic" is, it just counts whatever it's given.

export type ReadingStatus = 'to-read' | 'skimmed' | 'reading' | 'read';

export type ReadingEntry = {
	status: ReadingStatus;
	/** When it entered the reading list. */
	added?: Date;
	/** Last time the note itself was edited. */
	updated?: Date;
	/** The note's own creation date — always present, the final fallback. */
	date: Date;
};

export type CoverageStats = {
	total: number;
	read: number;
	reading: number;
	skimmed: number;
	toRead: number;
	/** The most recent of each note's updated/added/date, or null if empty. */
	lastActivity: Date | null;
};

/** Tallies reading status across a set of paper notes (e.g. a topic's). */
export function coverageStats(notes: ReadingEntry[]): CoverageStats {
	const stats: CoverageStats = {
		total: 0,
		read: 0,
		reading: 0,
		skimmed: 0,
		toRead: 0,
		lastActivity: null,
	};

	for (const note of notes) {
		stats.total++;
		switch (note.status) {
			case 'read':
				stats.read++;
				break;
			case 'reading':
				stats.reading++;
				break;
			case 'skimmed':
				stats.skimmed++;
				break;
			default:
				stats.toRead++;
		}

		const activity = note.updated ?? note.added ?? note.date;
		if (activity && (!stats.lastActivity || activity.valueOf() > stats.lastActivity.valueOf())) {
			stats.lastActivity = activity;
		}
	}

	return stats;
}
