import * as Dialog from '@radix-ui/react-dialog';
import { useRef, useState } from 'react';
import { sidebarSections } from '../config/sidebar';

const STORAGE_KEY = 'sidebar-state';

function readStoredOpen() {
	return localStorage.getItem(STORAGE_KEY) === 'open';
}

function MenuIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			aria-hidden
		>
			<path d="M4 5h16" />
			<path d="M4 12h16" />
			<path d="M4 19h16" />
		</svg>
	);
}

function CloseIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			aria-hidden
		>
			<path d="M18 6 6 18" />
			<path d="m6 6 12 12" />
		</svg>
	);
}

function isTriggerEvent(trigger: HTMLButtonElement | null, target: EventTarget | null) {
	return target instanceof Node && trigger?.contains(target);
}

export default function SidebarDrawer() {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(readStoredOpen);

	const onOpenChange = (next: boolean) => {
		setOpen(next);
		localStorage.setItem(STORAGE_KEY, next ? 'open' : 'closed');
	};

	const ignoreTriggerDismiss = (event: Event) => {
		if (isTriggerEvent(triggerRef.current, event.target)) {
			event.preventDefault();
		}
	};

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<button
				ref={triggerRef}
				type="button"
				className="ctrl-btn"
				aria-label={open ? 'Close sidebar' : 'Open sidebar'}
				aria-expanded={open}
				aria-haspopup="dialog"
				onClick={() => onOpenChange(!open)}
			>
				{open ? <CloseIcon /> : <MenuIcon />}
			</button>
			<Dialog.Portal>
				<Dialog.Overlay className="sheet-overlay" />
				<Dialog.Content
					className="sheet-content"
					aria-describedby={undefined}
					onPointerDownOutside={ignoreTriggerDismiss}
					onInteractOutside={ignoreTriggerDismiss}
				>
					<Dialog.Title className="sheet-title">Sections</Dialog.Title>
					<nav>
						<ul className="sheet-nav">
							{sidebarSections.map((s) => (
								<li key={s.id}>
									<a href={s.href} onClick={() => onOpenChange(false)}>
										{s.label}
									</a>
								</li>
							))}
						</ul>
					</nav>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
