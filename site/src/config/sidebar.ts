/** One entry → one route in the sidebar drawer and home tile grid. */
export type SidebarSection = {
	readonly id: string;
	readonly label: string;
	readonly href: string;
};

export const sidebarSections = [
	{ id: 'tasks', label: 'Tasks', href: '/tasks' },
	{ id: 'notes', label: 'Notes', href: '/notes' },
	{ id: 'projects', label: 'Projects', href: '/projects' },
	{ id: 'search', label: 'Search', href: '/search' },
] as const satisfies readonly SidebarSection[];
