import type { APIRoute } from 'astro';
import { getGraphData } from '../lib/topicVault';

// Static JSON endpoint — prerendered at build time like every other page.
// getGraphData() is built from getPublicVault()/getTopicTree(), so nothing
// that fails isVisible() (drafts, shared notes) can end up in it, and no
// note bodies are read — buildGraphData only touches id/title/tags/kind/summary.
export const prerender = true;

export const GET: APIRoute = async () => {
	const data = await getGraphData();

	return new Response(JSON.stringify(data), {
		headers: { 'Content-Type': 'application/json' },
	});
};
