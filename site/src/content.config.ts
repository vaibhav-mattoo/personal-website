import { fileURLToPath } from 'node:url';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const notesDir = fileURLToPath(new URL('./content/notes', import.meta.url));

const notes = defineCollection({
	loader: glob({ pattern: '**/*.{md,mdx}', base: notesDir }),
	schema: z.object({
		title: z.string(),
		date: z.coerce.date(),
		summary: z.string().optional(),
		tags: z.array(z.string()).default([]),
	}),
});

export const collections = { notes };
