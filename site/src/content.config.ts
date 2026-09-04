import { fileURLToPath } from 'node:url';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const notesDir = fileURLToPath(new URL('./content/notes', import.meta.url));
const topicsDir = fileURLToPath(new URL('./content/topics', import.meta.url));

const notes = defineCollection({
	loader: glob({ pattern: '**/*.{md,mdx}', base: notesDir }),
	schema: z
		.object({
			title: z.string(),
			date: z.coerce.date(),
			summary: z.string().optional(),
			tags: z.array(z.string()).default([]),
			draft: z.boolean().default(false),
			aliases: z.array(z.string()).default([]),
			// An unguessable capability token (crypto.randomBytes(16).toString
			// ('hex'), see scripts/new-share.mjs) — presence alone means "never
			// in a public listing" (isVisible, site/src/lib/visibility.ts). The
			// only place a shared note is reachable is /s/<share>/
			// (site/src/pages/s/[token].astro). See docs/sharing.md.
			share: z
				.string()
				.regex(/^[0-9a-f]{32}$/, 'share must be a 32-char lowercase hex token')
				.optional(),
			// Past this date, /s/<share>/ stops being built — the link goes
			// dead. Does not affect listing visibility: a note with `share` set
			// is already excluded from those regardless of expiry.
			shareUntil: z.coerce.date().optional(),
			kind: z.enum(['note', 'concept', 'experiment', 'review', 'idea', 'paper']).default('note'),
			relations: z
				.array(
					z.object({
						type: z.string(),
						target: z.string(),
					}),
				)
				.default([]),
			updated: z.coerce.date().optional(),

			// Bibliographic fields — only meaningful for kind: 'paper' (enforced
			// below), but not namespaced under a nested object so a paper note's
			// frontmatter reads like plain metadata, not a sub-schema. No
			// separate `papers` collection: a paper is just a note with these
			// fields filled in, filed under content/notes/lit/ by convention
			// only — nothing in the code depends on that path.
			status: z.enum(['to-read', 'skimmed', 'reading', 'read']).default('to-read'),
			rating: z.number().min(1).max(5).optional(),
			added: z.coerce.date().optional(),
			authors: z.array(z.string()).default([]),
			year: z.number().optional(),
			venue: z.string().optional(),
			doi: z.string().optional(),
			arxiv: z.string().optional(),
			url: z.string().optional(),
			code: z.string().optional(),
			bibkey: z.string().optional(),
			// Note ids (not DOIs/arXiv ids) — see site/src/lib/links.ts, which
			// only turns a `cites` entry into an edge once it resolves to a real
			// note; an unresolved one is reported informationally, not broken,
			// since citing a paper with no note yet is the normal case.
			cites: z.array(z.string()).default([]),
			suggestedBy: z.string().optional(),
		})
		.superRefine((data, ctx) => {
			if (data.kind !== 'paper') return;
			if (data.authors.length === 0) {
				ctx.addIssue({
					code: 'custom',
					path: ['authors'],
					message: "kind: 'paper' requires at least one author",
				});
			}
			if (data.year === undefined) {
				ctx.addIssue({
					code: 'custom',
					path: ['year'],
					message: "kind: 'paper' requires a year",
				});
			}
			if (!data.bibkey) {
				ctx.addIssue({
					code: 'custom',
					path: ['bibkey'],
					message: "kind: 'paper' requires a bibkey",
				});
			}
			if (!data.doi && !data.arxiv && !data.url) {
				ctx.addIssue({
					code: 'custom',
					path: ['doi'],
					message: "kind: 'paper' requires at least one of doi, arxiv, or url",
				});
			}
		}),
});

const topics = defineCollection({
	loader: glob({ pattern: '**/*.{md,mdx}', base: topicsDir }),
	schema: z.object({
		title: z.string(),
		summary: z.string().optional(),
		parent: z.string().optional(),
		kind: z.enum(['area', 'course', 'paper-thread', 'scratch']).default('area'),
		sequence: z.array(z.string()).default([]),
		hidden: z.boolean().default(false),
	}),
});

export const collections = { notes, topics };
