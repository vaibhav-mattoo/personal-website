import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import remarkBlockIds from '../src/plugins/remark-block-ids.mjs';
import remarkPlot from '../src/plugins/remark-plot.mjs';
import remarkCallout from '../src/plugins/remark-callout.mjs';

async function render(md) {
	const file = await unified()
		.use(remarkParse)
		.use(remarkBlockIds)
		.use(remarkPlot)
		.use(remarkCallout)
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(rehypeRaw)
		.use(rehypeStringify)
		.process(md);
	return String(file);
}

test('a trailing ^id names its paragraph and is removed from the text', async () => {
	const html = await render('Some **bold** text. ^my-para');
	assert.match(html, /<p id="my-para">Some <strong>bold<\/strong> text\.<\/p>/);
});

test('a trailing ^id inside a list item in a callout names the list item', async () => {
	const html = await render('> [!NOTE] Title\n> 1. **The trap:**\n> more text. ^whole-bit-trap\n>    * detail');
	assert.match(html, /<li id="whole-bit-trap"><strong>The trap:<\/strong>\nmore text\.\n<ul>/);
	assert.doesNotMatch(html, /\^whole-bit-trap/);
});

test('a standalone ^id line names the block before it (plot figure)', async () => {
	const html = await render('```plot\nx: [0, 1]\ny = x\n```\n\n^my-plot\n\nAfter.');
	assert.match(html, /<figure class="plot" id="my-plot">/);
	assert.doesNotMatch(html, /\^my-plot/);
	assert.match(html, /<p>After\.<\/p>/);
});

test('a standalone ^id after a callout names the callout', async () => {
	const html = await render('> [!NOTE] Title\n> body\n\n^my-callout');
	assert.match(html, /<(div|details)[^>]*id="my-callout"/);
});

test('text that merely contains ^ is left alone', async () => {
	const html = await render('Powers like 2^n and x ^ 2 stay put.');
	assert.match(html, /2\^n and x \^ 2 stay put\./);
	assert.doesNotMatch(html, /id=/);
});
