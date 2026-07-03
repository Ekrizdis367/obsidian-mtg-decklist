import { requestUrl } from "obsidian";
import { MOXFIELD_API_BASE, MOXFIELD_DECK_PATH, PLUGIN_USER_AGENT } from "../utils/constants";
import { MoxfieldFetchError, type CachedMoxfieldDeck, type MoxfieldDeck } from "./types";

export interface MoxfieldFetchOptions {
	force?: boolean;
	ttlMs: number;
}

export class MoxfieldClient {
	private cache: Map<string, CachedMoxfieldDeck>;
	private inflight: Map<string, Promise<MoxfieldDeck>> = new Map();
	private dirty = false;

	constructor(initial: Record<string, CachedMoxfieldDeck> = {}) {
		this.cache = new Map();
		for (const key of Object.keys(initial)) {
			const entry = initial[key];
			if (entry) this.cache.set(key, entry);
		}
	}

	getCached(publicId: string): CachedMoxfieldDeck | undefined {
		return this.cache.get(publicId);
	}

	getCachedFresh(publicId: string, ttlMs: number): MoxfieldDeck | null {
		const entry = this.cache.get(publicId);
		if (!entry) return null;
		if (Date.now() - entry.fetchedAt > ttlMs) return null;
		return entry.deck;
	}

	async fetch(publicId: string, opts: MoxfieldFetchOptions): Promise<MoxfieldDeck> {
		if (!opts.force) {
			const fresh = this.getCachedFresh(publicId, opts.ttlMs);
			if (fresh) return fresh;
		}

		const existing = this.inflight.get(publicId);
		if (existing) return existing;

		const promise = this.doFetch(publicId);
		this.inflight.set(publicId, promise);
		try {
			return await promise;
		} finally {
			this.inflight.delete(publicId);
		}
	}

	invalidate(publicId: string): void {
		if (this.cache.delete(publicId)) {
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

	serialize(): Record<string, CachedMoxfieldDeck> {
		const out: Record<string, CachedMoxfieldDeck> = {};
		for (const [k, v] of this.cache) out[k] = v;
		return out;
	}

	private async doFetch(publicId: string): Promise<MoxfieldDeck> {
		const url = `${MOXFIELD_API_BASE}${MOXFIELD_DECK_PATH}/${encodeURIComponent(publicId)}`;
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
			throw new MoxfieldFetchError(
				`Network error contacting Moxfield: ${err instanceof Error ? err.message : String(err)}`,
				"network",
			);
		}

		if (response.status === 404) {
			throw new MoxfieldFetchError("Deck not found on Moxfield.", "not-found", 404);
		}
		if (response.status === 401 || response.status === 403) {
			throw new MoxfieldFetchError(
				"This Moxfield deck is private or not accessible without an account.",
				"private",
				response.status,
			);
		}
		if (response.status === 429) {
			throw new MoxfieldFetchError(
				"Moxfield rate limit reached. Try again in a moment.",
				"rate-limited",
				429,
			);
		}
		if (response.status < 200 || response.status >= 300) {
			throw new MoxfieldFetchError(
				`Moxfield request failed (HTTP ${response.status}).`,
				"unknown",
				response.status,
			);
		}

		const deck = response.json as MoxfieldDeck | undefined;
		if (!deck || !deck.boards) {
			throw new MoxfieldFetchError("Moxfield response was malformed.", "unknown", response.status);
		}

		this.cache.set(publicId, {
			publicId,
			fetchedAt: Date.now(),
			deck,
		});
		this.dirty = true;
		return deck;
	}
}
