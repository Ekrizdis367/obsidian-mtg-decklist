const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { cwd } = require("node:process");
const esbuild = require("esbuild");

async function loadTypeScript(relativePath) {
	const absolutePath = path.resolve(cwd(), relativePath);
	const result = await esbuild.build({
		entryPoints: [absolutePath],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
		plugins: [{
			name: "test-obsidian-api",
			setup(build) {
				build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test" }));
				build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
					contents: "export const requestUrl = (options) => globalThis.__testScryfallRequest(options); export const Platform = { isMobile: false, isMobileApp: false };",
					loader: "js",
				}));
			},
		}],
	});
	const loaded = new Module(absolutePath, module);
	loaded.filename = absolutePath;
	loaded.paths = module.paths;
	loaded._compile(result.outputFiles[0].text, absolutePath);
	return loaded.exports;
}

const canonical = {
	id: "en-123",
	oracle_id: "oracle-123",
	name: "Lightning Bolt",
	set: "m10",
	collector_number: "123",
	lang: "en",
};

const french = {
	id: "fr-123",
	oracle_id: "oracle-123",
	name: "Lightning Bolt",
	printed_name: "Foudre",
	lang: "fr",
	image_uris: { normal: "https://cards.scryfall.io/normal/fr-example.jpg" },
};

test("language registry is the single source of truth for directive validation", async () => {
	const { LANGUAGE_OPTIONS, isSupportedLanguage, supportedLanguageList } = await loadTypeScript("src/utils/languages.ts");
	const { parseDecklist } = await loadTypeScript("src/parser/decklist-parser.ts");
	assert.deepEqual(LANGUAGE_OPTIONS.map((language) => language.code), ["en", "fr"]);
	assert.equal(supportedLanguageList(), '"en" or "fr"');
	assert.equal(isSupportedLanguage("fr"), true);
	assert.equal(isSupportedLanguage("es"), false);
	for (const { code } of LANGUAGE_OPTIONS) {
		const deck = parseDecklist(`language: ${code}\n# Sideboard\n2 Pyroclasm`);
		assert.equal(deck.directives.language, code);
		assert.equal(deck.errors.length, 0);
	}
	const invalid = parseDecklist("language: es\n4 Lightning Bolt");
	assert.match(invalid.errors[0].message, /Use "en" or "fr"/);
});

test("decklist accepts language override without disturbing sideboard parsing", async () => {
	const { parseDecklist } = await loadTypeScript("src/parser/decklist-parser.ts");
	const parsed = parseDecklist([
		"language: fr",
		"legality: modern",
		"# Deck",
		"4 Lightning Bolt",
		"# Sideboard",
		"2 Pyroclasm",
	].join("\n"));
	assert.equal(parsed.directives.language, "fr");
	assert.equal(parsed.directives.legality, "modern");
	assert.equal(parsed.sections.find((s) => s.kind === "sideboard").entries[0].quantity, 2);
	assert.equal(parsed.totalCards, 4);
	assert.equal(parsed.errors.length, 0);

	const invalid = parseDecklist("language: xx\n4 Lightning Bolt");
	assert.equal(invalid.directives.language, undefined);
	assert.equal(invalid.errors.length, 1);

	const french = parseDecklist("language: fr\n# Deck principal\n4 Lightning Bolt\n# Réserve\n2 Pyroclasm\n# Cartes envisagées\n1 Browbeat");
	assert.equal(french.errors.length, 0);
	assert.equal(french.totalCards, 4);
	assert.deepEqual(french.sections.map((s) => s.kind), ["general", "sideboard", "maybeboard"]);
});

test("localized cache keys distinguish English, French and exact printings", async () => {
	const { localizedPrintingKey } = await loadTypeScript("src/scryfall/localization.ts");
	assert.equal(localizedPrintingKey(canonical, "en", false), null);
	assert.equal(localizedPrintingKey(canonical, "fr", false), "localized:v2:fr:oracle:oracle-123");
	assert.equal(localizedPrintingKey(canonical, "fr", true), "localized:v2:fr:set:m10:123");
	assert.equal(localizedPrintingKey({ ...canonical, oracle_id: undefined }, "fr", true), null);
});

test("localization selects high-resolution French scans and respects language matching", async () => {
	const { bestLocalizedPrint } = await loadTypeScript("src/scryfall/localization.ts");
	const prints = [
		{ ...french, id: "fr-recent", image_status: "lowres" },
		{ ...french, id: "wrong-oracle", oracle_id: "other", image_status: "highres_scan" },
		{ ...french, id: "en-large", lang: "en", image_status: "highres_scan" },
		{ ...french, id: "fr-old", image_status: "highres_scan", highres_image: true },
	];
	assert.equal(bestLocalizedPrint(prints, "fr", "oracle-123").id, "fr-old");
	assert.equal(bestLocalizedPrint(prints.slice(0, 1), "fr", "oracle-123").id, "fr-recent");
	assert.equal(bestLocalizedPrint(prints, "fr", "not-found"), null);
});

test("UI strings and semantic section labels are localized without changing source identifiers", async () => {
	const { t, translatedSection, translatedError } = await loadTypeScript("src/utils/i18n.ts");
	assert.equal(t("fr", "Land"), "Terrain");
	assert.equal(t("fr", "Creature"), "Créature");
	assert.equal(t("fr", "Mana curve"), "Courbe de mana");
	assert.equal(t("fr", "Cards by color"), "Cartes par couleur");
	assert.equal(t("fr", "Loading 0 / {total} cards…", { total: 40 }), "Chargement de 0 / 40 cartes…");
	assert.equal(t("en", "Land"), "Land");
	assert.equal(translatedSection("fr", "Sideboard", "sideboard"), "Réserve");
	assert.equal(translatedSection("fr", "SB", "sideboard"), "Réserve");
	assert.equal(translatedSection("fr", "Lands", "general"), "Terrains");
	assert.equal(translatedSection("fr", "My creatures", "general"), "My creatures");
	assert.equal(translatedError("fr", "Line 4: unknown key \"bad\""), "Ligne 4 : Clé inconnue \"bad\"");
	assert.equal(translatedError("fr", "Deck not found on Moxfield."), "Deck introuvable sur Moxfield.");
});

test("French section headings keep automatic grouping and sideboard classification", async () => {
	const { parseDecklist } = await loadTypeScript("src/parser/decklist-parser.ts");
	const { buildResolvedSections } = await loadTypeScript("src/renderer/grouping.ts");
	const parsed = parseDecklist("language: fr\n# Deck principal\n4 Lightning Bolt\n4 Mountain\n# Réserve\n2 Pyroclasm");
	const resolved = buildResolvedSections(parsed, "respect-manual", "source", {
		byName: (name) => name === "Lightning Bolt"
			? { ...canonical, type_line: "Instant" }
			: name === "Mountain"
				? { ...canonical, type_line: "Basic Land — Mountain" }
				: undefined,
		byPrinting: () => undefined,
	});
	assert.deepEqual(resolved.map((s) => s.title), ["Instant", "Land", "Réserve"]);
	assert.equal(resolved[2].kind, "sideboard");
});

test("PNG preview picks the highest-resolution Scryfall asset when available", async () => {
	const { CardPreview } = await loadTypeScript("src/ui/card-preview.ts");
	const preview = new CardPreview();
	const card = {
		...french,
		image_uris: { small: "small.jpg", normal: "normal.jpg", large: "large.jpg", png: "full.png" },
	};
	assert.equal(preview.pickImageUrl(card, "normal"), "normal.jpg");
	assert.equal(preview.pickImageUrl(card, "large"), "large.jpg");
	assert.equal(preview.pickImageUrl(card, "png"), "full.png");
	assert.equal(preview.pickImageUrl({ ...card, image_uris: { normal: "normal.jpg" } }, "png"), "normal.jpg");
});

test("French combo input keys remain backward compatible with English syntax", async () => {
	const { parseCombo } = await loadTypeScript("src/parser/combo-parser.ts");
	const combo = parseCombo("nom: Combo Piou\nrésultat: victoire\nétapes:\n  - Jouer la créature\nboucle:\n  - Engager\nsortie:\n  - Arrêter");
	assert.equal(combo.name, "Combo Piou");
	assert.equal(combo.result, "victoire");
	assert.equal(combo.steps.length, 1);
	assert.equal(combo.loops[0].loop.length, 1);
	assert.equal(combo.loops[0].breaks.length, 1);
	assert.equal(combo.errors.length, 0);
	const english = parseCombo("name: Untap combo\nsteps:\n  - Cast a spell");
	assert.equal(english.errors.length, 0);
});

test("localized display names fall back safely and handle split cards", async () => {
	const { localizedDisplayName } = await loadTypeScript("src/scryfall/localization.ts");
	assert.equal(localizedDisplayName(canonical), "Lightning Bolt");
	assert.equal(localizedDisplayName(canonical, french), "Foudre");
	assert.equal(localizedDisplayName(canonical, { ...french, printed_name: undefined }), "Lightning Bolt");
	const split = {
		...french,
		printed_name: undefined,
		card_faces: [{ name: "Fire", printed_name: "Feu" }, { name: "Ice", printed_name: "Glace" }],
	};
	assert.equal(localizedDisplayName(canonical, split), "Feu // Glace");
});

test("client prefers exact French printing and caches it without replacing English", async () => {
	const { ScryfallClient } = await loadTypeScript("src/scryfall/client.ts");
	const cache = new Map();
	const absent = new Set();
	const requests = [];
	globalThis.window = { setTimeout };
	globalThis.__testScryfallRequest = async ({ url }) => {
		requests.push(url);
		return { status: 200, json: french, headers: {} };
	};
	const client = new ScryfallClient({
		getByKey: (k) => cache.get(k),
		setByKey: (k, v) => cache.set(k, v),
		hasNotFoundKey: (k) => absent.has(k),
		markNotFoundKey: (k) => absent.add(k),
	});
	assert.equal(client.needsLocalization(canonical, "fr", true), true);
	const localized = await client.fetchLocalizedCard(canonical, "fr", true);
	assert.equal(localized.printed_name, "Foudre");
	assert.equal(client.getLocalizedCard(canonical, "fr", true)?.lang, "fr");
	assert.equal(client.getLocalizedCard(canonical, "en", true), undefined);
	assert.equal(client.needsLocalization(canonical, "fr", true), false);
	assert.match(requests[0], /\/m10\/123\/fr$/);
	assert.equal(requests.length, 1);
	assert.equal(canonical.name, "Lightning Bolt");
});

test("client falls back to another French printing, then English if none exists", async () => {
	const { ScryfallClient } = await loadTypeScript("src/scryfall/client.ts");
	globalThis.window = { setTimeout };
	const cache = new Map();
	const absent = new Set();
	const requests = [];
	globalThis.__testScryfallRequest = async ({ url }) => {
		requests.push(url);
		return url.includes("/search?")
			? { status: 200, json: { data: [french] }, headers: {} }
			: { status: 404, json: {}, headers: {} };
	};
	const client = new ScryfallClient({
		getByKey: (k) => cache.get(k),
		setByKey: (k, v) => cache.set(k, v),
		hasNotFoundKey: (k) => absent.has(k),
		markNotFoundKey: (k) => absent.add(k),
	});
	const result = await client.fetchLocalizedCard(canonical, "fr", true);
	assert.equal(result.printed_name, "Foudre");
	assert.equal(requests.length, 2);
	assert.match(requests[1], /oracleid%3Aoracle-123/);
	assert.match(requests[1], /lang%3Afr/);
	assert.match(requests[1], /include_multilingual=true/);

	const noFrench = { ...canonical, oracle_id: "oracle-missing", id: "en-missing" };
	globalThis.__testScryfallRequest = async () => ({ status: 404, json: {}, headers: {} });
	assert.equal(await client.fetchLocalizedCard(noFrench, "fr"), null);
	assert.equal(client.needsLocalization(noFrench, "fr"), false);
	assert.equal(client.getLocalizedCard(noFrench, "fr"), undefined);
});
