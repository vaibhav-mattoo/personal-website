// Remark plugin: turns ```bits fenced blocks into a static bit-layout figure
// — each row is a codeword drawn as bit cells grouped into labelled fields,
// e.g. a flag bit followed by an index. Plain HTML/CSS (styles in
// styles/prose.css), so it wraps on narrow screens and follows the theme.
//
//   ```bits
//   title: The two-part code for n = 10
//   Typical tape 1111011111 → 5 bits: flag 0 | index in typical pile 0100
//   Atypical tape 1110111011 → 11 bits: flag 1 | the tape itself 1110111011
//   ```
//
// Each row is `label: field | field | …`, and each field is `name bits`: a
// free-text name followed by a run of 0s and 1s. Fields with the same name
// share a color across rows. An Obsidian `^block-id` after the block puts an
// id on the figure (see remark-block-ids.mjs). Invalid blocks render an
// error box and log a build warning.

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Parses a bits block into `{ title, rows: [{ label, fields: [{ name, bits }] }] }`. */
export function parseBitsSpec(source) {
	const spec = { rows: [] };
	for (const raw of source.split('\n')) {
		const line = raw.replace(/(^|\s)#.*$/, '').trim();
		if (!line) continue;
		const title = line.match(/^title\s*:\s*(.+)$/);
		if (title) {
			spec.title = title[1];
			continue;
		}
		const colon = line.lastIndexOf(':', line.indexOf('|') === -1 ? line.length : line.indexOf('|'));
		if (colon === -1) throw new Error(`can't read "${line}" — expected "label: name bits | name bits"`);
		const label = line.slice(0, colon).trim();
		const fields = line
			.slice(colon + 1)
			.split('|')
			.map((part) => {
				const m = part.trim().match(/^(.*?)\s*([01]+)$/);
				if (!m) throw new Error(`field "${part.trim()}" should end with its bits, e.g. "flag 0"`);
				return { name: m[1].trim(), bits: m[2] };
			});
		spec.rows.push({ label, fields });
	}
	if (spec.rows.length === 0) throw new Error('no rows, e.g. "Typical tape: flag 0 | index 0100"');
	return spec;
}

/** Full HTML for one bits block, or a visible error box if it's invalid. */
export function renderBitsBlock(source, id) {
	try {
		const spec = parseBitsSpec(source);
		const colorOf = new Map();
		for (const row of spec.rows) {
			for (const f of row.fields) if (!colorOf.has(f.name)) colorOf.set(f.name, (colorOf.size % 4) + 1);
		}
		const rows = spec.rows
			.map((row) => {
				const fields = row.fields
					.map((f) => {
						const cells = [...f.bits].map((b) => `<span class="bits__cell">${b}</span>`).join('');
						const name = f.name ? `<span class="bits__name">${escapeHtml(f.name)}</span>` : '';
						return `<span class="bits__field bits__field--${colorOf.get(f.name)}"><span class="bits__cells">${cells}</span>${name}</span>`;
					})
					.join('');
				const total = row.fields.reduce((n, f) => n + f.bits.length, 0);
				return `<div class="bits__row" role="listitem" aria-label="${escapeHtml(`${row.label}: ${row.fields.map((f) => `${f.name} ${f.bits}`).join(', ')} (${total} bits)`)}"><div class="bits__label">${escapeHtml(row.label)}</div><div class="bits__fields">${fields}</div></div>`;
			})
			.join('');
		const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
		const caption = spec.title ? `<figcaption>${escapeHtml(spec.title)}</figcaption>` : '';
		return { html: `<figure class="bits"${idAttr}><div class="bits__rows" role="list">${rows}</div>${caption}</figure>` };
	} catch (err) {
		return {
			error: err.message,
			html: `<div class="bits bits--error" role="note"><strong>Bits block error:</strong> ${escapeHtml(err.message)}</div>`,
		};
	}
}

export default function remarkBits() {
	return (tree, file) => {
		const visit = (node) => {
			if (!Array.isArray(node.children)) return;
			node.children = node.children.map((child) => {
				if (child.type === 'code' && child.lang === 'bits') {
					const { html, error } = renderBitsBlock(child.value, child.data?.hProperties?.id);
					if (error) {
						const line = child.position?.start?.line;
						console.warn(`[bits] ${file?.path ?? 'note'}${line ? `:${line}` : ''}: ${error}`);
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
