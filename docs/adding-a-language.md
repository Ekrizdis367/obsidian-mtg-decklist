# Adding a language

MTG Decklist separates **card localization** (provided by [Scryfall](https://scryfall.com/docs/api)) from **plugin UI translation** (maintained in this repository). As of this contribution, the implemented languages are English (`en`) and French (`fr`).

Spanish (`es`) and German (`de`) are natural next candidates, but new translations should be checked by fluent speakers before being advertised as complete. Wizards of the Coast also publishes Magic cards in Italian and Japanese, among other languages.

## Steps to add a locale

1. **Verify the Scryfall language code.** For example, `es` (Spanish) or `de` (German). Check a few normal, double-faced and older cards using `lang:<code>` and `include_multilingual=true`. Some cards have no printing in that language.

2. **Register the language** in [`src/utils/languages.ts`](../src/utils/languages.ts). Use its Scryfall code and a name in the language itself:

   ```ts
   export const LANGUAGE_OPTIONS = [
     { code: "en", label: "English" },
     { code: "fr", label: "Français" },
     { code: "es", label: "Español" },
   ] as const;
   ```

   `CardLanguage`, the language dropdown and the `language:` deck directive are derived from this registry; no other union types or hardcoded dropdowns need editing.

3. **Add a UI dictionary** in [`src/utils/i18n.ts`](../src/utils/i18n.ts), using the **English strings as keys**. Copy the existing French entries as a reference and translate them into the new language. Register your dictionary in the `TRANSLATIONS` map:

   ```ts
   const SPANISH: Record<string, string> = {
     "Sideboard": "Banquillo",
     "Land": "Tierra",
     "Creature": "Criatura",
     "Mana curve": "Curva de maná",
     // ...translate the remaining UI messages, dialogs and descriptions
   };

   const TRANSLATIONS: Partial<Record<CardLanguage, Record<string, string>>> = {
     fr: FRENCH,
     es: SPANISH,
   };
   ```

   These are **illustrative snippets**. Preserve placeholders such as `{count}`, `{name}` and `{source}` exactly: `t(language, english, values)` interpolates them at runtime. Missing dictionary entries fall back to English. Error messages in `translatedError()` also use English keys, so the same dictionary can translate them.

4. **Keep gameplay identifiers canonical.** Scryfall `oracle_id`, card names used for queries/exports, deck legality, card types, tag identifiers and the `language: es` code must remain language-independent. Never translate imported card names or source identifiers automatically. Section aliases (e.g. `# Réserve`) and combo keywords are optional conveniences; adding a locale does *not* require translating parser syntax.

5. **Test a complete deck.** Use a `language: es` block with a main deck, a sideboard, a maybeboard, mono- and multicolored cards, and a double-faced card. Test image fallback (no matching locale printing), resolution preference, fixed editions with `(SET) NUMBER`, inline links, tooltips, stats, settings, error messages and English-mode regression. Confirm the dropdown language persists after restarting Obsidian.

6. **Build, lint and test:**

   ```sh
   npm ci
   npm run build
   npm run lint
   npm test
   ```

   Add assertions in [`tests/localization.test.cjs`](../tests/localization.test.cjs) for the new locale's display strings, card images and graceful fallback. Test the compiled plugin in an **isolated Obsidian vault** before submitting a PR.

7. **Document the locale.** Update [the README](../README.md), include a localized example (and optionally a full translated user guide), and describe any incomplete terminology or language coverage.

## Design constraints

- **English is the default and fallback.** The new locale must never affect users who have not selected it.
- **Per-block vs global language.** A `language:` directive controls *that deck's* card names, images, section headings and stats. The global setting also controls plugin settings, commands, combos and inline card links.
- **Scryfall printings are not necessarily current Oracle text.** Printed card text and images can be older than the current rules text. Never change canonical rules or legality based on printed translations.
- **Performance and privacy.** Localized printing results are cached separately from English card metadata, and Scryfall requests are rate-limited. Do not add translation APIs or send private note content to third parties.
- **Images.** Prefer a high-resolution printing when there is a choice. When the user specifies an exact `(SET) NUMBER`, that edition takes precedence. Allow fallback to English or to another available printing.

If you want to contribute only the user-interface dictionary for an existing language, start by opening a GitHub issue with the language code and your proposed translations.
