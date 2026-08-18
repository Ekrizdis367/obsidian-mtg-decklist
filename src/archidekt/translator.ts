import type { DecklistEntry, DecklistEntryHints, ParsedDecklist, Section, SectionKind } from "../parser/types";
import type { ArchidektDeck, ArchidektDeckCard, ArchidektOracleCard } from "./types";

const COLOR_NAME_TO_CODE: Record<string, string> = {
	white: "W",
	blue: "U",
	black: "B",
	red: "R",
	green: "G",
};

const BOARD_CATEGORIES = new Set(["Commander", "Sideboard", "Maybeboard"]);

function boardKindFor(categories: string[]): SectionKind | null {
	if (categories.includes("Commander")) return "commander";
	if (categories.includes("Sideboard")) return "sideboard";
	if (categories.includes("Maybeboard")) return "maybeboard";
	return null;
}

/** A card can carry several Archidekt category tags (e.g. "Acceleration", "Ramp"); the
 * first non-board tag is used as the card's display section, matching the order the
 * categories were assigned to the card in Archidekt. */
function primaryCategoryFor(categories: string[]): string | null {
	for (const category of categories) {
		if (!BOARD_CATEGORIES.has(category)) return category;
	}
	return null;
}

export function translateArchidektDeck(deck: ArchidektDeck): ParsedDecklist {
	// Deck-level category order reflects the order the user arranged categories in
	// Archidekt, so custom sections are emitted in that order rather than alphabetically.
	const categoryOrder = (deck.categories ?? [])
		.map((c) => c.name)
		.filter((name): name is string => typeof name === "string" && name.length > 0);

	const commander: DecklistEntry[] = [];
	const sideboard: DecklistEntry[] = [];
	const maybeboard: DecklistEntry[] = [];
	const mainboard: DecklistEntry[] = [];
	const customBuckets = new Map<string, DecklistEntry[]>();

	let lineCounter = 1;
	for (const item of deck.cards ?? []) {
		const entry = deckCardToEntry(item, () => lineCounter++);
		if (!entry) continue;
		const categories = item.categories ?? [];
		const boardKind = boardKindFor(categories);
		if (boardKind === "commander") {
			commander.push(entry);
			continue;
		}
		if (boardKind === "sideboard") {
			sideboard.push(entry);
			continue;
		}
		if (boardKind === "maybeboard") {
			maybeboard.push(entry);
			continue;
		}
		const primary = primaryCategoryFor(categories);
		if (primary) {
			let bucket = customBuckets.get(primary);
			if (!bucket) {
				bucket = [];
				customBuckets.set(primary, bucket);
			}
			bucket.push(entry);
		} else {
			mainboard.push(entry);
		}
	}

	const sections: Section[] = [];
	const pushSection = (title: string, kind: SectionKind, entries: DecklistEntry[]) => {
		if (entries.length === 0) return;
		entries.sort((a, b) => a.name.localeCompare(b.name));
		sections.push({ title, kind, entries });
	};

	pushSection("Commander", "commander", commander);

	const customNames = [...customBuckets.keys()];
	const orderedCustomNames = [
		...categoryOrder.filter((name) => customBuckets.has(name)),
		...customNames.filter((name) => !categoryOrder.includes(name)),
	];
	for (const name of orderedCustomNames) {
		pushSection(name, "general", customBuckets.get(name) ?? []);
	}

	pushSection("Mainboard", "general", mainboard);
	pushSection("Sideboard", "sideboard", sideboard);
	pushSection("Maybeboard", "maybeboard", maybeboard);

	const totalCards = sections
		.filter((s) => s.kind !== "sideboard" && s.kind !== "maybeboard")
		.reduce((sum, s) => sum + s.entries.reduce((n, e) => n + e.quantity, 0), 0);

	return {
		sections,
		errors: [],
		totalCards,
		directives: {},
	};
}

function deckCardToEntry(item: ArchidektDeckCard, nextLine: () => number): DecklistEntry | null {
	const oracle = item.card?.oracleCard;
	const name = oracle?.name?.trim();
	if (!name) return null;
	const quantity = Math.max(1, Math.floor(item.quantity ?? 1));
	const lineNumber = nextLine();
	const hints = buildHints(oracle);
	return {
		quantity,
		name,
		rawLine: `${quantity} ${name}`,
		lineNumber,
		tags: [],
		...(hints ? { hints } : {}),
	};
}

function buildTypeLine(oracle: ArchidektOracleCard): string | undefined {
	const superTypes = oracle.superTypes ?? [];
	const types = oracle.types ?? [];
	const subTypes = oracle.subTypes ?? [];
	const front = [...superTypes, ...types].join(" ").trim();
	if (!front) return undefined;
	return subTypes.length > 0 ? `${front} — ${subTypes.join(" ")}` : front;
}

function mapColors(colors: string[] | undefined): string[] | undefined {
	if (!Array.isArray(colors) || colors.length === 0) return undefined;
	const mapped = colors.map((c) => COLOR_NAME_TO_CODE[c.toLowerCase()] ?? c.toUpperCase()).filter(Boolean);
	return mapped.length > 0 ? mapped : undefined;
}

function buildHints(oracle: ArchidektOracleCard | undefined): DecklistEntryHints | undefined {
	if (!oracle) return undefined;
	const hints: DecklistEntryHints = {};
	const typeLine = buildTypeLine(oracle);
	if (typeLine) hints.type_line = typeLine;
	if (typeof oracle.cmc === "number" && Number.isFinite(oracle.cmc)) hints.cmc = oracle.cmc;
	if (typeof oracle.manaCost === "string" && oracle.manaCost.length > 0) hints.mana_cost = oracle.manaCost;
	const colors = mapColors(oracle.colors);
	if (colors) hints.colors = colors;
	const colorIdentity = mapColors(oracle.colorIdentity);
	if (colorIdentity) hints.color_identity = colorIdentity;
	return Object.keys(hints).length > 0 ? hints : undefined;
}
