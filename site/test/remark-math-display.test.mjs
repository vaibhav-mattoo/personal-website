import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import remarkMathDisplay from '../src/plugins/remark-math-display.mjs';

async function render(md) {
	const file = await unified()
		.use(remarkParse)
		.use(remarkMath)
		.use(remarkMathDisplay)
		.use(remarkRehype)
		.use(rehypeKatex)
		.use(rehypeStringify)
		.process(md);
	return String(file);
}

test('one-line $$…$$ renders as display math, so \\tag works', async () => {
	const html = await render('Intro:\n$$x = 1 \\tag{1.1}$$\nafter');
	assert.match(html, /katex-display/);
	assert.doesNotMatch(html, /katex-error/);
});

test('single-dollar math stays inline', async () => {
	const html = await render('Let $x = 1$ be given.');
	assert.doesNotMatch(html, /katex-display/);
	assert.match(html, /class="katex"/);
});

test('fenced $$ blocks still render as display math', async () => {
	const html = await render('> $$\n> a - b, \\qquad\n> c - d.\n> $$\n> after');
	assert.match(html, /katex-display/);
	assert.doesNotMatch(html, /katex-error/);
	assert.match(html, /after/);
});
