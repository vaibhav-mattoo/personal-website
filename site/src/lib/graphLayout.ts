// Pure layout logic — no DOM/astro:content import, unit-testable and safe
// to import from the client-side Graph component. Replaces force-graph's
// live d3-force simulation (circle-based forceCollide, reshuffles on every
// load) with a fixed-tick, seeded, rectangle-aware layout computed once
// and then handed to force-graph as pinned (fx/fy) positions.

export type LayoutBox = {
	id: string;
	/** Half-width/half-height of the node's drawn extent (label or shape),
	 *  in the same unit space the canvas renders at zoom 1. */
	halfW: number;
	halfH: number;
	/** Id of the node this one is pulled toward (parent topic, or the
	 *  note's primary tag's topic node) — undefined for top-level/roots. */
	pullTarget?: string;
};

export type LayoutPosition = { x: number; y: number };

const TICKS = 400;
const COLLISION_PADDING = 6;
const REPULSION_STRENGTH = 30; // weak, global forceManyBody-equivalent (1/distance falloff)
const PULL_STRENGTH = 0.01;
const DAMPING = 0.85;
const MAX_SPEED = 60;
// Runs after the main tick loop until zero overlaps remain or this cap is
// hit (a real deadlock — three-way cycles, boundary clamping — is possible
// in principle, so this stays a cap, not an assumption of convergence).
const MAX_RELAXATION_PASSES = 5000;

/** Deterministic PRNG (mulberry32) — same seed always produces the same
 *  sequence, so the layout doesn't reshuffle on every rebuild/reload. */
function mulberry32(seed: number): () => number {
	let a = seed;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const LAYOUT_SEED = 0x2f6e4b1d;

type MutablePosition = { x: number; y: number; vx: number; vy: number };

/**
 * One pass over every pair, separating any whose padded AABBs overlap.
 * The split ratio between the two boxes is randomized (not a fixed 50/50)
 * and a small, optional decaying jitter is added to genuinely-stuck pairs
 * — both needed in practice to break 3+-body cyclic deadlocks that a pure
 * fixed-ratio pairwise correction can otherwise oscillate in forever.
 * Returns the number of pairs that were still overlapping when this pass
 * started (0 means the layout was already fully settled).
 */
function resolveCollisionsOnce(
	boxes: LayoutBox[],
	pos: Map<string, MutablePosition>,
	rng: () => number,
	jitter: number,
): number {
	let overlapping = 0;
	for (let i = 0; i < boxes.length; i++) {
		const a = boxes[i];
		const pa = pos.get(a.id)!;
		for (let j = i + 1; j < boxes.length; j++) {
			const b = boxes[j];
			const pb = pos.get(b.id)!;
			const dx = pb.x - pa.x;
			const dy = pb.y - pa.y;
			// Matches boxesOverlap's threshold exactly (padding on *each*
			// side, i.e. *2) — resolving to a looser threshold than the one
			// used to verify "done" is exactly what causes false deadlocks.
			const overlapX = a.halfW + b.halfW + COLLISION_PADDING * 2 - Math.abs(dx);
			const overlapY = a.halfH + b.halfH + COLLISION_PADDING * 2 - Math.abs(dy);
			if (overlapX <= 0 || overlapY <= 0) continue;
			overlapping++;

			if (overlapX < overlapY) {
				const sign = Math.abs(dx) > 0.01 ? Math.sign(dx) : rng() > 0.5 ? 1 : -1;
				const ratio = 0.3 + rng() * 0.4;
				pa.x -= overlapX * ratio * sign;
				pb.x += overlapX * (1 - ratio) * sign;
			} else {
				const sign = Math.abs(dy) > 0.01 ? Math.sign(dy) : rng() > 0.5 ? 1 : -1;
				const ratio = 0.3 + rng() * 0.4;
				pa.y -= overlapY * ratio * sign;
				pb.y += overlapY * (1 - ratio) * sign;
			}
			if (jitter > 0) {
				pa.x += (rng() - 0.5) * jitter;
				pa.y += (rng() - 0.5) * jitter;
				pb.x += (rng() - 0.5) * jitter;
				pb.y += (rng() - 0.5) * jitter;
			}
		}
	}
	return overlapping;
}

/** Two padded AABBs overlap? Same threshold resolveCollisionsOnce resolves to. */
function boxesOverlap(
	ax: number,
	ay: number,
	aHalfW: number,
	aHalfH: number,
	bx: number,
	by: number,
	bHalfW: number,
	bHalfH: number,
	padding: number,
): boolean {
	return (
		Math.abs(ax - bx) < aHalfW + bHalfW + padding * 2 &&
		Math.abs(ay - by) < aHalfH + bHalfH + padding * 2
	);
}

/**
 * Lays out `boxes` deterministically: seeded initial positions, then
 * TICKS iterations of (a) weak global repulsion, (b) a spring pulling each
 * node toward its `pullTarget`'s current position, (c) rectangle-collision
 * separation (AABB, not circle). After clamping final positions inside a
 * bounding square, runs pure collision-relaxation passes (no forces) until
 * every pair clears COLLISION_PADDING or MAX_RELAXATION_PASSES is hit.
 *
 * Returns final positions plus any label pairs that still overlap (empty
 * in the overwhelming majority of real layouts — logged by the caller,
 * not thrown, since a soft failure here shouldn't take the whole graph
 * down).
 */
export function layoutGraph(boxes: LayoutBox[]): {
	positions: Map<string, LayoutPosition>;
	remainingOverlaps: Array<[string, string]>;
} {
	const rng = mulberry32(LAYOUT_SEED);

	const totalArea = boxes.reduce((sum, b) => sum + b.halfW * b.halfH * 4, 0);
	const boundHalf = Math.max(400, Math.sqrt(totalArea) * 1.3);

	const pos = new Map<string, MutablePosition>();
	for (const b of boxes) {
		const angle = rng() * Math.PI * 2;
		const radius = rng() * boundHalf * 0.7;
		pos.set(b.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0 });
	}

	for (let tick = 0; tick < TICKS; tick++) {
		const forces = new Map<string, { fx: number; fy: number }>();
		for (const b of boxes) forces.set(b.id, { fx: 0, fy: 0 });

		// (a) Weak global repulsion — every pair, 1/distance falloff (not
		// 1/distance^2 — that decays too fast to keep dense clusters spread).
		for (let i = 0; i < boxes.length; i++) {
			const a = boxes[i];
			const pa = pos.get(a.id)!;
			for (let j = i + 1; j < boxes.length; j++) {
				const b = boxes[j];
				const pb = pos.get(b.id)!;
				let dx = pa.x - pb.x;
				let dy = pa.y - pb.y;
				let dist = Math.hypot(dx, dy);
				if (dist < 1) {
					dist = 1;
					dx = rng() - 0.5;
					dy = rng() - 0.5;
				}
				const force = REPULSION_STRENGTH / dist;
				const fx = (dx / dist) * force;
				const fy = (dy / dist) * force;
				forces.get(a.id)!.fx += fx;
				forces.get(a.id)!.fy += fy;
				forces.get(b.id)!.fx -= fx;
				forces.get(b.id)!.fy -= fy;
			}
		}

		// (b) Spring pull toward each node's cluster target.
		for (const b of boxes) {
			if (!b.pullTarget) continue;
			const target = pos.get(b.pullTarget);
			if (!target) continue;
			const p = pos.get(b.id)!;
			const f = forces.get(b.id)!;
			f.fx += (target.x - p.x) * PULL_STRENGTH;
			f.fy += (target.y - p.y) * PULL_STRENGTH;
		}

		// Integrate.
		for (const b of boxes) {
			const p = pos.get(b.id)!;
			const f = forces.get(b.id)!;
			p.vx = (p.vx + f.fx) * DAMPING;
			p.vy = (p.vy + f.fy) * DAMPING;
			const speed = Math.hypot(p.vx, p.vy);
			if (speed > MAX_SPEED) {
				p.vx = (p.vx / speed) * MAX_SPEED;
				p.vy = (p.vy / speed) * MAX_SPEED;
			}
			p.x += p.vx;
			p.y += p.vy;
		}

		// (c) Rectangle-collision separation, one pass per tick.
		resolveCollisionsOnce(boxes, pos, rng, 0);
	}

	// Clamp final positions inside a padded bounding square.
	const clampPad = 24;
	for (const b of boxes) {
		const p = pos.get(b.id)!;
		const maxX = boundHalf - b.halfW - clampPad;
		const maxY = boundHalf - b.halfH - clampPad;
		p.x = Math.max(-maxX, Math.min(maxX, p.x));
		p.y = Math.max(-maxY, Math.min(maxY, p.y));
	}

	// Pure relaxation (no forces) until settled — clamping above can
	// reintroduce overlaps the tick loop had already resolved, and a
	// handful of tight clusters need more than one pass to fully separate.
	// Decaying jitter breaks the rare 3+-body cycle a fixed-ratio pairwise
	// correction alone can oscillate in indefinitely.
	for (let i = 0; i < MAX_RELAXATION_PASSES; i++) {
		const jitter = Math.max(0, 3 * (1 - i / MAX_RELAXATION_PASSES));
		const stillOverlapping = resolveCollisionsOnce(boxes, pos, rng, jitter);
		if (stillOverlapping === 0) break;
	}

	const remainingOverlaps: Array<[string, string]> = [];
	for (let i = 0; i < boxes.length; i++) {
		const a = boxes[i];
		const pa = pos.get(a.id)!;
		for (let j = i + 1; j < boxes.length; j++) {
			const b = boxes[j];
			const pb = pos.get(b.id)!;
			if (boxesOverlap(pa.x, pa.y, a.halfW, a.halfH, pb.x, pb.y, b.halfW, b.halfH, COLLISION_PADDING)) {
				remainingOverlaps.push([a.id, b.id]);
			}
		}
	}

	const positions = new Map<string, LayoutPosition>();
	for (const b of boxes) {
		const p = pos.get(b.id)!;
		positions.set(b.id, { x: p.x, y: p.y });
	}

	return { positions, remainingOverlaps };
}
