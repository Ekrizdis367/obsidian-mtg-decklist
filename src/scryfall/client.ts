import { requestUrl } from "obsidian";
import {
	PLUGIN_USER_AGENT,
	SCRYFALL_CARDS_BASE,
	SCRYFALL_NAMED_FUZZY,
	SCRYFALL_REQUEST_SPACING_MS,
	SCRYFALL_RETRY_BACKOFF_BASE_MS,
	SCRYFALL_RETRY_BACKOFF_MAX_MS,
	SCRYFALL_RETRY_MAX_ATTEMPTS,
} from "../utils/constants";
import { CardCache, normalizeCardName, printingKey } from "./cache";
import { bestLocalizedPrint, localizedPrintingKey } from "./localization";
import type { ScryfallCard } from "./types";
import type { CardLanguage } from "../settings";

export class ScryfallClient {
	private queue: Promise<unknown> = Promise.resolve();
	private inflight: Map<string, Promise<ScryfallCard | null>> = new Map();
	private lastRequestAt = 0;

	constructor(private readonly cache: CardCache) {}

	getCached(name: string): ScryfallCard | undefined {
		return this.cache.get(name);
	}

	getCachedPrinting(set: string, collectorNumber: string): ScryfallCard | undefined {
		return this.cache.getByKey(printingKey(set, collectorNumber));
	}

	getLocalizedCard(card: ScryfallCard, language: CardLanguage, preferExactPrinting = false): ScryfallCard | undefined {
		const key = localizedPrintingKey(card, language, preferExactPrinting);
		return key ? this.cache.getByKey(key) : undefined;
	}

	needsLocalization(card: ScryfallCard, language: CardLanguage, preferExactPrinting = false): boolean {
		const key = localizedPrintingKey(card, language, preferExactPrinting);
		return Boolean(key && !this.cache.getByKey(key) && !this.cache.hasNotFoundKey(key));
	}

	async fetchLocalizedCard(
		card: ScryfallCard,
		language: CardLanguage,
		preferExactPrinting = false,
	): Promise<ScryfallCard | null> {
		const key = localizedPrintingKey(card, language, preferExactPrinting);
		if (!key) return null;
		const cached = this.cache.getByKey(key);
		if (cached) return cached;
		if (this.cache.hasNotFoundKey(key)) return null;
		const existing = this.inflight.get(key);
		if (existing) return existing;

		const promise = this.enqueue(() => this.doFetchLocalized(card, language, preferExactPrinting, key));
		this.inflight.set(key, promise);
		try {
			return await promise;
		} finally {
			this.inflight.delete(key);
		}
	}

	private async doFetchLocalized(
		card: ScryfallCard,
		language: CardLanguage,
		preferExactPrinting: boolean,
		key: string,
		attempt = 0,
	): Promise<ScryfallCard | null> {
		const urls: string[] = [];
		if (preferExactPrinting && card.set && card.collector_number) {
			urls.push(
				`${SCRYFALL_CARDS_BASE}/${encodeURIComponent(card.set)}/${encodeURIComponent(card.collector_number)}/${language}`,
			);
		}
		// Search by Oracle ID, never by the translated spelling. This preserves
		// the same game object even when the translated card name is ambiguous.
		const query = `oracleid:${card.oracle_id} lang:${language}`;
		urls.push(`${SCRYFALL_CARDS_BASE}/search?q=${encodeURIComponent(query)}&unique=prints&order=released&dir=desc&include_multilingual=true`);

		let transientFailure = false;
		for (const [index, url] of urls.entries()) {
			// A failed exact-print lookup may need a second Scryfall request.
			// Respect the same minimum spacing used by the regular request queue.
			if (index > 0) {
				await sleep(SCRYFALL_REQUEST_SPACING_MS);
				this.lastRequestAt = Date.now();
			}
			try {
				const response = await requestUrl({
					url,
					method: "GET",
					headers: { Accept: "application/json", "User-Agent": PLUGIN_USER_AGENT },
					throw: false,
				});
				if (isThrottleStatus(response.status)) {
					if (attempt >= SCRYFALL_RETRY_MAX_ATTEMPTS) return null;
					await sleep(Math.max(parseRetryAfterMs(response.headers) ?? 0, backoffDelay(attempt)));
					this.lastRequestAt = Date.now();
					return this.doFetchLocalized(card, language, preferExactPrinting, key, attempt + 1);
				}
				if (response.status === 404) continue;
				if (response.status < 200 || response.status >= 300) {
					transientFailure = true;
					continue;
				}
				const json = response.json as { data?: ScryfallCard[] } & Partial<ScryfallCard>;
				const found: ScryfallCard | null = Array.isArray(json?.data)
					? bestLocalizedPrint(json.data, language, card.oracle_id ?? "")
					: json?.id ? (json as ScryfallCard) : null;
				if (found?.lang === language && found.oracle_id === card.oracle_id) {
					this.cache.setByKey(key, found);
					return found;
				}
			} catch (err) {
				console.warn("[mtg-decklist] Scryfall localization request failed", url, err);
				transientFailure = true;
			}
		}
		// Cache a true absence for an hour, but retry temporary network failures.
		if (!transientFailure) this.cache.markNotFoundKey(key);
		return null;
	}

	async fetchCardBySet(set: string, collectorNumber: string): Promise<ScryfallCard | null> {
		const key = printingKey(set, collectorNumber);
		const cached = this.cache.getByKey(key);
		if (cached) return cached;
		if (this.cache.hasNotFoundKey(key)) return null;

		const existing = this.inflight.get(key);
		if (existing) return existing;

		const promise = this.enqueue(() => this.doFetchBySet(set, collectorNumber, key));
		this.inflight.set(key, promise);
		try {
			return await promise;
		} finally {
			this.inflight.delete(key);
		}
	}

	async fetchCardByName(name: string): Promise<ScryfallCard | null> {
		const key = normalizeCardName(name);
		const cached = this.cache.get(name);
		if (cached) return cached;
		if (this.cache.hasNotFound(name)) return null;

		const existing = this.inflight.get(key);
		if (existing) return existing;

		const promise = this.enqueue(() => this.doFetch(name));
		this.inflight.set(key, promise);
		try {
			return await promise;
		} finally {
			this.inflight.delete(key);
		}
	}

	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const next = this.queue.then(async () => {
			const since = Date.now() - this.lastRequestAt;
			const wait = Math.max(0, SCRYFALL_REQUEST_SPACING_MS - since);
			if (wait > 0) await sleep(wait);
			this.lastRequestAt = Date.now();
			return task();
		});
		this.queue = next.catch(() => undefined);
		return next;
	}

	private async doFetch(name: string, attempt = 0): Promise<ScryfallCard | null> {
		const url = `${SCRYFALL_NAMED_FUZZY}${encodeURIComponent(name)}`;
		try {
			const response = await requestUrl({
				url,
				method: "GET",
				headers: {
					Accept: "application/json",
					"User-Agent": PLUGIN_USER_AGENT,
				},
				throw: false,
			});

			if (response.status === 404) {
				this.cache.markNotFound(name);
				return null;
			}

			if (isThrottleStatus(response.status)) {
				if (attempt >= SCRYFALL_RETRY_MAX_ATTEMPTS) {
					console.warn(
						`[mtg-decklist] Scryfall ${response.status} for "${name}" after ${attempt} retries; giving up for now`,
					);
					return null;
				}
				const headerDelay = parseRetryAfterMs(response.headers);
				const backoff = backoffDelay(attempt);
				const delay = Math.max(headerDelay ?? 0, backoff);
				console.debug(
					`[mtg-decklist] Scryfall ${response.status} for "${name}", retrying in ${delay}ms (attempt ${attempt + 1}/${SCRYFALL_RETRY_MAX_ATTEMPTS})`,
				);
				await sleep(delay);
				this.lastRequestAt = Date.now();
				return this.doFetch(name, attempt + 1);
			}

			if (response.status < 200 || response.status >= 300) {
				return null;
			}

			const card = response.json as ScryfallCard | undefined;
			if (!card || !card.name) return null;

			this.cache.set(name, card);
			this.cache.set(card.name, card);
			return card;
		} catch (err) {
			console.warn("[mtg-decklist] Scryfall request failed", name, err);
			return null;
		}
	}

	private async doFetchBySet(
		set: string,
		collectorNumber: string,
		key: string,
		attempt = 0,
	): Promise<ScryfallCard | null> {
		const url = `${SCRYFALL_CARDS_BASE}/${encodeURIComponent(set)}/${encodeURIComponent(collectorNumber)}`;
		try {
			const response = await requestUrl({
				url,
				method: "GET",
				headers: {
					Accept: "application/json",
					"User-Agent": PLUGIN_USER_AGENT,
				},
				throw: false,
			});

			if (response.status === 404) {
				this.cache.markNotFoundKey(key);
				return null;
			}

			if (isThrottleStatus(response.status)) {
				if (attempt >= SCRYFALL_RETRY_MAX_ATTEMPTS) {
					console.warn(
						`[mtg-decklist] Scryfall ${response.status} for "${set}/${collectorNumber}" after ${attempt} retries; giving up for now`,
					);
					return null;
				}
				const headerDelay = parseRetryAfterMs(response.headers);
				const backoff = backoffDelay(attempt);
				const delay = Math.max(headerDelay ?? 0, backoff);
				await sleep(delay);
				this.lastRequestAt = Date.now();
				return this.doFetchBySet(set, collectorNumber, key, attempt + 1);
			}

			if (response.status < 200 || response.status >= 300) {
				return null;
			}

			const card = response.json as ScryfallCard | undefined;
			if (!card || !card.name) return null;

			// Cache under the printing key so future lookups for this exact
			// printing are instant. Deliberately NOT cached under the plain card
			// name: a specific printing must not shadow later name-only lookups,
			// which should still resolve Scryfall's default printing.
			this.cache.setByKey(key, card);
			return card;
		} catch (err) {
			console.warn("[mtg-decklist] Scryfall printing request failed", `${set}/${collectorNumber}`, err);
			return null;
		}
	}
}

function isThrottleStatus(status: number): boolean {
	return status === 429 || status === 503 || status === 502 || status === 504;
}

function parseRetryAfterMs(headers: Record<string, string> | undefined): number | null {
	if (!headers) return null;
	const raw = headers["retry-after"] ?? headers["Retry-After"];
	if (!raw) return null;
	const seconds = Number.parseInt(raw, 10);
	if (Number.isFinite(seconds) && seconds > 0) {
		return Math.min(SCRYFALL_RETRY_BACKOFF_MAX_MS, seconds * 1000);
	}
	return null;
}

function backoffDelay(attempt: number): number {
	const exp = SCRYFALL_RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
	const jitter = Math.floor(Math.random() * 250);
	return Math.min(SCRYFALL_RETRY_BACKOFF_MAX_MS, exp + jitter);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
