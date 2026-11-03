/**
 * Languages supported by both the plugin UI and Scryfall card previews.
 *
 * To add a language:
 *  1. Add its Scryfall language code and native display name here.
 *  2. Register an interface dictionary in utils/i18n.ts.
 *  3. Update documentation and tests (see docs/adding-a-language.md).
 *
 * Keep English first: it remains the default and the fallback.
 */
export const LANGUAGE_OPTIONS = [
	{ code: "en", label: "English" },
	{ code: "fr", label: "Français" },
] as const;

export type CardLanguage = (typeof LANGUAGE_OPTIONS)[number]["code"];

export function isSupportedLanguage(value: string): value is CardLanguage {
	return LANGUAGE_OPTIONS.some((language) => language.code === value);
}

export function supportedLanguageList(): string {
	return LANGUAGE_OPTIONS.map(({ code }) => `"${code}"`).join(" or ");
}
