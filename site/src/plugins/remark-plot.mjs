// Remark plugin: turns ```plot fenced blocks into a static inline SVG of one
// or more curves, rendered at build time — no client-side JS. Colors come
// from CSS custom properties (see `.plot` in styles/prose.css and the
// --plot-* tokens), so plots follow light/dark mode and the accent scheme.
//
// Block syntax — one setting or curve per line, `#` starts a comment:
//
//   ```plot
//   title: Surprise of a single symbol
//   x: [0, 1]                 x-axis range (required)
//   y: [0, 7]                 y-axis range (optional, fitted to data if omitted)
//   xlabel: p
//   ylabel: bits
//   h(p) = -log2(p)           a curve; `f(v) = …` makes `v` the variable
//   y = -ln(x) | nats         `| label` overrides the legend text
//   ```
//
// Formulas: numbers, + - * / ^, parentheses, constants pi and e, and the
// functions sin cos tan asin acos atan sinh cosh tanh exp sqrt abs floor
// ceil min max, ln (natural log), log2, log10, and log(x, base) — plain
// log(x) is the natural log. Multiplication must be written with `*`.
//
// A block that fails to parse renders a visible error box and logs a build
// warning instead of failing the build.

// ---------------------------------------------------------------------------
// Expression parsing

const FUNCTIONS = {
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	asin: Math.asin,
	acos: Math.acos,
	atan: Math.atan,
	sinh: Math.sinh,
	cosh: Math.cosh,
	tanh: Math.tanh,
	exp: Math.exp,
	sqrt: Math.sqrt,
	abs: Math.abs,
	floor: Math.floor,
	ceil: Math.ceil,
	min: Math.min,
	max: Math.max,
	ln: Math.log,
	log2: Math.log2,
	log10: Math.log10,
	log: (x, base) => (base === undefined ? Math.log(x) : Math.log(x) / Math.log(base)),
};

const CONSTANTS = { pi: Math.PI, e: Math.E };

function tokenize(src) {
	const tokens = [];
	const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z_0-9]*)|(\S))/gy;
	let m;
	while (re.lastIndex < src.length && (m = re.exec(src))) {
		if (m[1] !== undefined) tokens.push({ type: 'num', value: Number(m[1]) });
		else if (m[2] !== undefined) tokens.push({ type: 'name', value: m[2] });
		else if (m[3] !== undefined) {
			if (!'+-*/^(),'.includes(m[3])) throw new Error(`unexpected character "${m[3]}"`);
			tokens.push({ type: 'op', value: m[3] });
		}
	}
	return tokens;
}

/**
 * Compiles `src` into `(variableValue) => number`. Grammar, lowest to
 * highest precedence: sums, products, unary minus, powers (right-assoc,
 * so -x^2 = -(x^2) and 2^3^2 = 2^9), then atoms.
 */
export function compileExpression(src, variable = 'x') {
	const tokens = tokenize(src);
	let i = 0;
	const peek = () => tokens[i];
	const isOp = (v) => tokens[i]?.type === 'op' && tokens[i].value === v;
	const expect = (v) => {
		if (!isOp(v)) throw new Error(`expected "${v}"${tokens[i] ? ` but found "${tokens[i].value}"` : ' at end'}`);
		i++;
	};

	function sum() {
		let node = product();
		while (isOp('+') || isOp('-')) {
			const op = tokens[i++].value;
			const left = node;
			const right = product();
			node = op === '+' ? (v) => left(v) + right(v) : (v) => left(v) - right(v);
		}
		return node;
	}

	function product() {
		let node = unary();
		while (isOp('*') || isOp('/')) {
			const op = tokens[i++].value;
			const left = node;
			const right = unary();
			node = op === '*' ? (v) => left(v) * right(v) : (v) => left(v) / right(v);
		}
		return node;
	}

	function unary() {
		if (isOp('-')) {
			i++;
			const inner = unary();
			return (v) => -inner(v);
		}
		if (isOp('+')) {
			i++;
			return unary();
		}
		return power();
	}

	function power() {
		const base = atom();
		if (isOp('^')) {
			i++;
			const exponent = unary();
			return (v) => base(v) ** exponent(v);
		}
		return base;
	}

	function atom() {
		const tok = peek();
		if (!tok) throw new Error('unexpected end of formula');
		if (tok.type === 'num') {
			i++;
			return () => tok.value;
		}
		if (isOp('(')) {
			i++;
			const inner = sum();
			expect(')');
			return inner;
		}
		if (tok.type === 'name') {
			i++;
			if (isOp('(')) {
				const fn = FUNCTIONS[tok.value];
				if (!fn) throw new Error(`unknown function "${tok.value}"`);
				i++;
				const args = [sum()];
				while (isOp(',')) {
					i++;
					args.push(sum());
				}
				expect(')');
				return (v) => fn(...args.map((a) => a(v)));
			}
			if (tok.value === variable) return (v) => v;
			if (tok.value in CONSTANTS) return () => CONSTANTS[tok.value];
			if (tok.value in FUNCTIONS) throw new Error(`"${tok.value}" needs parentheses, e.g. ${tok.value}(${variable})`);
			throw new Error(`unknown name "${tok.value}" (the variable is "${variable}")`);
		}
		throw new Error(`unexpected "${tok.value}"`);
	}

	const fn = sum();
	if (i < tokens.length) {
		const tok = tokens[i];
		const hint = tok.type !== 'op' || tok.value === '(' ? ' (write multiplication with *)' : '';
		throw new Error(`unexpected "${tok.value}"${hint}`);
	}
	return fn;
}

// ---------------------------------------------------------------------------
// Block parsing

function parseRange(text, key) {
	const m = text.match(/^\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*\]$/);
	if (!m) throw new Error(`${key} should look like [min, max]`);
	const [lo, hi] = [m[1], m[2]].map((s) => compileExpression(s)(0));
	if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) throw new Error(`${key} range must have min < max`);
	return [lo, hi];
}

const SETTINGS = new Set(['title', 'x', 'y', 'xlabel', 'ylabel', 'samples']);

/** Parses a plot block's source into a spec; throws on invalid input. */
export function parsePlotSpec(source) {
	const spec = { curves: [] };
	for (const raw of source.split('\n')) {
		const line = raw.replace(/#.*$/, '').trim();
		if (!line) continue;

		const setting = line.match(/^([a-z]+)\s*:\s*(.*)$/);
		if (setting && SETTINGS.has(setting[1])) {
			const [, key, value] = setting;
			if (key === 'x' || key === 'y') spec[key] = parseRange(value, key);
			else if (key === 'samples') spec.samples = Math.min(4000, Math.max(20, Number(value) || 0));
			else spec[key] = value;
			continue;
		}

		const curve = line.match(/^([^=|]+?)\s*=\s*([^|]+?)\s*(?:\|\s*(.+))?$/);
		if (!curve) throw new Error(`can't read line "${line}" — expected "setting: value" or "f(x) = formula"`);
		const [, lhs, expr, label] = curve;
		const variable = lhs.match(/^\s*[A-Za-z_]\w*\s*\(\s*([A-Za-z_]\w*)\s*\)\s*$/)?.[1] ?? 'x';
		let fn;
		try {
			fn = compileExpression(expr, variable);
		} catch (err) {
			throw new Error(`in "${expr}": ${err.message}`);
		}
		spec.curves.push({ label: (label ?? lhs).trim(), expr, variable, fn });
	}
	if (!spec.x) throw new Error('missing x range, e.g. "x: [0, 1]"');
	if (spec.curves.length === 0) throw new Error('no curves, e.g. "y = sin(x)"');
	return spec;
}

// ---------------------------------------------------------------------------
// Ticks, sampling, SVG

/** Round-number ticks (1/2/5 × 10^k) covering [lo, hi], about `target` of them. */
export function niceTicks(lo, hi, target = 6) {
	const rough = (hi - lo) / target;
	const mag = 10 ** Math.floor(Math.log10(rough));
	const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag;
	const ticks = [];
	for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + step * 1e-9; t += step) {
		ticks.push(Math.abs(t) < step * 1e-9 ? 0 : Number(t.toPrecision(12)));
	}
	return ticks;
}

function formatTick(t) {
	if (t === 0) return '0';
	const abs = Math.abs(t);
	if (abs >= 1e4 || abs < 1e-3) return t.toExponential(0).replace('e+', 'e');
	return String(Number(t.toPrecision(6)));
}

function evaluate(fn, x) {
	try {
		return fn(x);
	} catch {
		return NaN;
	}
}

/**
 * Evenly spaced samples, plus extra ones closing in on any point where the
 * function becomes undefined (e.g. log at 0), so curves that blow up run
 * to the edge of the plot instead of stopping one sample short.
 */
function sampleCurve(fn, [lo, hi], n) {
	const uniform = [];
	for (let k = 0; k <= n; k++) {
		const x = lo + ((hi - lo) * k) / n;
		uniform.push([x, evaluate(fn, x)]);
	}
	const points = [uniform[0]];
	for (let k = 1; k < uniform.length; k++) {
		const [ax, ay] = uniform[k - 1];
		const [bx, by] = uniform[k];
		if (Number.isFinite(ay) !== Number.isFinite(by)) {
			const [from, to] = Number.isFinite(ay) ? [ax, bx] : [bx, ax];
			const extra = [];
			for (let j = 1; j <= 10; j++) {
				const x = to + (from - to) * 10 ** -j;
				extra.push([x, evaluate(fn, x)]);
			}
			// `extra` runs from the defined side toward the undefined point;
			// keep the points in increasing x order.
			points.push(...(Number.isFinite(ay) ? extra : extra.reverse()));
		}
		points.push(uniform[k]);
	}
	return points;
}

function escapeXml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const W = 640;
const H = 400;
const M = { top: 20, right: 20, bottom: 52, left: 80 };
let plotCounter = 0;

/** Renders a parsed spec to an SVG string. */
export function renderPlotSvg(spec) {
	const samples = spec.samples ?? 600;
	const series = spec.curves.map((c) => sampleCurve(c.fn, spec.x, samples));

	let [ylo, yhi] = spec.y ?? [Infinity, -Infinity];
	if (!spec.y) {
		for (const pts of series) {
			for (const [, y] of pts) {
				if (Number.isFinite(y)) {
					ylo = Math.min(ylo, y);
					yhi = Math.max(yhi, y);
				}
			}
		}
		if (!Number.isFinite(ylo)) [ylo, yhi] = [-1, 1];
		if (ylo === yhi) [ylo, yhi] = [ylo - 1, yhi + 1];
		const pad = (yhi - ylo) * 0.05;
		[ylo, yhi] = [ylo - pad, yhi + pad];
	}

	const [xlo, xhi] = spec.x;
	const pw = W - M.left - M.right;
	const ph = H - M.top - M.bottom;
	const sx = (x) => M.left + ((x - xlo) / (xhi - xlo)) * pw;
	const sy = (y) => M.top + ((yhi - y) / (yhi - ylo)) * ph;
	const fmt = (n) => Number(n.toFixed(2));
	const id = `plot-clip-${++plotCounter}`;

	const parts = [];
	const xticks = niceTicks(xlo, xhi);
	const yticks = niceTicks(ylo, yhi, 5);

	for (const t of xticks) {
		const px = fmt(sx(t));
		parts.push(`<line class="plot__grid" x1="${px}" y1="${M.top}" x2="${px}" y2="${M.top + ph}"/>`);
		parts.push(`<text class="plot__tick" x="${px}" y="${M.top + ph + 18}" text-anchor="middle">${escapeXml(formatTick(t))}</text>`);
	}
	for (const t of yticks) {
		const py = fmt(sy(t));
		parts.push(`<line class="plot__grid" x1="${M.left}" y1="${py}" x2="${M.left + pw}" y2="${py}"/>`);
		parts.push(`<text class="plot__tick" x="${M.left - 8}" y="${py}" text-anchor="end" dominant-baseline="middle">${escapeXml(formatTick(t))}</text>`);
	}
	// Zero axes, when inside the plotted window.
	if (ylo < 0 && yhi > 0) parts.push(`<line class="plot__axis" x1="${M.left}" y1="${fmt(sy(0))}" x2="${M.left + pw}" y2="${fmt(sy(0))}"/>`);
	if (xlo < 0 && xhi > 0) parts.push(`<line class="plot__axis" x1="${fmt(sx(0))}" y1="${M.top}" x2="${fmt(sx(0))}" y2="${M.top + ph}"/>`);
	parts.push(`<rect class="plot__frame" x="${M.left}" y="${M.top}" width="${pw}" height="${ph}"/>`);

	// Curves: break the path wherever the function is undefined, and clamp
	// far-out values so the clip path (not huge coordinates) trims them.
	const span = yhi - ylo;
	series.forEach((pts, idx) => {
		let d = '';
		let pen = false;
		for (const [x, y] of pts) {
			if (!Number.isFinite(y)) {
				pen = false;
				continue;
			}
			const cy = Math.min(yhi + span, Math.max(ylo - span, y));
			d += `${pen ? 'L' : 'M'}${fmt(sx(x))} ${fmt(sy(cy))}`;
			pen = true;
		}
		if (d) parts.push(`<path class="plot__curve plot__curve--${(idx % 4) + 1}" clip-path="url(#${id})" d="${d}"/>`);
	});

	if (spec.xlabel) parts.push(`<text class="plot__label" x="${M.left + pw / 2}" y="${H - 10}" text-anchor="middle">${escapeXml(spec.xlabel)}</text>`);
	if (spec.ylabel) {
		parts.push(
			`<text class="plot__label" x="18" y="${M.top + ph / 2}" text-anchor="middle" transform="rotate(-90 18 ${M.top + ph / 2})">${escapeXml(spec.ylabel)}</text>`,
		);
	}

	const description = spec.curves.map((c) => `${c.label} = ${c.expr}`).join('; ');
	const title = spec.title ? `${spec.title}: ${description}` : description;
	return [
		`<svg class="plot__svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(title)}" xmlns="http://www.w3.org/2000/svg">`,
		`<title>${escapeXml(title)}</title>`,
		`<defs><clipPath id="${id}"><rect x="${M.left}" y="${M.top}" width="${pw}" height="${ph}"/></clipPath></defs>`,
		...parts,
		'</svg>',
	].join('');
}

function renderLegend(spec) {
	if (spec.curves.length < 2) return '';
	const items = spec.curves
		.map(
			(c, idx) =>
				`<li><svg class="plot__swatch" viewBox="0 0 24 8" aria-hidden="true"><line class="plot__curve plot__curve--${(idx % 4) + 1}" x1="1" y1="4" x2="23" y2="4"/></svg>${escapeXml(c.label)}</li>`,
		)
		.join('');
	return `<ul class="plot__legend">${items}</ul>`;
}

/** Full HTML for one plot block, or a visible error box if it's invalid. */
export function renderPlotBlock(source) {
	try {
		const spec = parsePlotSpec(source);
		const caption = spec.title ? `<figcaption>${escapeXml(spec.title)}</figcaption>` : '';
		return { html: `<figure class="plot">${renderPlotSvg(spec)}${renderLegend(spec)}${caption}</figure>` };
	} catch (err) {
		return {
			error: err.message,
			html: `<div class="plot plot--error" role="note"><strong>Plot error:</strong> ${escapeXml(err.message)}</div>`,
		};
	}
}

export default function remarkPlot() {
	return (tree, file) => {
		const visit = (node) => {
			if (!Array.isArray(node.children)) return;
			node.children = node.children.map((child) => {
				if (child.type === 'code' && child.lang === 'plot') {
					const { html, error } = renderPlotBlock(child.value);
					if (error) {
						const line = child.position?.start?.line;
						console.warn(`[plot] ${file?.path ?? 'note'}${line ? `:${line}` : ''}: ${error}`);
					}
					return { type: 'html', value: html };
				}
				visit(child);
				return child;
			});
		};
		visit(tree);
	};
}
