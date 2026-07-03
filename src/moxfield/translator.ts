import type { DecklistEntry, DecklistEntryHints, ParsedDecklist, Section, SectionKind } from "../parser/types";
import type { MoxfieldBoard, MoxfieldBoardCard, MoxfieldCard, MoxfieldDeck } from "./types";

export interface TagOverlayItem {
	displayName: string;
	tags: string[];
}

export interface TagOverlayResult {
	matched: number;
	unmatched: string[];
}

function normalizeName(name: string): string {
	return name.trim().toLowerCase();
}

function frontFace(name: string): string {
	const idx = name.indexOf("//");
	return idx >= 0 ? name.slice(0, idx).trim() : name;
}

export function collectTagOverlay(parsed: ParsedDecklist): Map<string, TagOverlayItem> {
	const overlay = new Map<string, TagOverlayItem>();
	for (const section of parsed.sections) {
		for (const entry of section.entries) {
			if (!entry.tags || entry.tags.length === 0) continue;
			const key = normalizeName(entry.name);
			const existing = overlay.get(key);
			if (existing) {
				for (const t of entry.tags) if (!existing.tags.includes(t)) existing.tags.push(t);
			} else {
				overlay.set(key, { displayName: entry.name, tags: [...entry.tags] });
			}
		}
	}
	return overlay;
}

export function applyTagOverlay(parsed: ParsedDecklist, overlay: Map<string, TagOverlayItem>): TagOverlayResult {
	if (overlay.size === 0) return { matched: 0, unmatched: [] };
	const remaining = new Map(overlay);
	let matched = 0;

	for (const section of parsed.sections) {
		for (const entry of section.entries) {
			const fullKey = normalizeName(entry.name);
			const frontKey = normalizeName(frontFace(entry.name));
			const item = remaining.get(fullKey) ?? remaining.get(frontKey);
			if (!item) continue;
			const first = entry.tags[0] ?? item.tags[0];
			entry.tags = first ? [first] : [];
			matched++;
			remaining.delete(fullKey);
			if (frontKey !== fullKey) remaining.delete(frontKey);
		}
	}

	return {
		matched,
		unmatched: Array.from(remaining.values()).map((v) => v.displayName),
	};
}

interface BoardSpec {
	key: string;
	title: string;
	kind: SectionKind;
}

const BOARD_ORDER: BoardSpec[] = [
	{ key: "commanders", title: "Commander", kind: "commander" },
	{ key: "companions", title: "Companion", kind: "general" },
	{ key: "signatureSpells", title: "Signature spell", kind: "general" },
	{ key: "mainboard", title: "Mainboard", kind: "general" },
	{ key: "attractions", title: "Attractions", kind: "general" },
	{ key: "stickers", title: "Stickers", kind: "general" },
	{ key: "contraptions", title: "Contraptions", kind: "general" },
	{ key: "tokens", title: "Tokens", kind: "maybeboard" },
	{ key: "sideboard", title: "Sideboard", kind: "sideboard" },
	{ key: "maybeboard", title: "Maybeboard", kind: "maybeboard" },
];

export function translateMoxfieldDeck(deck: MoxfieldDeck): ParsedDecklist {
	const sections: Section[] = [];
	const boards = deck.boards ?? {};
	let lineCounter = 1;

	for (const spec of BOARD_ORDER) {
		const board = boards[spec.key];
		const entries = boardToEntries(board, () => lineCounter++);
		if (entries.length === 0) continue;
		sections.push({
			title: spec.title,
			kind: spec.kind,
			entries,
		});
	}

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

function boardToEntries(board: MoxfieldBoard | undefined, nextLine: () => number): DecklistEntry[] {
	if (!board || !board.cards) return [];
	const entries: DecklistEntry[] = [];
	for (const key of Object.keys(board.cards)) {
		const item = board.cards[key];
		if (!item) continue;
		const entry = boardCardToEntry(item, nextLine);
		if (entry) entries.push(entry);
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	return entries;
}

function boardCardToEntry(item: MoxfieldBoardCard, nextLine: () => number): DecklistEntry | null {
	const name = item.card?.name?.trim();
	if (!name) return null;
	const quantity = Math.max(1, Math.floor(item.quantity ?? 1));
	const lineNumber = nextLine();
	const hints = buildHints(item.card);
	return {
		quantity,
		name,
		rawLine: `${quantity} ${name}`,
		lineNumber,
		tags: [],
		...(hints ? { hints } : {}),
	};
}

function buildHints(card: MoxfieldCard | undefined): DecklistEntryHints | undefined {
	if (!card) return undefined;
	const hints: DecklistEntryHints = {};
	if (typeof card.type_line === "string" && card.type_line.length > 0) hints.type_line = card.type_line;
	else if (typeof card.type === "string" && card.type.length > 0) hints.type_line = card.type;
	if (typeof card.cmc === "number" && Number.isFinite(card.cmc)) hints.cmc = card.cmc;
	if (typeof card.mana_cost === "string" && card.mana_cost.length > 0) hints.mana_cost = card.mana_cost;
	if (Array.isArray(card.colors) && card.colors.length > 0) hints.colors = card.colors.map((c) => c.toUpperCase());
	if (Array.isArray(card.color_identity) && card.color_identity.length > 0)
		hints.color_identity = card.color_identity.map((c) => c.toUpperCase());
	return Object.keys(hints).length > 0 ? hints : undefined;
}
