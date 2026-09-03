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
			// Matches the code-block metrics used by docs.pears.com (fumadocs):
			// 12px radius, 13px text, 14px block padding, muted 1px border.
			styleOverrides: {
				borderRadius: 'var(--radius-lg)',
				borderWidth: '1px',
				borderColor: 'var(--border)',
				codeBackground: 'var(--code-bg)',
				codeFontFamily: 'var(--font-display)',
				codeFontSize: '0.8125rem',
				codeLineHeight: '1.6',
				codePaddingBlock: '0.875rem',
				codePaddingInline: '1rem',
				uiFontFamily: 'var(--font-body)',
				uiFontSize: '0.8125rem',
				frames: {
					editorTabBarBackground: 'var(--card)',
					editorActiveTabBackground: 'var(--code-bg)',
					// Fumadocs-style header bar: no floating indicator above the frame.
					editorActiveTabIndicatorTopColor: 'transparent',
					editorActiveTabIndicatorBottomColor: 'var(--accent)',
					editorActiveTabBorderColor: 'var(--border)',
					editorTabBarBorderBottomColor: 'var(--border)',
					terminalBackground: 'var(--code-bg)',
					terminalTitlebarBackground: 'var(--card)',
					terminalTitlebarBorderBottomColor: 'var(--border)',
					frameBoxShadowCssValue: 'none',
				},
			},
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
