export type RepoMeta = {
	stars: number;
	description: string | null;
};

export type RepoMetaMap = Record<string, RepoMeta>;

/**
 * Fetch metadata for a user's repos in a single API call (per_page=100).
 * Returns whatever subset of the requested slugs the API gave back.
 * On any failure (non-200, network error, rate limit), logs a warning
 * and returns an empty map — the page must still build.
 */
export async function fetchRepoMeta(
	username: string,
	slugs: string[],
): Promise<RepoMetaMap> {
	if (slugs.length === 0) return {};

	const headers: Record<string, string> = {
		'User-Agent': 'astro-build',
		Accept: 'application/vnd.github+json',
	};

	if (process.env.GITHUB_TOKEN) {
		headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	}

	try {
		const res = await fetch(
			`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`,
			{ headers },
		);
		if (!res.ok) {
			console.warn(`[github] ${res.status} ${res.statusText}; skipping meta`);
			return {};
		}
		const repos: Array<{
			name: string;
			stargazers_count: number;
			description: string | null;
		}> = await res.json();

		const wanted = new Set(slugs);
		const map: RepoMetaMap = {};
		for (const repo of repos) {
			if (wanted.has(repo.name)) {
				map[repo.name] = {
					stars: repo.stargazers_count,
					description: repo.description,
				};
			}
		}
		return map;
	} catch (err) {
		console.warn('[github] fetch failed:', err);
		return {};
	}
}
