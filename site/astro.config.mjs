// @ts-check
import { execSync } from 'node:child_process';
import { defineConfig } from 'astro/config';
import expressiveCode from 'astro-expressive-code';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

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
    rehypePlugins: [rehypeKatex],
  },
});