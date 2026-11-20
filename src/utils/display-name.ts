import { normalizeCardName } from "../scryfall/cache";
import type { ScryfallCard } from "../scryfall/types";

/**
 * Full card name in the printing's own language. Single-faced cards have a
 * top-level printed_name; multi-faced cards (MDFC, split, adventure) only
 * carry per-face printed_name values, so join them with " // " like
 * Scryfall's English card.name does.
 */
export function localizedCardName(card: ScryfallCard): string {
	if (card.printed_name) return card.printed_name;
	const faces = (card.card_faces ?? [])
		.map((f) => f.printed_name ?? f.name)
		.filter((n): n is string => Boolean(n));
	return faces.length > 0 ? faces.join(" // ") : card.name;
}

/**
 * Display name for a decklist entry: the name exactly as typed, except when
 * the entry names only one face of a multi-faced card — then the full
 * "Front // Back" name in the language the card was entered in.
 */
export function displayCardName(entryName: string, card: ScryfallCard | null): string {
	if (!card) return entryName;
	const full = localizedCardName(card);
	if (!full.includes(" // ")) return entryName;
	const typed = normalizeCardName(entryName);
	if (typed === normalizeCardName(full)) return entryName;
	const faces = new Set<string>();
	const candidates = [card.name, card.printed_name];
	for (const face of card.card_faces ?? []) {
		candidates.push(face.name, face.printed_name);
	}
	for (const name of candidates) {
		if (!name) continue;
		for (const part of name.split("//")) faces.add(normalizeCardName(part));
	}
	return faces.has(typed) ? full : entryName;
}
