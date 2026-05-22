// @ts-check
import { execSync } from 'node:child_process';
import { defineConfig } from 'astro/config';
import expressiveCode from 'astro-expressive-code';
import mermaid from 'astro-mermaid';
import mdx from '@astrojs/mdx';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeFigure from 'rehype-figure';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
	vite: { envDir: '..' },
	integrations: [
		react(),
		expressiveCode({
			themes: ['github-light', 'github-dark'],
			themeCssSelector: (theme) => `[data-mode="${theme.type}"]`,
		}),
		mdx(),
		mermaid({
			theme: 'neutral',
			autoTheme: false,
		}),
		{
			name: 'pagefind',
			hooks: {
				'astro:build:done': ({ dir }) => {
					execSync(`npx pagefind --site "${dir.pathname}"`, { stdio: 'inherit' });
				},
			},
		},
	],
	markdown: {
		remarkPlugins: [remarkMath],
		rehypePlugins: [
			rehypeKatex,
			[
				rehypeAutolinkHeadings,
				{
					behavior: 'append',
					properties: {
						className: ['heading-anchor'],
						ariaHidden: 'true',
						tabIndex: -1,
					},
					content: { type: 'text', value: '#' },
				},
			],
			rehypeFigure,
		],
	},
});
