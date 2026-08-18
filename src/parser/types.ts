export type SectionKind = "commander" | "sideboard" | "maybeboard" | "general";

export interface DecklistEntryHints {
	type_line?: string;
	cmc?: number;
	colors?: string[];
	color_identity?: string[];
	mana_cost?: string;
}

export interface DecklistEntry {
	quantity: number;
	name: string;
	rawLine: string;
	lineNumber: number;
	tags: string[];
	hints?: DecklistEntryHints;
	/** Lowercased Scryfall set code, e.g. "mrd", when a specific printing is requested. */
	set?: string;
	/** Collector number for the requested printing, e.g. "278". */
	collectorNumber?: string;
}

export interface Section {
	title: string;
	kind: SectionKind;
	entries: DecklistEntry[];
}

export interface DecklistError {
	lineNumber: number;
	message: string;
	rawLine: string;
}

export type DecklistLegalityFormat =
	| "off"
	| "standard"
	| "pioneer"
	| "modern"
	| "legacy"
	| "vintage"
	| "pauper"
	| "commander"
	| "brawl";

export interface DecklistDirectives {
	group?: "auto" | "manual" | "respect-manual";
	sort?: "name" | "cmc-name" | "source";
	legality?: DecklistLegalityFormat;
}

export interface RemoteSource {
	kind: "moxfield" | "archidekt";
	id: string;
	rawUrl?: string;
}

export interface ParsedDecklist {
	sections: Section[];
	errors: DecklistError[];
	totalCards: number;
	directives: DecklistDirectives;
	remoteSource?: RemoteSource;
}
