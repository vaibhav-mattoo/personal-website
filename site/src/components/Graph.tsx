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
import { layoutGraph, type LayoutBox } from '../lib/graphLayout';
import { evenlySpacedHues, hexToOklchHue, subtopicOklch, topicOklch } from '../lib/color';

export type { GraphData, GraphEdge, GraphNode };

// force-graph mutates each node with simulation fields (x/y/vx/vy/...) at
// runtime; GraphNode itself stays a clean, JSON-serializable shape (it's
// also what graph.json.ts emits), so this local, render-only alias is where
// those optional extras live.
type SimNode = GraphNode & { x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number };
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
	 * Fixes every note node's x by its `date`, leaving a live simulation to
	 * lay out y only. Topic nodes (no `date`) float freely, unpinned. The
	 * only mode that still runs a live d3-force simulation — see the
	 * default layout below, which is fully precomputed and pinned instead.
	 */
	timeline?: boolean;
}

const MOBILE_BREAKPOINT = 720;

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
 * length *is* the depth: 1 = top-level) and, secondarily, by how many
 * notes it has — log-scaled and capped so a heavily-populated topic
 * doesn't dwarf everything and an empty one stays legible.
 */
function topicFontSize(node: GraphNode): number {
	const depth = node.topics.length || 1;
	const base = Math.max(14, Math.round(64 * 0.5 ** (depth - 1)));
	const noteCount = node.noteCount ?? 0;
	const countFactor = Math.min(1.35, 1 + Math.log2(noteCount + 1) * 0.08);
	return Math.round(base * countFactor);
}

/**
 * Per-top-level-topic OKLCH hue, evenly spaced around the wheel starting
 * at the site's own current --accent hue (read at call time, so it tracks
 * the active scheme/mode) — reconciles the graph's categorical palette
 * with the site's actual theme instead of an unrelated fixed hue set.
 */
function computeHueMap(nodes: GraphNode[], accentHex: string): Map<string, number> {
	const topLevelIds = [...new Set(nodes.filter((n) => n.kind === 'topic' && n.topics.length === 1).map((n) => n.id))].sort();
	const baseHue = hexToOklchHue(accentHex);
	const hues = evenlySpacedHues(baseHue, topLevelIds.length);
	return new Map(topLevelIds.map((id, i) => [id, hues[i]]));
}

function colorForNode(node: GraphNode, hueMap: Map<string, number>, fallback: string): string {
	const rootId = node.topics[0];
	if (!rootId) return fallback;
	const hue = hueMap.get(rootId);
	if (hue === undefined) return fallback;
	if (node.kind === 'topic' && node.topics.length > 1) return subtopicOklch(hue, node.topics.length - 1);
	return topicOklch(hue);
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

/** Maps a [minTime, maxTime] epoch-ms range to a fixed simulation-space x range for timeline mode. */
function makeTimeScale(minTime: number, maxTime: number): (time: number) => number {
	if (minTime === maxTime) return () => 0;
	return (time: number) => ((time - minTime) / (maxTime - minTime)) * 600 - 300;
}

function parseNodeTime(node: SimNode): number | undefined {
	if (!node.date) return undefined;
	const t = Date.parse(node.date);
	return Number.isNaN(t) ? undefined : t;
}

function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Timeline mode: fixes x by date for every node that has one, leaving y to
 * a live d3-force simulation (the only place one still runs — see
 * applyDefaultLayout for the normal, precomputed/pinned case). Disabling
 * clears fx so a re-layout can take over.
 */
function pinNodesByDate(nodes: SimNode[], enabled: boolean): void {
	if (!enabled) {
		for (const n of nodes) {
			n.fx = undefined;
			n.fy = undefined;
		}
		return;
	}
	const times = nodes.map(parseNodeTime).filter((t): t is number => t !== undefined);
	if (times.length === 0) {
		for (const n of nodes) n.fx = undefined;
		return;
	}
	const minTime = Math.min(...times);
	const maxTime = Math.max(...times);
	const scale = makeTimeScale(minTime, maxTime);
	for (const n of nodes) {
		const t = parseNodeTime(n);
		n.fx = t !== undefined ? scale(t) : undefined;
		n.fy = undefined;
	}
}

type HalfExtent = { halfW: number; halfH: number };

/** Each node's drawn half-width/half-height — used both to seed the initial
 *  layout and to drive the live rectangle-collision force below. */
function measureHalfExtents(nodes: SimNode[], fontFamily: string): Map<string, HalfExtent> {
	const measureCtx = document.createElement('canvas').getContext('2d');
	const extents = new Map<string, HalfExtent>();
	for (const n of nodes) {
		let halfW: number;
		let halfH: number;
		if (n.kind === 'topic') {
			const size = topicFontSize(n);
			if (measureCtx) {
				measureCtx.font = `600 ${size}px ${fontFamily}`;
				halfW = measureCtx.measureText(n.title).width / 2 + 4;
			} else {
				halfW = (n.title.length * size * 0.32) + 8;
			}
			halfH = size / 2 + 4;
		} else {
			halfW = nodeRadius(n) + 6;
			halfH = halfW;
		}
		extents.set(n.id, { halfW, halfH });
	}
	return extents;
}

/**
 * Seeds each node's *starting* x/y (not fixed — d3-force is free to move
 * them from here) from the deterministic rectangle-collision layout in
 * lib/graphLayout.ts, so the live simulation below starts from an
 * already-reasonable, non-overlapping arrangement instead of a random
 * scatter. The live simulation (charge + link + the rectCollide force
 * registered at construction time) is what actually keeps things apart
 * as it settles and as nodes get dragged — this is just a better starting
 * point, not a permanent pin. Any label pairs still overlapping in this
 * *seed* are logged, not thrown (the live rectCollide force cleans up any
 * that remain once the simulation runs).
 */
function seedInitialLayout(nodes: SimNode[], extents: Map<string, HalfExtent>): void {
	const byId = new Map(nodes.map((n) => [n.id, n]));

	const boxes: LayoutBox[] = nodes.map((n) => {
		const extent = extents.get(n.id)!;
		let pullTarget: string | undefined;
		if (n.kind === 'topic') {
			pullTarget = n.parent;
		} else if (n.topics[0] && byId.has(n.topics[0])) {
			pullTarget = n.topics[0];
		}
		return { id: n.id, halfW: extent.halfW, halfH: extent.halfH, pullTarget };
	});

	const { positions, remainingOverlaps } = layoutGraph(boxes);
	for (const n of nodes) {
		const p = positions.get(n.id);
		if (!p) continue;
		n.x = p.x;
		n.y = p.y;
		n.fx = undefined;
		n.fy = undefined;
	}

	if (remainingOverlaps.length > 0) {
		// eslint-disable-next-line no-console
		console.warn(
			`[graph layout] ${remainingOverlaps.length} label pair(s) still overlap in the seed layout (the live simulation should resolve these):`,
			remainingOverlaps,
		);
	}
}

/**
 * A d3-force-compatible custom force: every tick, nudges apart any pair of
 * nodes whose *drawn* extents (from `extentsRef`, kept live so it reflects
 * font-size/theme changes) overlap by more than 6px of padding — real
 * rectangle collision, not d3's circle-based forceCollide, which is what
 * let labels overlap in the first place. Runs continuously alongside the
 * normal charge/link forces, so it keeps working while the simulation is
 * live and while a node is being dragged, not just once at layout time.
 */
function rectCollideForce(extentsRef: { current: Map<string, HalfExtent> }) {
	const PADDING = 6;
	let nodes: SimNode[] = [];
	function force(alpha: number) {
		const extents = extentsRef.current;
		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i];
			const ea = extents.get(a.id);
			if (!ea) continue;
			const ax = a.x ?? 0;
			const ay = a.y ?? 0;
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j];
				const eb = extents.get(b.id);
				if (!eb) continue;
				const bx = b.x ?? 0;
				const by = b.y ?? 0;
				const dx = bx - ax;
				const dy = by - ay;
				const overlapX = ea.halfW + eb.halfW + PADDING * 2 - Math.abs(dx);
				const overlapY = ea.halfH + eb.halfH + PADDING * 2 - Math.abs(dy);
				if (overlapX <= 0 || overlapY <= 0) continue;

				const strength = alpha * 0.6;
				if (overlapX < overlapY) {
					const push = overlapX * strength * (dx >= 0 ? 1 : -1);
					if (a.fx === undefined) a.vx = (a.vx ?? 0) - push;
					if (b.fx === undefined) b.vx = (b.vx ?? 0) + push;
				} else {
					const push = overlapY * strength * (dy >= 0 ? 1 : -1);
					if (a.fy === undefined) a.vy = (a.vy ?? 0) - push;
					if (b.fy === undefined) b.vy = (b.vy ?? 0) + push;
				}
			}
		}
	}
	force.initialize = (ns: SimNode[]) => {
		nodes = ns;
	};
	return force;
}

type RadialTarget = { x: number; y: number };

/**
 * Evenly spaces the top-level topics around a circle — left purely to
 * charge/link forces, a well-connected topic (lots of children/notes
 * pulling it inward via the link force) clumps together with its equally
 * well-connected neighbors, while a sparse one (few or no children) has
 * nothing holding it in place and drifts wherever repulsion happens to
 * push it, sometimes far off on its own. Order is alphabetical by id, so
 * which topic lands at which angle is at least stable across reloads.
 */
function computeRadialTargets(nodes: GraphNode[]): Map<string, RadialTarget> {
	const topLevel = [...new Set(nodes.filter((n) => n.kind === 'topic' && n.topics.length === 1).map((n) => n.id))].sort();
	const targets = new Map<string, RadialTarget>();
	if (topLevel.length === 0) return targets;
	// Scales with count so more topics don't get any more cramped than fewer.
	const radius = Math.max(260, topLevel.length * 55);
	topLevel.forEach((id, i) => {
		const angle = (2 * Math.PI * i) / topLevel.length - Math.PI / 2;
		targets.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
	});
	return targets;
}

/**
 * A d3-force-compatible custom force: gently nudges each top-level topic
 * toward its evenly-spaced target position (see computeRadialTargets).
 * Deliberately weak relative to charge/link/rectCollide — it's a mild
 * organizing pull, not a pin, so the graph still looks like an organic
 * simulation rather than nodes snapping to a circle. Subtopics and notes
 * have no target here and are left entirely to the other forces, which is
 * what lets them cluster naturally around their own parent topic.
 */
function radialSpreadForce(targetsRef: { current: Map<string, RadialTarget> }) {
	const STRENGTH = 0.12;
	let nodes: SimNode[] = [];
	function force(alpha: number) {
		const targets = targetsRef.current;
		for (const n of nodes) {
			const target = targets.get(n.id);
			if (!target || n.fx !== undefined) continue;
			const x = n.x ?? 0;
			const y = n.y ?? 0;
			n.vx = (n.vx ?? 0) + (target.x - x) * alpha * STRENGTH;
			n.vy = (n.vy ?? 0) + (target.y - y) * alpha * STRENGTH;
		}
	}
	force.initialize = (ns: SimNode[]) => {
		nodes = ns;
	};
	return force;
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

	const animMs = prefersReducedMotion() ? 0 : ms;
	fg.centerAt((minX + maxX) / 2, (minY + maxY) / 2, animMs);
	fg.zoom(k, animMs);
}

/** Every node whose `topics` chain includes `topicId` (itself included). */
function subtreeOf(nodes: GraphNode[], topicId: string): Set<string> {
	const set = new Set<string>();
	for (const n of nodes) {
		if (n.id === topicId || n.topics.includes(topicId)) set.add(n.id);
	}
	return set;
}

/** A node's direct neighbors via edges, plus itself. */
function neighborsOf(edges: GraphEdge[], id: string): Set<string> {
	const set = new Set<string>([id]);
	for (const e of edges) {
		if (e.source === id) set.add(e.target);
		if (e.target === id) set.add(e.source);
	}
	return set;
}

/**
 * Keyboard/screen-reader alternative to the canvas: canvas nodes have no
 * native DOM focus, so this real, tab-reachable (but visually hidden) link
 * list is the actual accessible path — clicking a node and tabbing to its
 * equivalent link both end up at the same URL. Ordered topics-by-depth
 * first (a sensible approximation of the tree, without needing to rebuild
 * it here), then notes alphabetically.
 */
function AccessibleNodeList({ data }: { data: GraphData }) {
	const items = useMemo(() => {
		const topics = data.nodes
			.filter((n) => n.kind === 'topic')
			.sort((a, b) => a.topics.length - b.topics.length || a.title.localeCompare(b.title));
		const notes = data.nodes.filter((n) => n.kind !== 'topic').sort((a, b) => a.title.localeCompare(b.title));
		return [...topics, ...notes];
	}, [data]);

	return (
		<ul className="graph-a11y-list">
			{items.map((n) => (
				<li key={n.id}>
					<a href={n.kind === 'topic' ? `/notes/topics/${n.id}/` : `/notes/${n.id}/`}>
						{n.title}
						{n.kind === 'topic' && ` — ${n.noteCount ?? 0} note${n.noteCount === 1 ? '' : 's'}`}
					</a>
				</li>
			))}
		</ul>
	);
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
	const hueMapRef = useRef<Map<string, number>>(new Map());
	const extentsRef = useRef<Map<string, HalfExtent>>(new Map());
	const radialTargetsRef = useRef<Map<string, RadialTarget>>(new Map());
	const highlightRef = useRef<string | undefined>(highlightQuery?.trim().toLowerCase() || undefined);
	const highlightIdsRef = useRef<Set<string>>(new Set(highlightIds));
	const hoveredTopicRef = useRef<string | null>(null);
	const timelineRef = useRef(timeline);
	const zoomedOnceRef = useRef(false);
	const [interacted, setInteracted] = useState(false);
	const [isMobile, setIsMobile] = useState(false);

	useEffect(() => {
		const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
		setIsMobile(mq.matches);
		const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, []);

	// Below the mobile breakpoint, 45+ labels crammed into ~360px is just
	// noise — collapse to top-level topics only (no notes, no subtopics),
	// laid out the same way but with far fewer, larger, tap-friendly labels.
	const baseData = useMemo(() => {
		if (!isMobile) return data;
		const topLevel = data.nodes.filter((n) => n.kind === 'topic' && n.topics.length === 1);
		const ids = new Set(topLevel.map((n) => n.id));
		return { nodes: topLevel, edges: data.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
	}, [data, isMobile]);

	const graphData = useMemo(() => {
		if (!focusId) return baseData;
		const edgesWithBroken: Array<GraphEdge & { broken: boolean }> = baseData.edges.map((e) => ({
			...e,
			broken: false,
		}));
		return neighborhood({ nodes: baseData.nodes, edges: edgesWithBroken }, focusId, depth);
	}, [baseData, focusId, depth]);

	const graphDataRef = useRef(graphData);

	function relayout(fg: FG | null) {
		if (!fg) return;
		hueMapRef.current = computeHueMap(graphDataRef.current.nodes, colorsRef.current.accent);
		extentsRef.current = measureHalfExtents(graphDataRef.current.nodes, colorsRef.current.fontFamily);
		radialTargetsRef.current = computeRadialTargets(graphDataRef.current.nodes);
		if (timelineRef.current) {
			pinNodesByDate(graphDataRef.current.nodes, true);
		} else {
			seedInitialLayout(graphDataRef.current.nodes, extentsRef.current);
		}
		// Both modes run a real, live simulation now (charge + link, plus the
		// always-registered rectCollide force) — an open, organic layout that
		// keeps dragging one node pulling its connected neighbors along,
		// rather than every position being permanently pinned.
		fg.cooldownTime(prefersReducedMotion() ? 0 : 1500);
		fg.d3ReheatSimulation();
		zoomedOnceRef.current = false;
	}

	useEffect(() => {
		graphDataRef.current = graphData;
		fgRef.current?.graphData({ nodes: graphData.nodes, links: graphData.edges });
		relayout(fgRef.current);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [graphData]);

	useEffect(() => {
		highlightRef.current = highlightQuery?.trim().toLowerCase() || undefined;
	}, [highlightQuery]);

	useEffect(() => {
		highlightIdsRef.current = new Set(highlightIds);
	}, [highlightIds]);

	useEffect(() => {
		timelineRef.current = timeline;
		relayout(fgRef.current);
		// eslint-disable-next-line react-hooks/exhaustive-deps
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
			hueMapRef.current = computeHueMap(graphDataRef.current.nodes, colorsRef.current.accent);

			const nodeColor = (node: SimNode) => colorForNode(node, hueMapRef.current, colorsRef.current.muted);
			const isFaded = (node: SimNode) => node.status === 'orphan' || node.status === 'synthesized';
			const isHighlighted = (node: SimNode) =>
				(!!highlightRef.current && node.title.toLowerCase().includes(highlightRef.current)) ||
				highlightIdsRef.current.has(node.id);
			// Hover-dim: when a topic is hovered, everything outside its
			// subtree dims to ~25%; hovering a note dims everything outside
			// its direct connections. No hover active -> normal fade rules.
			const dimAlpha = (node: SimNode): number | null => {
				const hovered = hoveredTopicRef.current;
				if (!hovered) return null;
				const hoveredNode = graphDataRef.current.nodes.find((n) => n.id === hovered);
				if (!hoveredNode) return null;
				const activeSet =
					hoveredNode.kind === 'topic'
						? subtreeOf(graphDataRef.current.nodes, hovered)
						: neighborsOf(graphDataRef.current.edges, hovered);
				return activeSet.has(node.id) ? null : 0.25;
			};

			fg = new ForceGraph<SimNode, GraphEdge>(el)
				.backgroundColor('rgba(0,0,0,0)')
				.nodeId('id')
				.nodeRelSize(1)
				.linkSource('source')
				.linkTarget('target')
				.linkWidth(1)
				.linkCurvature(0.15)
				.linkColor((edge) => {
					const hovered = hoveredTopicRef.current;
					if (!hovered) return colorsRef.current.border;
					const hoveredNode = graphDataRef.current.nodes.find((n) => n.id === hovered);
					if (!hoveredNode) return colorsRef.current.border;
					const activeSet =
						hoveredNode.kind === 'topic'
							? subtreeOf(graphDataRef.current.nodes, hovered)
							: neighborsOf(graphDataRef.current.edges, hovered);
					const s = typeof edge.source === 'string' ? edge.source : (edge.source as SimNode).id;
					const t = typeof edge.target === 'string' ? edge.target : (edge.target as SimNode).id;
					const active = activeSet.has(s) && activeSet.has(t);
					return active
						? colorsRef.current.border
						: `color-mix(in srgb, ${colorsRef.current.border} 25%, transparent)`;
				})
				.linkLineDash((edge) => edgeDash(edge.type))
				.nodeColor(nodeColor)
				.nodeLabel((node) => {
					const title = node.title.replace(/</g, '&lt;');
					const summary = node.summary
						? `<br/><span style="opacity:.75">${node.summary.replace(/</g, '&lt;')}</span>`
						: '';
					return `<strong>${title}</strong>${summary}`;
				})
				.onNodeHover((node) => {
					const next = node ? node.id : null;
					if (hoveredTopicRef.current !== next) {
						hoveredTopicRef.current = next;
						fg?.nodeColor(fg.nodeColor());
					}
				})
				.nodeCanvasObject((node, ctx) => {
					const { x = 0, y = 0 } = node;
					const faded = isFaded(node);
					const highlighted = isHighlighted(node);
					const dim = dimAlpha(node);

					if (node.kind === 'topic') {
						const size = topicFontSize(node);
						ctx.save();
						ctx.globalAlpha = dim ?? (faded ? 0.55 : 1);
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
					ctx.globalAlpha = dim ?? (faded ? 0.5 : 1);
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
				.enableNodeDrag(true)
				// A real, live simulation (not a one-shot layout) — this is what
				// makes dragging one node pull its connected neighbors along, and
				// what gives the graph its open, organic feel instead of a rigid
				// precomputed grid. cooldownTime is set dynamically in relayout()
				// (0 under prefers-reduced-motion).
				.cooldownTime(1500);

			// More breathing room than the library defaults: stronger repulsion
			// and longer link distance so clusters separate instead of clumping.
			fg.d3Force('charge')?.strength(-160);
			fg.d3Force('link')?.distance(70);
			// Real rectangle collision (labels' actual drawn extents), not
			// d3-force's default circle-based forceCollide — registered once,
			// reads live extents/positions off the refs every tick, so it keeps
			// working through settling, hover, and drag alike.
			fg.d3Force('rectCollide', rectCollideForce(extentsRef));
			// Keeps top-level topics evenly spread instead of well-connected
			// ones clumping together and sparse ones drifting off alone.
			fg.d3Force('radialSpread', radialSpreadForce(radialTargetsRef));

			fgRef.current = fg;
			fg.graphData({ nodes: graphDataRef.current.nodes, links: graphDataRef.current.edges });
			relayout(fg);

			const resize = () => {
				const rect = el.getBoundingClientRect();
				fg?.width(rect.width).height(rect.height);
			};
			resize();
			resizeObserver = new ResizeObserver(resize);
			resizeObserver.observe(el);

			const refreshTheme = () => {
				colorsRef.current = readThemeColors();
				hueMapRef.current = computeHueMap(graphDataRef.current.nodes, colorsRef.current.accent);
				// Re-assign the same accessors so force-graph re-reads colorsRef and
				// repaints — without this the canvas only redraws on interaction.
				fg?.nodeColor(nodeColor).linkColor(fg.linkColor());
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
			<div
				ref={containerRef}
				className="graph-canvas"
				role="img"
				aria-label="Visual graph of notes and topics and how they link — the same notes and topics are also reachable as regular text links elsewhere on this page."
			/>
			{interacted && (
				<button type="button" className="graph-reset-btn" onClick={handleReset}>
					Reset view
				</button>
			)}
			<AccessibleNodeList data={graphData} />
		</div>
	);
}
