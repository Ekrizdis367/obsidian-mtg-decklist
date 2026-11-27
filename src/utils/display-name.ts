import type { ScryfallCard } from "../scryfall/types";

/**
 * Card name as printed on the resolved printing. English printings carry no
 * printed_name, so they get Scryfall's English name. A non-English printing has
 * a top-level printed_name when single-faced; multi-faced cards (MDFC, split,
 * adventure) only carry per-face printed_name values, so those are joined with
 * " // " like Scryfall's English card.name.
 */
export function localizedCardName(card: ScryfallCard): string {
	// English printing: Scryfall's canonical name, which also corrects a
	// misspelling in the source list, exactly as rows showed before this feature.
	if (card.lang === "en") return card.name;
	if (card.printed_name) return card.printed_name;
	const faces = (card.card_faces ?? [])
		.map((f) => f.printed_name ?? f.name)
		.filter((n): n is string => Boolean(n));
	return faces.length > 0 ? faces.join(" // ") : card.name;
}

/**
 * Name shown for a decklist entry: the typed text while the card is still
 * unresolved, otherwise the name printed on the resolved printing.
 */
export function displayCardName(entryName: string, card: ScryfallCard | null): string {
	return card ? localizedCardName(card) : entryName;
}
