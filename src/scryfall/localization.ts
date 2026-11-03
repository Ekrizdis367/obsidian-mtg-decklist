import type { CardLanguage } from "../settings";
import type { ScryfallCard } from "./types";

/**
 * Keep translated printings separate from the canonical English card cache.
 * A pinned (SET) NUMBER gets a separate key, so it can favor the matching
 * language printing instead of inheriting a different set's artwork.
 */
export function localizedPrintingKey(
	card: ScryfallCard,
	language: CardLanguage,
	preferExactPrinting: boolean,
): string | null {
	if (language === "en" || !card.oracle_id) return null;
	if (preferExactPrinting && card.set && card.collector_number) {
		return `localized:${language}:set:${card.set.toLowerCase()}:${card.collector_number.toLowerCase()}`;
	}
	return `localized:${language}:oracle:${card.oracle_id}`;
}

export function localizedDisplayName(card: ScryfallCard, translated?: ScryfallCard | null): string {
	if (!translated) return card.name;
	if (translated.printed_name) return translated.printed_name;
	// Double-faced cards can carry printed names only on the individual faces.
	const faces = translated.card_faces ?? [];
	if (faces.length > 0 && faces.some((face) => face.printed_name)) {
		return faces.map((face) => face.printed_name ?? face.name ?? "").filter(Boolean).join(" // ");
	}
	return card.name;
}
