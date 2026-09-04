import { useMemo, useState } from 'react';
import Graph, { EDGE_LEGEND_ORDER, type GraphData } from './Graph';

export interface GraphExplorerProps {
	data: GraphData;
}

const EDGE_LEGEND_LABEL: Record<string, string> = {
	link: 'Link',
	extends: 'Extends',
	contradicts: 'Contradicts',
	topic: 'Topic',
};

const EDGE_LEGEND_DASH: Record<string, string> = {
	link: 'none',
	extends: '4,4',
	contradicts: '1,3',
	topic: '2,5',
};

function legendEntryFor(type: string) {
	return {
		label: EDGE_LEGEND_LABEL[type] ?? type,
		dash: EDGE_LEGEND_DASH[type] ?? '6,2,1,2',
	};
}

export default function GraphExplorer({ data }: GraphExplorerProps) {
	const [query, setQuery] = useState('');
	const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());

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
		setSelectedTopics((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	return (
		<div className="graph-explorer">
			<div className="graph-explorer__controls">
				<input
					type="search"
					className="graph-explorer__search"
					placeholder="Highlight notes…"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					aria-label="Highlight notes by title"
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
							onClick={() => setSelectedTopics(new Set())}
						>
							Clear
						</button>
					)}
				</div>
			</div>

			<Graph data={filtered} highlightQuery={query} />

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
