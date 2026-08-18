import { requestUrl } from "obsidian";
import { ARCHIDEKT_API_BASE, ARCHIDEKT_DECK_PATH, PLUGIN_USER_AGENT } from "../utils/constants";
import { ArchidektFetchError, type ArchidektDeck, type CachedArchidektDeck } from "./types";

export interface ArchidektFetchOptions {
	force?: boolean;
	ttlMs: number;
}

export class ArchidektClient {
	private cache: Map<string, CachedArchidektDeck>;
	private inflight: Map<string, Promise<ArchidektDeck>> = new Map();
	private dirty = false;

	constructor(initial: Record<string, CachedArchidektDeck> = {}) {
		this.cache = new Map();
		for (const key of Object.keys(initial)) {
			const entry = initial[key];
			if (entry) this.cache.set(key, entry);
		}
	}

	getCached(deckId: string): CachedArchidektDeck | undefined {
		return this.cache.get(deckId);
	}

	getCachedFresh(deckId: string, ttlMs: number): ArchidektDeck | null {
		const entry = this.cache.get(deckId);
		if (!entry) return null;
		if (Date.now() - entry.fetchedAt > ttlMs) return null;
		return entry.deck;
	}

	async fetch(deckId: string, opts: ArchidektFetchOptions): Promise<ArchidektDeck> {
		if (!opts.force) {
			const fresh = this.getCachedFresh(deckId, opts.ttlMs);
			if (fresh) return fresh;
		}

		const existing = this.inflight.get(deckId);
		if (existing) return existing;

		const promise = this.doFetch(deckId);
		this.inflight.set(deckId, promise);
		try {
			return await promise;
		} finally {
			this.inflight.delete(deckId);
		}
	}

	invalidate(deckId: string): void {
		if (this.cache.delete(deckId)) {
			this.dirty = true;
		}
	}

	clear(): void {
		if (this.cache.size > 0) {
			this.cache.clear();
			this.dirty = true;
		}
	}

	size(): number {
		return this.cache.size;
	}

	consumeDirty(): boolean {
		const wasDirty = this.dirty;
		this.dirty = false;
		return wasDirty;
	}

	serialize(): Record<string, CachedArchidektDeck> {
		const out: Record<string, CachedArchidektDeck> = {};
		for (const [k, v] of this.cache) out[k] = v;
		return out;
	}

	private async doFetch(deckId: string): Promise<ArchidektDeck> {
		const url = `${ARCHIDEKT_API_BASE}${ARCHIDEKT_DECK_PATH}/${encodeURIComponent(deckId)}/`;
		let response;
		try {
			response = await requestUrl({
				url,
				method: "GET",
				headers: {
					Accept: "application/json",
					"User-Agent": PLUGIN_USER_AGENT,
				},
				throw: false,
			});
		} catch (err) {
			throw new ArchidektFetchError(
				`Network error contacting Archidekt: ${err instanceof Error ? err.message : String(err)}`,
				"network",
			);
		}

		if (response.status === 404) {
			throw new ArchidektFetchError("Deck not found on Archidekt.", "not-found", 404);
		}
		if (response.status === 401 || response.status === 403) {
			throw new ArchidektFetchError(
				"This Archidekt deck is private or not accessible without an account.",
				"private",
				response.status,
			);
		}
		if (response.status === 429) {
			throw new ArchidektFetchError(
				"Archidekt rate limit reached. Try again in a moment.",
				"rate-limited",
				429,
			);
		}
		if (response.status < 200 || response.status >= 300) {
			throw new ArchidektFetchError(
				`Archidekt request failed (HTTP ${response.status}).`,
				"unknown",
				response.status,
			);
		}

		const deck = response.json as ArchidektDeck | undefined;
		if (!deck || !deck.cards) {
			throw new ArchidektFetchError("Archidekt response was malformed.", "unknown", response.status);
		}

		this.cache.set(deckId, {
			deckId,
			fetchedAt: Date.now(),
			deck,
		});
		this.dirty = true;
		return deck;
	}
}
