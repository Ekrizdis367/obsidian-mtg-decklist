import { requestUrl } from "obsidian";
import { PLUGIN_USER_AGENT, SCRYFALL_API_BASE } from "../utils/constants";

export interface ScryfallSymbol {
	symbol: string;
	svg_uri: string;
	english?: string;
	colors?: string[];
}

interface ScryfallSymbologyResponse {
	data: ScryfallSymbol[];
}

export class SymbologyClient {
	private map: Map<string, ScryfallSymbol> = new Map();
	private loadPromise: Promise<boolean> | null = null;
	private dirty = false;

	constructor(initial?: Record<string, ScryfallSymbol>) {
		if (initial) {
			for (const key of Object.keys(initial)) {
				const sym = initial[key];
				if (sym?.svg_uri) this.map.set(key, sym);
			}
		}
	}

	size(): number {
		return this.map.size;
	}

	hasAny(): boolean {
		return this.map.size > 0;
	}

	get(symbolKey: string): ScryfallSymbol | undefined {
		return this.map.get(normalizeSymbolKey(symbolKey));
	}

	consumeDirty(): boolean {
		const wasDirty = this.dirty;
		this.dirty = false;
		return wasDirty;
	}

	clear(): void {
		this.map.clear();
		this.dirty = true;
	}

	serialize(): Record<string, ScryfallSymbol> {
		const out: Record<string, ScryfallSymbol> = {};
		for (const [key, sym] of this.map.entries()) {
			out[key] = sym;
		}
		return out;
	}

	async ensureLoaded(): Promise<boolean> {
		if (this.map.size > 0) return true;
		if (this.loadPromise) return this.loadPromise;
		this.loadPromise = this.fetchAll();
		try {
			return await this.loadPromise;
		} finally {
			this.loadPromise = null;
		}
	}

	private async fetchAll(): Promise<boolean> {
		try {
			const response = await requestUrl({
				url: `${SCRYFALL_API_BASE}/symbology`,
				method: "GET",
				headers: {
					Accept: "application/json",
					"User-Agent": PLUGIN_USER_AGENT,
				},
				throw: false,
			});
			if (response.status < 200 || response.status >= 300) return false;
			const body = response.json as ScryfallSymbologyResponse | undefined;
			if (!body?.data) return false;
			for (const sym of body.data) {
				if (!sym.symbol || !sym.svg_uri) continue;
				this.map.set(normalizeSymbolKey(sym.symbol), sym);
			}
			this.dirty = true;
			return true;
		} catch (err) {
			console.warn("[mtg-decklist] Failed to load Scryfall symbology", err);
			return false;
		}
	}
}

export function normalizeSymbolKey(input: string): string {
	const trimmed = input.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed.toUpperCase();
	return `{${trimmed.toUpperCase()}}`;
}
