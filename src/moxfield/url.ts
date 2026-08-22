/**
 * Extract a Moxfield public deck ID from a URL or accept a bare ID.
 * Examples:
 *   https://www.moxfield.com/decks/AbCdEf123Hij  -> "AbCdEf123Hij"
 *   https://moxfield.com/decks/AbCdEf123Hij/edit -> "AbCdEf123Hij"
 *   AbCdEf123Hij                                  -> "AbCdEf123Hij"
 */
export function extractMoxfieldId(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	const urlMatch = trimmed.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i);
	if (urlMatch && urlMatch[1]) {
		return urlMatch[1];
	}

	// Bare public IDs are mixed alphanumeric; reject digits-only so Archidekt
	// numeric IDs (e.g. "10282219") are not mistaken for Moxfield.
	if (/^[A-Za-z0-9_-]{6,}$/.test(trimmed) && !/^\d+$/.test(trimmed)) {
		return trimmed;
	}

	return null;
}

export function moxfieldDeckUrl(publicId: string): string {
	return `https://www.moxfield.com/decks/${publicId}`;
}
