/**
 * Extract an Archidekt deck ID from a URL or accept a bare numeric ID.
 * Examples:
 *   https://archidekt.com/decks/10282219/jeskai_golems -> "10282219"
 *   https://archidekt.com/decks/10282219                -> "10282219"
 *   10282219                                             -> "10282219"
 */
export function extractArchidektId(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	const urlMatch = trimmed.match(/archidekt\.com\/decks\/(\d+)/i);
	if (urlMatch && urlMatch[1]) {
		return urlMatch[1];
	}

	if (/^\d+$/.test(trimmed)) {
		return trimmed;
	}

	return null;
}

export function archidektDeckUrl(deckId: string): string {
	return `https://archidekt.com/decks/${deckId}`;
}
