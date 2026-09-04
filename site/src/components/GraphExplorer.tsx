import { useEffect, useMemo, useRef, useState } from 'react';
import Graph, { EDGE_LEGEND_ORDER, type GraphData } from './Graph';

export interface GraphExplorerProps {
	data: GraphData;
}

const EDGE_LEGEND_LABEL: Record<string, string> = {
	link: 'Link',
	extends: 'Extends',
	contradicts: 'Contradicts',
	cites: 'Cites',
	topic: 'Topic',
};

const EDGE_LEGEND_DASH: Record<string, string> = {
	link: 'none',
	extends: '4,4',
	contradicts: '1,3',
	cites: '8,3,2,3',
	topic: '2,5',
};

function legendEntryFor(type: string) {
	return {
		label: EDGE_LEGEND_LABEL[type] ?? type,
		dash: EDGE_LEGEND_DASH[type] ?? '6,2',
	};
}

// Pagefind only indexes pages carrying data-pagefind-body, which is just
// the note detail template (see pages/notes/[...slug].astro) — so every
// result url is a plain /notes/<id>/ and the id is the note id everywhere
// else in this codebase.
function urlToNoteId(url: string): string | null {
	const path = url.split('?')[0].split('#')[0];
	const match = path.match(/^\/notes\/(.+?)\/?$/);
	return match ? decodeURIComponent(match[1]) : null;
}

interface PagefindResultData {
	url: string;
	excerpt: string;
	meta?: { title?: string };
}

interface PagefindApi {
	init: () => Promise<void>;
	search: (query: string) => Promise<{ results: Array<{ data: () => Promise<PagefindResultData> }> }>;
}

interface PagefindHit {
	id: string;
	url: string;
	title: string;
	excerpt: string;
}

export default function GraphExplorer({ data }: GraphExplorerProps) {
	const [query, setQuery] = useState('');
	const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
	const [timelineOverride, setTimelineOverride] = useState<boolean | null>(null);
	const [pagefindReady, setPagefindReady] = useState(false);
	const [pagefindUnavailable, setPagefindUnavailable] = useState(false);
	const [hits, setHits] = useState<PagefindHit[]>([]);
	const pagefindRef = useRef<PagefindApi | null>(null);

	// The Pagefind runtime is a JS module emitted into dist/pagefind/ by the
	// build step (see astro.config.mjs) — it doesn't exist in dev and isn't
	// part of the Vite build graph, so it's a runtime URL import, not a
	// normal one, and is expected to 404 locally until `npm run build`.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				// A non-literal specifier keeps TS from trying (and failing) to
				// resolve this as a real module — it only exists post-build.
				const pagefindPath = '/pagefind/pagefind.js';
				const mod = (await import(/* @vite-ignore */ pagefindPath)) as PagefindApi;
				await mod.init();
				if (cancelled) return;
				pagefindRef.current = mod;
				setPagefindReady(true);
			} catch {
				if (!cancelled) setPagefindUnavailable(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// Debounced full-text search: title-substring highlighting (below) is
	// instant and needs no index, but a body-text match has to go through
	// Pagefind, so it lags slightly behind typing.
	useEffect(() => {
		const trimmed = query.trim();
		const pagefind = pagefindRef.current;
		if (!trimmed || !pagefind) {
			setHits([]);
			return;
		}
		let cancelled = false;
		const timer = setTimeout(async () => {
			const search = await pagefind.search(trimmed);
			const results = await Promise.all(search.results.slice(0, 6).map((r) => r.data()));
			if (cancelled) return;
			const mapped = results
				.map((r): PagefindHit | null => {
					const id = urlToNoteId(r.url);
					return id ? { id, url: r.url, title: r.meta?.title ?? id, excerpt: r.excerpt } : null;
				})
				.filter((r): r is PagefindHit => r !== null);
			setHits(mapped);
		}, 200);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [query, pagefindReady]);

	const highlightIds = useMemo(() => hits.map((h) => h.id), [hits]);

	// Timeline defaults on when exactly one topic is active and it's a
	// paper-thread — otherwise off, unless the user has explicitly toggled it.
	const activeTopicKind = useMemo(() => {
		if (selectedTopics.size !== 1) return undefined;
		const [id] = selectedTopics;
		return data.nodes.find((n) => n.id === id)?.topicKind;
	}, [data, selectedTopics]);
	const timeline = timelineOverride ?? activeTopicKind === 'paper-thread';

	const topLevelTopics = useMemo(() => {
		const ids = new Set<string>();
		for (const node of data.nodes) {
			if (node.kind === 'topic' && node.topics.length === 1) ids.add(node.id);
		}
		return [...ids].sort();
	}, [data]);

	const edgeTypesPresent = useMemo(() => {
		const types = new Set(data.edges.map((e) => e.type));
		const ordered = EDGE_LEGEND_ORDER.filter((t) => types.has(t));
		const extra = [...types].filter((t) => !EDGE_LEGEND_ORDER.includes(t)).sort();
		return [...ordered, ...extra];
	}, [data]);

	const filtered = useMemo(() => {
		if (selectedTopics.size === 0) return data;
		const keepIds = new Set(
			data.nodes.filter((n) => n.topics.some((t) => selectedTopics.has(t))).map((n) => n.id),
		);
		return {
			nodes: data.nodes.filter((n) => keepIds.has(n.id)),
			edges: data.edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target)),
		};
	}, [data, selectedTopics]);

	function toggleTopic(id: string) {
		setTimelineOverride(null);
		setSelectedTopics((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	const searching = query.trim().length > 0;

	return (
		<div className="graph-explorer">
			<div className="graph-explorer__controls">
				<input
					type="search"
					className="graph-explorer__search"
					placeholder="Search notes…"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					aria-label="Search notes by title or full text"
				/>
				<div className="graph-explorer__chips" role="group" aria-label="Filter by topic">
					{topLevelTopics.map((id) => (
						<button
							key={id}
							type="button"
							className="graph-explorer__chip"
							data-active={selectedTopics.has(id)}
							onClick={() => toggleTopic(id)}
						>
							{data.nodes.find((n) => n.id === id)?.title ?? id}
						</button>
					))}
					{selectedTopics.size > 0 && (
						<button
							type="button"
							className="graph-explorer__chip graph-explorer__chip--clear"
							onClick={() => {
								setTimelineOverride(null);
								setSelectedTopics(new Set());
							}}
						>
							Clear
						</button>
					)}
				</div>
				<button
					type="button"
					className="graph-explorer__chip graph-explorer__timeline"
					data-active={timeline}
					onClick={() => setTimelineOverride(!timeline)}
					aria-pressed={timeline}
				>
					Timeline
				</button>
			</div>

			{searching && hits.length > 0 && (
				<ul className="graph-explorer__results">
					{hits.map((hit) => (
						<li key={hit.id}>
							<a href={hit.url} className="graph-explorer__result">
								<span className="graph-explorer__result-title">{hit.title}</span>
								<span
									className="graph-explorer__result-excerpt"
									// Pagefind returns the excerpt as HTML with the matched
									// terms already wrapped in <mark> — that's the whole
									// point of asking it for one.
									dangerouslySetInnerHTML={{ __html: hit.excerpt }}
								/>
							</a>
						</li>
					))}
				</ul>
			)}

			{searching && pagefindUnavailable && (
				<p className="graph-explorer__results-hint">
					Full-text results need a production build — run <code>npm run build</code>. Titles still highlight
					below.
				</p>
			)}

			<Graph data={filtered} highlightQuery={query} highlightIds={highlightIds} timeline={timeline} />

			<div className="graph-explorer__legend" aria-label="Edge style legend">
				{edgeTypesPresent.map((type) => {
					const { label, dash } = legendEntryFor(type);
					return (
						<span className="graph-explorer__legend-item" key={type}>
							<svg width="24" height="8" aria-hidden="true">
								<line x1="0" y1="4" x2="24" y2="4" strokeDasharray={dash} />
							</svg>
							{label}
						</span>
					);
				})}
			</div>
		</div>
	);
}
