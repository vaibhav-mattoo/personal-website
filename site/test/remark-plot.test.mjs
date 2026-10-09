import { test } from 'node:test';
import assert from 'node:assert/strict';
import remarkPlot, { compileExpression, parsePlotSpec, niceTicks, renderPlotBlock } from '../src/plugins/remark-plot.mjs';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('compileExpression: precedence, unary minus and right-associative powers', () => {
	close(compileExpression('1 + 2 * 3')(0), 7);
	close(compileExpression('-x^2')(3), -9);
	close(compileExpression('2^3^2')(0), 512);
	close(compileExpression('(1 + x) / 2')(3), 2);
	close(compileExpression('-(-x)')(4), 4);
});

test('compileExpression: functions, constants and logs', () => {
	close(compileExpression('-log2(x)')(0.25), 2);
	close(compileExpression('ln(e)')(0), 1);
	close(compileExpression('log(x)')(Math.E), 1);
	close(compileExpression('log(x, 3)')(81), 4);
	close(compileExpression('sin(pi / 2) + max(1, x)')(5), 6);
	close(compileExpression('1.5e2')(0), 150);
});

test('compileExpression: uses the named variable', () => {
	close(compileExpression('-p * log2(p)', 'p')(0.5), 0.5);
	assert.throws(() => compileExpression('x + 1', 'p'), /unknown name "x"/);
});

test('compileExpression: helpful errors', () => {
	assert.throws(() => compileExpression('2x'), /write multiplication with \*/);
	assert.throws(() => compileExpression('foo(x)'), /unknown function "foo"/);
	assert.throws(() => compileExpression('sin x'), /needs parentheses/);
	assert.throws(() => compileExpression('(x + 1'), /expected "\)"/);
	assert.throws(() => compileExpression('x $ 2'), /unexpected character/);
});

test('parsePlotSpec reads settings, curves, variables and labels', () => {
	const spec = parsePlotSpec(
		['title: Surprise  # a comment', 'x: [0, 1]', 'y: [0, 2*pi]', 'xlabel: p', 'h(p) = -log2(p)', 'y = -ln(x) | nats'].join('\n'),
	);
	assert.equal(spec.title, 'Surprise');
	assert.deepEqual(spec.x, [0, 1]);
	close(spec.y[1], 2 * Math.PI);
	assert.equal(spec.xlabel, 'p');
	assert.deepEqual(
		spec.curves.map((c) => [c.label, c.variable]),
		[
			['h(p)', 'p'],
			['nats', 'x'],
		],
	);
});

test('parsePlotSpec rejects incomplete or invalid blocks', () => {
	assert.throws(() => parsePlotSpec('y = x'), /missing x range/);
	assert.throws(() => parsePlotSpec('x: [0, 1]'), /no curves/);
	assert.throws(() => parsePlotSpec('x: [1, 0]\ny = x'), /min < max/);
	assert.throws(() => parsePlotSpec('x: [0, 1]\ny = 2x'), /in "2x"/);
});

test('niceTicks picks round steps', () => {
	assert.deepEqual(niceTicks(0, 1), [0, 0.2, 0.4, 0.6, 0.8, 1]);
	assert.deepEqual(niceTicks(0, 7, 5), [0, 2, 4, 6]);
	assert.deepEqual(niceTicks(-1.5, 1.5, 6), [-1.5, -1, -0.5, 0, 0.5, 1, 1.5]);
});

test('renderPlotBlock: SVG with one path per curve, broken at undefined points', () => {
	const { html, error } = renderPlotBlock('x: [0, 1]\ny: [0, 7]\nh(p) = -log2(p)\ny = 1 - x | line');
	assert.equal(error, undefined);
	assert.match(html, /^<figure class="plot"><svg/);
	assert.equal((html.match(/<path class="plot__curve/g) ?? []).length, 2);
	assert.doesNotMatch(html, /NaN|Infinity/);
	assert.match(html, /class="plot__legend"/);
});

test('renderPlotBlock escapes text and reports errors as a visible box', () => {
	assert.match(renderPlotBlock('title: a < b\nx: [0, 1]\ny = x').html, /a &lt; b/);
	const bad = renderPlotBlock('x: [0, 1]\ny = 2x');
	assert.match(bad.error, /multiplication/);
	assert.match(bad.html, /plot--error/);
});

test('remarkPlot replaces ```plot code nodes only', () => {
	const tree = {
		type: 'root',
		children: [
			{ type: 'code', lang: 'plot', value: 'x: [0, 1]\ny = x' },
			{ type: 'code', lang: 'js', value: 'let x = 1' },
			{ type: 'blockquote', children: [{ type: 'code', lang: 'plot', value: 'x: [0, 1]\ny = x^2' }] },
		],
	};
	remarkPlot()(tree, {});
	assert.equal(tree.children[0].type, 'html');
	assert.equal(tree.children[1].type, 'code');
	assert.equal(tree.children[2].children[0].type, 'html');
});

test('curves that blow up at an edge run past the plot top, in x order', () => {
	for (const src of ['x: [0, 1]\ny: [0, 7]\ny = -ln(x)', 'x: [-1, 0]\ny: [0, 7]\ny = -ln(-x)']) {
		const d = renderPlotBlock(src).html.match(/<path class="plot__curve[^"]*" clip-path="[^"]*" d="([^"]+)"/)[1];
		const pts = [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
		for (let k = 1; k < pts.length; k++) assert.ok(pts[k][0] >= pts[k - 1][0], 'x increases');
		assert.ok(Math.min(...pts.map((p) => p[1])) < 20, 'reaches above the plot area (top margin is 20)');
	}
});
