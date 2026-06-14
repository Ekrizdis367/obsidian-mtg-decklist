import { DEFAULT_SECTION_TITLE } from "../parser/decklist-parser";
import type { DecklistEntry, ParsedDecklist, Section } from "../parser/types";
import type { ScryfallCard } from "../scryfall/types";
import type { CardSortOrder, GroupingMode } from "../settings";

export const TYPE_GROUP_ORDER = [
	"Commander",
	"Creature",
	"Planeswalker",
	"Battle",
	"Instant",
	"Sorcery",
	"Artifact",
	"Enchantment",
	"Land",
	"Other",
];

export interface ResolvedEntry {
	entry: DecklistEntry;
	card: ScryfallCard | null;
}

export interface ResolvedSection {
	title: string;
	kind: Section["kind"];
	entries: ResolvedEntry[];
}

/**
 * Resolve a single entry to a cached card. When the entry names a specific
 * printing (set + collector number), that printing is preferred; otherwise we
 * fall back to the default printing resolved by name.
 */
export type CardLookup = {
	byName: (name: string) => ScryfallCard | undefined;
	byPrinting: (set: string, collectorNumber: string) => ScryfallCard | undefined;
};

function lookupEntry(entry: DecklistEntry, lookup: CardLookup): ScryfallCard | null {
	if (entry.set && entry.collectorNumber) {
		const printing = lookup.byPrinting(entry.set, entry.collectorNumber);
		if (printing) return printing;
		// Printing not cached yet — leave unresolved so the async pass fetches it
		// by set/number rather than silently showing the default printing.
		return null;
	}
	return lookup.byName(entry.name) ?? null;
}

export function classifyByType(typeLine: string | undefined): string {
	if (!typeLine) return "Other";
	const t = typeLine.toLowerCase();
	if (t.includes("creature")) return "Creature";
	if (t.includes("planeswalker")) return "Planeswalker";
	if (t.includes("battle")) return "Battle";
	if (t.includes("instant")) return "Instant";
	if (t.includes("sorcery")) return "Sorcery";
	if (t.includes("artifact")) return "Artifact";
	if (t.includes("enchantment")) return "Enchantment";
	if (t.includes("land")) return "Land";
	return "Other";
}

function shouldUseAuto(parsed: ParsedDecklist, mode: GroupingMode): boolean {
	if (mode === "auto") return true;
	if (mode === "manual") return false;
	// `respect-manual`: only treat user-titled "general" headers as a manual layout signal.
	// Structural sections — commander, sideboard, maybeboard, and the default "Deck" header —
	// don't disable auto-grouping, so a deck can specify `# Commander` and still get the rest
	// auto-grouped by type.
	const hasCustomGroups = parsed.sections.some(
		(s) => s.kind === "general" && s.title !== DEFAULT_SECTION_TITLE,
	);
	return !hasCustomGroups;
}

function resolveEntries(entries: DecklistEntry[], lookup: CardLookup): ResolvedEntry[] {
	return entries.map((entry) => ({ entry, card: lookupEntry(entry, lookup) }));
}

export function buildResolvedSections(
	parsed: ParsedDecklist,
	mode: GroupingMode,
	sortOrder: CardSortOrder,
	lookup: CardLookup,
): ResolvedSection[] {
	const useAuto = shouldUseAuto(parsed, mode);

	const sideboards = parsed.sections.filter((s) => s.kind === "sideboard" || s.kind === "maybeboard");
	const sideboardOut: ResolvedSection[] = sideboards.map((s) => ({
		title: s.title,
		kind: s.kind,
		entries: sortEntries(resolveEntries(s.entries, lookup), sortOrder),
	}));

	const mainSections = parsed.sections.filter((s) => s.kind !== "sideboard" && s.kind !== "maybeboard");

	if (!useAuto) {
		const main = mainSections.map<ResolvedSection>((s) => ({
			title: s.title,
			kind: s.kind,
			entries: sortEntries(resolveEntries(s.entries, lookup), sortOrder),
		}));
		return [...main, ...sideboardOut];
	}

	const commanderEntries: ResolvedEntry[] = [];
	const buckets = new Map<string, ResolvedEntry[]>();

	for (const section of mainSections) {
		for (const entry of section.entries) {
			const card = lookupEntry(entry, lookup);
			const resolved: ResolvedEntry = { entry, card };
			if (section.kind === "commander") {
				commanderEntries.push(resolved);
				continue;
			}
			const bucket = classifyByType(card?.type_line ?? entry.hints?.type_line);
			const arr = buckets.get(bucket) ?? [];
			arr.push(resolved);
			buckets.set(bucket, arr);
		}
	}

	const out: ResolvedSection[] = [];
	if (commanderEntries.length > 0) {
		out.push({ title: "Commander", kind: "commander", entries: sortEntries(commanderEntries, sortOrder) });
	}
	for (const groupName of TYPE_GROUP_ORDER) {
		if (groupName === "Commander") continue;
		const items = buckets.get(groupName);
		if (items && items.length > 0) {
			out.push({ title: groupName, kind: "general", entries: sortEntries(items, sortOrder) });
		}
	}
	return [...out, ...sideboardOut];
}

function sortEntries(entries: ResolvedEntry[], order: CardSortOrder): ResolvedEntry[] {
	if (order === "source") return entries;
	const arr = [...entries];
	arr.sort((a, b) => {
		if (order === "cmc-name") {
			const aCmc = a.card?.cmc ?? a.entry.hints?.cmc ?? 99;
			const bCmc = b.card?.cmc ?? b.entry.hints?.cmc ?? 99;
			if (aCmc !== bCmc) return aCmc - bCmc;
		}
		return a.entry.name.localeCompare(b.entry.name);
	});
	return arr;
}

export function sectionEntryCount(section: ResolvedSection): number {
	return section.entries.reduce((sum, e) => sum + e.entry.quantity, 0);
}
