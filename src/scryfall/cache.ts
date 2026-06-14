import type { CachedCardEntry, ScryfallCard } from "./types";

export function normalizeCardName(name: string): string {
	return name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Stable cache key for a specific printing, e.g. "set:mrd:278". */
export function printingKey(set: string, collectorNumber: string): string {
	return `set:${set.toLowerCase().trim()}:${collectorNumber.toLowerCase().trim()}`;
}

export class CardCache {
	private map: Map<string, CachedCardEntry> = new Map();
	private notFound: Map<string, number> = new Map();
	private dirty = false;

	constructor(initial?: Record<string, CachedCardEntry>) {
		if (initial) {
			for (const [key, entry] of Object.entries(initial)) {
				if (entry?.card) {
					this.map.set(key, entry);
				}
			}
		}
	}

	size(): number {
		return this.map.size;
	}

	get(name: string): ScryfallCard | undefined {
		return this.map.get(normalizeCardName(name))?.card;
	}

	/** Look up by an already-built raw key (e.g. a printing key) without name normalization. */
	getByKey(key: string): ScryfallCard | undefined {
		return this.map.get(key)?.card;
	}

	set(name: string, card: ScryfallCard): void {
		this.map.set(normalizeCardName(name), {
			card,
			cachedAt: Date.now(),
		});
		this.dirty = true;
	}

	/** Store under an already-built raw key without name normalization. */
	setByKey(key: string, card: ScryfallCard): void {
		this.map.set(key, {
			card,
			cachedAt: Date.now(),
		});
		this.dirty = true;
	}

	hasNotFound(name: string): boolean {
		const ts = this.notFound.get(normalizeCardName(name));
		if (ts === undefined) return false;
		return Date.now() - ts < 1000 * 60 * 60;
	}

	markNotFound(name: string): void {
		this.notFound.set(normalizeCardName(name), Date.now());
	}

	/** notFound check by raw key, for printing lookups. */
	hasNotFoundKey(key: string): boolean {
		const ts = this.notFound.get(key);
		if (ts === undefined) return false;
		return Date.now() - ts < 1000 * 60 * 60;
	}

	markNotFoundKey(key: string): void {
		this.notFound.set(key, Date.now());
	}

	clear(): void {
		this.map.clear();
		this.notFound.clear();
		this.dirty = true;
	}

	consumeDirty(): boolean {
		const wasDirty = this.dirty;
		this.dirty = false;
		return wasDirty;
	}

	serialize(): Record<string, CachedCardEntry> {
		const out: Record<string, CachedCardEntry> = {};
		for (const [key, value] of this.map.entries()) {
			out[key] = value;
		}
		return out;
	}
}
