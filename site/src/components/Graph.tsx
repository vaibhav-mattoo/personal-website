// Type-only: fully erased at compile time, so this never pulls the runtime
// module in statically. The actual `force-graph` module is loaded via a
// dynamic import() inside the mount effect below, for two reasons: (1) its
// top-level code touches `window`, which crashes when this component is
// server-rendered for its initial HTML (every `client:*` island still SSRs
// once before hydrating); (2) it keeps force-graph out of any page's
// initial JS graph entirely — only fetched once a Graph actually mounts.
import type ForceGraphCtor from 'force-graph';
import { useEffect, useMemo, useRef, useState } from 'react';
import { neighborhood } from '../lib/links';
import type { GraphData, GraphEdge, GraphNode } from '../lib/graph';

export type { GraphData, GraphEdge, GraphNode };

// force-graph mutates each node with simulation fields (x/y/vx/vy/...) at
// runtime; GraphNode itself stays a clean, JSON-serializable shape (it's
// also what graph.json.ts emits), so this local, render-only alias is where
// those optional extras live.
type SimNode = GraphNode & { x?: number; y?: number; fx?: number; fy?: number };
type FG = ForceGraphCtor<SimNode, GraphEdge>;

export interface GraphProps {
	data: GraphData;
	/** When set, only the neighborhood around this node id is rendered. */
	focusId?: string;
	/** Hop count for the focusId neighborhood. Defaults to 1. */
	depth?: number;
	/**
	 * Case-insensitive title substring to highlight (a ring around matches),
	 * without hiding anything else — used by the global search box.
	 */
	highlightQuery?: string;
	/**
	 * Note ids to highlight in addition to `highlightQuery`'s title match —
	 * how full-text (Pagefind) search results reach the graph, since a body
	 * match often has nothing to do with the title.
	 */
	highlightIds?: readonly string[];
	/**
	 * Fixes every paper node's x by `year` (a year axis along the bottom),
	 * leaving the force simulation to lay out y only. Non-paper nodes and
	 * papers with no year float freely, unpinned.
	 */
	timeline?: boolean;
}

function shapeForKind(kind: string): 'circle' | 'diamond' | 'triangle' | 'pentagon' | 'star' {
	switch (kind) {
		case 'concept':
			return 'diamond';
		case 'experiment':
			return 'triangle';
		case 'review':
			return 'pentagon';
		case 'idea':
			return 'star';
		default:
			return 'circle';
	}
}

function edgeDash(type: string): number[] | null {
	switch (type) {
		case 'link':
			return null; // solid
		case 'extends':
			return [4, 4]; // dashed
		case 'contradicts':
			return [1, 3]; // dotted
		case 'cites':
			return [8, 3, 2, 3]; // long dash-dot — citation lineage
		case 'topic':
			return [2, 5]; // sparse dots — hierarchy/membership, not a note relation
		default:
			return [6, 2]; // plain dash fallback for any other declared relation type
	}
}


function nodeRadius(node: GraphNode): number {
	return Math.min(4 + Math.sqrt(node.degree) * 2.2, 16);
}

/**
 * Topic nodes render as text, not a shape — sized by how deep they are in
 * the tag path (`topics` is that node's own ancestor-or-self chain, so its
 * length *is* the depth: 1 = top-level). Top-level topics read as
 * headings; deeper subtopics recede, the same visual hierarchy a nested
 * list would give you, but laid out by the graph instead.
 */
function topicFontSize(node: GraphNode): number {
	const depth = node.topics.length || 1;
	return Math.max(9, 17 - (depth - 1) * 3);
}

/** Deterministic color per top-level topic — a fixed categorical palette
 * independent of the site's single accent token, since N clusters need N
 * distinguishable colors. Fixed saturation/lightness keeps it legible on
 * both light and dark backgrounds. */
function colorForTopic(topic: string | undefined, fallback: string): string {
	if (!topic) return fallback;
	let hash = 0;
	for (let i = 0; i < topic.length; i++) hash = (hash * 31 + topic.charCodeAt(i)) >>> 0;
	return `hsl(${hash % 360}, 55%, 55%)`;
}

function readThemeColors() {
	const styles = getComputedStyle(document.documentElement);
	const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
	return {
		fg: read('--fg', '#222'),
		muted: read('--muted', '#888'),
		border: read('--border', '#ccc'),
		accent: read('--accent', '#2f71b4'),
		card: read('--card', '#fff'),
		// Canvas's ctx.font is a plain CSS-font-shorthand string, not a real
		// style property — it never resolves var(), so the custom property
		// has to be read to its literal value here and interpolated as text.
		fontFamily: read('--font-display', 'ui-monospace, monospace'),
	};
}

type ThemeColors = ReturnType<typeof readThemeColors>;

function drawShape(
	ctx: CanvasRenderingContext2D,
	shape: ReturnType<typeof shapeForKind>,
	x: number,
	y: number,
	r: number,
) {
	ctx.beginPath();
	switch (shape) {
		case 'diamond':
			ctx.moveTo(x, y - r);
			ctx.lineTo(x + r, y);
			ctx.lineTo(x, y + r);
			ctx.lineTo(x - r, y);
			ctx.closePath();
			break;
		case 'triangle':
			ctx.moveTo(x, y - r);
			ctx.lineTo(x + r * 0.87, y + r * 0.5);
			ctx.lineTo(x - r * 0.87, y + r * 0.5);
			ctx.closePath();
			break;
		case 'pentagon':
			for (let i = 0; i < 5; i++) {
				const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
				const px = x + r * Math.cos(angle);
				const py = y + r * Math.sin(angle);
				if (i === 0) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			}
			ctx.closePath();
			break;
		case 'star':
			for (let i = 0; i < 10; i++) {
				const angle = (Math.PI * i) / 5 - Math.PI / 2;
				const rad = i % 2 === 0 ? r : r * 0.45;
				const px = x + rad * Math.cos(angle);
				const py = y + rad * Math.sin(angle);
				if (i === 0) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			}
			ctx.closePath();
			break;
		case 'circle':
		default:
			ctx.arc(x, y, r, 0, 2 * Math.PI);
			break;
	}
}

export const EDGE_LEGEND_ORDER = ['link', 'extends', 'contradicts', 'cites', 'topic'];

/** Maps a year range to a fixed simulation-space x range for timeline mode. */
function makeYearScale(minYear: number, maxYear: number): (year: number) => number {
	if (minYear === maxYear) return () => 0;
	return (year: number) => ((year - minYear) / (maxYear - minYear)) * 600 - 300;
}

/**
 * Timeline mode: fixes x by year for every node that has one (force-graph
 * respects `fx` regardless of the simulation's other forces, so y stays
 * free). Disabling clears `fx` so the simulation is free to re-lay-out x
 * too. Returns the [min, max] year range for axis drawing, or null.
 */
function pinNodesByYear(nodes: SimNode[], enabled: boolean): [number, number] | null {
	if (!enabled) {
		for (const n of nodes) n.fx = undefined;
		return null;
	}
	const years = nodes.map((n) => n.year).filter((y): y is number => y !== undefined);
	if (years.length === 0) {
		for (const n of nodes) n.fx = undefined;
		return null;
	}
	const minYear = Math.min(...years);
	const maxYear = Math.max(...years);
	const scale = makeYearScale(minYear, maxYear);
	for (const n of nodes) {
		n.fx = n.year !== undefined ? scale(n.year) : undefined;
	}
	return [minYear, maxYear];
}

/**
 * Replaces force-graph's built-in zoomToFit, which only measures node
 * *positions* — topic nodes render as text well outside their tiny point
 * radius, so the built-in fit crops labels no matter how much padding is
 * given. This measures each node's actual drawn extent (text bounds for
 * topics, radius for everything else) and fits the camera to that instead.
 */
function fitToContent(fg: FG, nodes: SimNode[], ms: number) {
	if (nodes.length === 0) return;
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const n of nodes) {
		const x = n.x ?? 0;
		const y = n.y ?? 0;
		let halfW: number;
		let halfH: number;
		if (n.kind === 'topic') {
			const size = topicFontSize(n);
			// Rough monospace glyph-width estimate — avoids needing a canvas
			// context just to measure text here.
			halfW = (n.title.length * size * 0.32) + 8;
			halfH = size / 2 + 6;
		} else {
			halfW = nodeRadius(n) + 8;
			halfH = halfW;
		}
		minX = Math.min(minX, x - halfW);
		maxX = Math.max(maxX, x + halfW);
		minY = Math.min(minY, y - halfH);
		maxY = Math.max(maxY, y + halfH);
	}

	const width = fg.width();
	const height = fg.height();
	const bboxW = Math.max(maxX - minX, 1);
	const bboxH = Math.max(maxY - minY, 1);
	const padding = 24;
	const k = Math.min((width - padding * 2) / bboxW, (height - padding * 2) / bboxH, 6);

	fg.centerAt((minX + maxX) / 2, (minY + maxY) / 2, ms);
	fg.zoom(k, ms);
}

export default function Graph({
	data,
	focusId,
	depth = 1,
	highlightQuery,
	highlightIds,
	timeline = false,
}: GraphProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const fgRef = useRef<FG | null>(null);
	const colorsRef = useRef<ThemeColors>({
		fg: '#222',
		muted: '#888',
		border: '#ccc',
		accent: '#2f71b4',
		card: '#fff',
		fontFamily: 'ui-monospace, monospace',
	});
	const highlightRef = useRef<string | undefined>(highlightQuery?.trim().toLowerCase() || undefined);
	const highlightIdsRef = useRef<Set<string>>(new Set(highlightIds));
	const timelineRef = useRef(timeline);
	const yearRangeRef = useRef<[number, number] | null>(null);
	const zoomedOnceRef = useRef(false);
	const [interacted, setInteracted] = useState(false);

	const graphData = useMemo(() => {
		if (!focusId) return data;
		const edgesWithBroken: Array<GraphEdge & { broken: boolean }> = data.edges.map((e) => ({
			...e,
			broken: false,
		}));
		return neighborhood({ nodes: data.nodes, edges: edgesWithBroken }, focusId, depth);
	}, [data, focusId, depth]);

	const graphDataRef = useRef(graphData);
	useEffect(() => {
		graphDataRef.current = graphData;
		fgRef.current?.graphData({ nodes: graphData.nodes, links: graphData.edges });
		yearRangeRef.current = pinNodesByYear(graphData.nodes, timelineRef.current);
		if (timelineRef.current) fgRef.current?.d3ReheatSimulation();
	}, [graphData]);

	useEffect(() => {
		highlightRef.current = highlightQuery?.trim().toLowerCase() || undefined;
	}, [highlightQuery]);

	useEffect(() => {
		highlightIdsRef.current = new Set(highlightIds);
	}, [highlightIds]);

	useEffect(() => {
		timelineRef.current = timeline;
		yearRangeRef.current = pinNodesByYear(graphDataRef.current.nodes, timeline);
		fgRef.current?.d3ReheatSimulation();
	}, [timeline]);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;

		let disposed = false;
		let fg: FG | null = null;
		let resizeObserver: ResizeObserver | null = null;
		let themeObserver: MutationObserver | null = null;
		let gestureCleanup: (() => void) | null = null;

		import('force-graph').then(({ default: ForceGraph }) => {
			if (disposed) return;

			colorsRef.current = readThemeColors();

			const nodeColor = (node: SimNode) => colorForTopic(node.topics[0], colorsRef.current.muted);
			const isFaded = (node: SimNode) => node.status === 'orphan' || node.status === 'synthesized';
			const isHighlighted = (node: SimNode) =>
				(!!highlightRef.current && node.title.toLowerCase().includes(highlightRef.current)) ||
				highlightIdsRef.current.has(node.id);

			fg = new ForceGraph<SimNode, GraphEdge>(el)
				.backgroundColor('rgba(0,0,0,0)')
				.nodeId('id')
				.nodeRelSize(1)
				.linkSource('source')
				.linkTarget('target')
				.linkWidth(1)
				.linkCurvature(0.15)
				.linkColor(() => colorsRef.current.border)
				.linkLineDash((edge) => edgeDash(edge.type))
				.nodeColor(nodeColor)
				.nodeLabel((node) => {
					const title = node.title.replace(/</g, '&lt;');
					const summary = node.summary
						? `<br/><span style="opacity:.75">${node.summary.replace(/</g, '&lt;')}</span>`
						: '';
					return `<strong>${title}</strong>${summary}`;
				})
				.nodeCanvasObject((node, ctx) => {
					const { x = 0, y = 0 } = node;
					const faded = isFaded(node);
					const highlighted = isHighlighted(node);

					if (node.kind === 'topic') {
						const size = topicFontSize(node);
						ctx.save();
						ctx.globalAlpha = faded ? 0.55 : 1;
						ctx.font = `${faded ? '' : '600 '}${size}px ${colorsRef.current.fontFamily}`;
						ctx.textAlign = 'center';
						ctx.textBaseline = 'middle';
						if (highlighted) {
							ctx.lineWidth = 3;
							ctx.strokeStyle = colorsRef.current.accent;
							ctx.strokeText(node.title, x, y);
						}
						ctx.fillStyle = nodeColor(node);
						ctx.fillText(node.title, x, y);
						ctx.restore();
						return;
					}

					const r = nodeRadius(node);
					ctx.save();
					ctx.globalAlpha = faded ? 0.5 : 1;
					ctx.fillStyle = nodeColor(node);
					ctx.strokeStyle = colorsRef.current.border;
					ctx.lineWidth = 1.25;
					ctx.setLineDash(faded ? [2, 2] : []);
					drawShape(ctx, shapeForKind(node.kind), x, y, r);
					ctx.fill();
					ctx.stroke();
					ctx.restore();

					if (highlighted) {
						ctx.save();
						ctx.strokeStyle = colorsRef.current.accent;
						ctx.lineWidth = 2;
						ctx.setLineDash([]);
						drawShape(ctx, shapeForKind(node.kind), x, y, r + 3);
						ctx.stroke();
						ctx.restore();
					}
				})
				.nodePointerAreaPaint((node, color, ctx) => {
					const { x = 0, y = 0 } = node;
					ctx.fillStyle = color;

					if (node.kind === 'topic') {
						const size = topicFontSize(node);
						ctx.font = `${size}px ${colorsRef.current.fontFamily}`;
						const width = ctx.measureText(node.title).width;
						ctx.fillRect(x - width / 2 - 3, y - size / 2 - 2, width + 6, size + 4);
						return;
					}

					drawShape(ctx, shapeForKind(node.kind), x, y, nodeRadius(node) + 2);
					ctx.fill();
				})
				.onNodeClick((node) => {
					const href = node.kind === 'topic' ? `/notes/topics/${node.id}/` : `/notes/${node.id}/`;
					window.location.href = href;
				})
				.onEngineStop(() => {
					if (zoomedOnceRef.current || !fg) return;
					zoomedOnceRef.current = true;
					fitToContent(fg, graphDataRef.current.nodes, 400);
				})
				.onRenderFramePost((ctx) => {
					if (!timelineRef.current || !yearRangeRef.current || !fg) return;
					const [minYear, maxYear] = yearRangeRef.current;
					const scale = makeYearScale(minYear, maxYear);
					const width = fg.width();
					const height = fg.height();
					const axisY = height - 22;
					const tickCount = Math.min(6, Math.max(1, maxYear - minYear));

					ctx.save();
					ctx.setTransform(1, 0, 0, 1, 0, 0);
					ctx.strokeStyle = colorsRef.current.border;
					ctx.fillStyle = colorsRef.current.muted;
					ctx.font = `11px ${colorsRef.current.fontFamily}`;
					ctx.textAlign = 'center';
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(0, axisY);
					ctx.lineTo(width, axisY);
					ctx.stroke();

					for (let i = 0; i <= tickCount; i++) {
						const year = Math.round(minYear + ((maxYear - minYear) * i) / tickCount);
						const screen = fg.graph2ScreenCoords(scale(year), 0);
						ctx.beginPath();
						ctx.moveTo(screen.x, axisY - 4);
						ctx.lineTo(screen.x, axisY + 4);
						ctx.stroke();
						ctx.fillText(String(year), screen.x, axisY + 16);
					}
					ctx.restore();
				})
				.enableNodeDrag(true)
				// force-graph's default cooldownTime is 15s — with d3AlphaMin at
				// its own default of 0, that's also the only thing that ends the
				// simulation, so onEngineStop (and the initial fit-to-content it
				// triggers) wouldn't fire until then. These graphs are small
				// enough to visually settle in well under a second.
				.cooldownTime(1500);

			// More breathing room than the library defaults: stronger repulsion
			// and longer link distance so clusters separate instead of clumping.
			fg.d3Force('charge')?.strength(-160);
			fg.d3Force('link')?.distance(70);

			fgRef.current = fg;
			fg.graphData({ nodes: graphDataRef.current.nodes, links: graphDataRef.current.edges });
			yearRangeRef.current = pinNodesByYear(graphDataRef.current.nodes, timelineRef.current);

			const resize = () => {
				const rect = el.getBoundingClientRect();
				fg?.width(rect.width).height(rect.height);
			};
			resize();
			resizeObserver = new ResizeObserver(resize);
			resizeObserver.observe(el);

			const refreshTheme = () => {
				colorsRef.current = readThemeColors();
				// Re-assign the same accessors so force-graph re-reads colorsRef and
				// repaints — without this the canvas only redraws on interaction.
				fg?.nodeColor(nodeColor).linkColor(() => colorsRef.current.border);
			};
			themeObserver = new MutationObserver(refreshTheme);
			themeObserver.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['data-mode', 'data-scheme'],
			});

			// Reset-view button visibility: driven by real gestures on the
			// canvas, not force-graph's onZoom (which also fires from the
			// library's own resize/fit calls, with no way to tell those apart
			// from a user's wheel or drag).
			const onWheel = () => setInteracted(true);
			let dragStart: { x: number; y: number } | null = null;
			const onPointerDown = (e: PointerEvent) => {
				dragStart = { x: e.clientX, y: e.clientY };
			};
			const onPointerMove = (e: PointerEvent) => {
				if (!dragStart) return;
				const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
				if (moved > 5) {
					setInteracted(true);
					dragStart = null;
				}
			};
			const onPointerUp = () => {
				dragStart = null;
			};
			// Capture phase: force-graph's own d3-zoom wheel handler on the
			// canvas calls stopPropagation(), so a bubble-phase listener here
			// would never see it.
			el.addEventListener('wheel', onWheel, { passive: true, capture: true });
			el.addEventListener('pointerdown', onPointerDown);
			el.addEventListener('pointermove', onPointerMove);
			el.addEventListener('pointerup', onPointerUp);
			el.addEventListener('pointerleave', onPointerUp);

			gestureCleanup = () => {
				el.removeEventListener('wheel', onWheel, { capture: true });
				el.removeEventListener('pointerdown', onPointerDown);
				el.removeEventListener('pointermove', onPointerMove);
				el.removeEventListener('pointerup', onPointerUp);
				el.removeEventListener('pointerleave', onPointerUp);
			};
		});

		return () => {
			disposed = true;
			resizeObserver?.disconnect();
			themeObserver?.disconnect();
			gestureCleanup?.();
			fg?._destructor();
			fgRef.current = null;
		};
		// Intentionally mount-only: graphData/highlight updates are handled by
		// the effects above/below via the existing instance, so the simulation
		// and zoom/pan state aren't reset on every prop change.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// highlightQuery/highlightIds changes don't need a graphData reassignment —
	// the canvas render callback reads the refs live — but force a repaint
	// since the simulation may already be cooled down.
	useEffect(() => {
		const fg = fgRef.current;
		if (!fg) return;
		fg.nodeColor(fg.nodeColor());
	}, [highlightQuery, highlightIds]);

	function handleReset() {
		const fg = fgRef.current;
		if (!fg) return;
		fitToContent(fg, graphDataRef.current.nodes, 400);
		setInteracted(false);
	}

	return (
		<div style={{ position: 'relative' }}>
			<div ref={containerRef} className="graph-canvas" />
			{interacted && (
				<button type="button" className="graph-reset-btn" onClick={handleReset}>
					Reset view
				</button>
			)}
		</div>
	);
}
