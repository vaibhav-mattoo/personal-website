import { fileURLToPath } from 'node:url';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const notesDir = fileURLToPath(new URL('./content/notes', import.meta.url));
const topicsDir = fileURLToPath(new URL('./content/topics', import.meta.url));

const notes = defineCollection({
	loader: glob({ pattern: '**/*.{md,mdx}', base: notesDir }),
	schema: z.object({
		title: z.string(),
		date: z.coerce.date(),
		summary: z.string().optional(),
		tags: z.array(z.string()).default([]),
		draft: z.boolean().default(false),
		aliases: z.array(z.string()).default([]),
		kind: z.enum(['note', 'concept', 'experiment', 'review', 'idea']).default('note'),
		relations: z
			.array(
				z.object({
					type: z.string(),
					target: z.string(),
				}),
			)
			.default([]),
		updated: z.coerce.date().optional(),
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
