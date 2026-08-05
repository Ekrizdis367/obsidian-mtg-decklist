import type { LegalityFormat } from "../settings";
import type { ScryfallCard } from "../scryfall/types";

export function isCardLegal(card: ScryfallCard, format: LegalityFormat): boolean {
	if (format === "off") return true;
	const status = card.legalities?.[format];
	return status === "legal" || status === "restricted";
}

export function legalityNote(card: ScryfallCard, format: LegalityFormat): string | null {
	if (format === "off") return null;
	const status = card.legalities?.[format];
	if (!status) return null;
	if (status === "legal") return null;
	if (status === "restricted") return `Restricted in ${format}`;
	if (status === "banned") return `Banned in ${format}`;
	return `Not legal in ${format}`;
}

export function colorIdentityViolations(
	allowedColors: Iterable<string>,
	cards: ScryfallCard[],
): { card: ScryfallCard; offending: string[] }[] {
	const allowed = new Set(Array.from(allowedColors, (c) => c.toUpperCase()));
	const violations: { card: ScryfallCard; offending: string[] }[] = [];
	for (const card of cards) {
		const offending = (card.color_identity ?? [])
			.map((c) => c.toUpperCase())
			.filter((c) => !allowed.has(c));
		if (offending.length > 0) {
			violations.push({ card, offending });
		}
	}
	return violations;
}
