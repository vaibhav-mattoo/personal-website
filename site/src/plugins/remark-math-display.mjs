// Remark plugin, runs after remarkMath in astro.config.mjs. Two fixes for how
// remark-math reads `$$` compared with how the notes (written in Obsidian)
// use it:
//
// 1. `$$x$$` on one line is parsed as *inline* math, so it renders at text
//    size and `\tag{…}` fails ("\tag works only in display equations").
//    Obsidian renders any `$$…$$` as display math, so do the same: mark
//    inline math whose source starts with `$$` as display for rehype-katex.
//
// 2. A line *starting* with `$$` followed by more text opens a display-math
//    fence: that first line is silently dropped (it becomes the fence's
//    "meta") and the block runs until a line that is only `$$`, swallowing
//    the rest of the note or callout. This can't be repaired after parsing,
//    so warn at build time; the fix is to put `$$` on its own lines.

function sourceOf(file) {
	return typeof file?.value === 'string' ? file.value : String(file?.value ?? '');
}

function visit(node, fn) {
	fn(node);
	if (Array.isArray(node.children)) for (const child of node.children) visit(child, fn);
}

export default function remarkMathDisplay() {
	return (tree, file) => {
		const source = sourceOf(file);
		visit(tree, (node) => {
			if (node.type === 'inlineMath') {
				const start = node.position?.start?.offset;
				if (start === undefined || source.slice(start, start + 2) !== '$$') return;
				node.data ??= {};
				node.data.hProperties = {
					...node.data.hProperties,
					className: ['language-math', 'math-display'],
				};
			} else if (node.type === 'math' && node.meta) {
				const line = node.position?.start?.line;
				console.warn(
					`[math] ${file?.path ?? 'note'}${line ? `:${line}` : ''}: text after an opening ` +
						'`$$` is dropped and the block runs to the next `$$` line. Put `$$` on its own lines.',
				);
			}
		});
	};
}
