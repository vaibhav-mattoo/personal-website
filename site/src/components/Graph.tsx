// Type-only: fully erased at compile time, so this never pulls the runtime
// module in statically. The actual `force-graph` module is loaded via a
// dynamic import() inside the mount effect below, for two reasons: (1) its
// top-level code touches `window`, which crashes when this component is
// server-rendered for its initial HTML (every `client:*` island still SSRs
// once before hydrating); (2) it keeps force-graph out of any page's
// initial JS graph entirely — only fetched once a Graph actually mounts.
import type ForceGraphCtor from 'force-graph';
import { useEffect, useMemo, useRef } from 'react';
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
	 * Fixes every paper node's x by `year` (a year axis along the bottom),
	 * leaving the force simulation to lay out y only. Non-paper nodes and
	 * papers with no year float freely, unpinned.
	 */
	timeline?: boolean;
}

function shapeForKind(kind: string): 'circle' | 'square' | 'diamond' | 'triangle' | 'pentagon' | 'star' {
	switch (kind) {
		case 'topic':
			return 'square';
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

/** to-read palest, read fully opaque — everything else stays fully opaque
 * (orphan/synthesized fading is a separate, lower-priority effect below). */
function opacityForReadingStatus(status: string | undefined): number {
	switch (status) {
		case 'to-read':
			return 0.3;
		case 'skimmed':
			return 0.55;
		case 'reading':
			return 0.75;
		case 'read':
		default:
			return 1;
	}
}

function nodeRadius(node: GraphNode): number {
	const base = node.kind === 'topic' ? 6 : 4;
	return Math.min(base + Math.sqrt(node.degree) * 2.2, 16);
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
		case 'square':
			ctx.rect(x - r, y - r, r * 2, r * 2);
			break;
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

export default function Graph({ data, focusId, depth = 1, highlightQuery, timeline = false }: GraphProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const fgRef = useRef<FG | null>(null);
	const colorsRef = useRef<ThemeColors>({ fg: '#222', muted: '#888', border: '#ccc', accent: '#2f71b4' });
	const highlightRef = useRef<string | undefined>(highlightQuery?.trim().toLowerCase() || undefined);
	const timelineRef = useRef(timeline);
	const yearRangeRef = useRef<[number, number] | null>(null);

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

		import('force-graph').then(({ default: ForceGraph }) => {
			if (disposed) return;

			colorsRef.current = readThemeColors();

			const nodeColor = (node: SimNode) => colorForTopic(node.topics[0], colorsRef.current.muted);
			const isFaded = (node: SimNode) => node.status === 'orphan' || node.status === 'synthesized';
			const isHighlighted = (node: SimNode) =>
				!!highlightRef.current && node.title.toLowerCase().includes(highlightRef.current);

			fg = new ForceGraph<SimNode, GraphEdge>(el)
				.backgroundColor('rgba(0,0,0,0)')
				.nodeId('id')
				.nodeRelSize(1)
				.linkSource('source')
				.linkTarget('target')
				.linkWidth(1)
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
					const r = nodeRadius(node);
					const faded = isFaded(node);
					const opacity = node.kind === 'paper' ? opacityForReadingStatus(node.readingStatus) : faded ? 0.5 : 1;

					ctx.save();
					ctx.globalAlpha = opacity;
					ctx.fillStyle = nodeColor(node);
					ctx.strokeStyle = colorsRef.current.border;
					ctx.lineWidth = 1.25;
					ctx.setLineDash(faded && node.kind !== 'paper' ? [2, 2] : []);
					drawShape(ctx, shapeForKind(node.kind), x, y, r);
					ctx.fill();
					ctx.stroke();
					ctx.restore();

					if (isHighlighted(node)) {
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
					drawShape(ctx, shapeForKind(node.kind), x, y, nodeRadius(node) + 2);
					ctx.fill();
				})
				.onNodeClick((node) => {
					const href = node.kind === 'topic' ? `/notes/tags/${node.id}/` : `/notes/${node.id}/`;
					window.location.href = href;
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
					ctx.font = '11px var(--font-display, monospace)';
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
				.enableNodeDrag(true);

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
		});

		return () => {
			disposed = true;
			resizeObserver?.disconnect();
			themeObserver?.disconnect();
			fg?._destructor();
			fgRef.current = null;
		};
		// Intentionally mount-only: graphData/highlight updates are handled by
		// the effects above/below via the existing instance, so the simulation
		// and zoom/pan state aren't reset on every prop change.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// highlightQuery changes don't need a graphData reassignment — the canvas
	// render callback reads highlightRef live — but force a repaint since the
	// simulation may already be cooled down.
	useEffect(() => {
		const fg = fgRef.current;
		if (!fg) return;
		fg.nodeColor(fg.nodeColor());
	}, [highlightQuery]);

	return <div ref={containerRef} className="graph-canvas" />;
}
