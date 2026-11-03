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
					contents: "export const requestUrl = (options) => globalThis.__testScryfallRequest(options);",
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
});

test("localized cache keys distinguish English, French and exact printings", async () => {
	const { localizedPrintingKey } = await loadTypeScript("src/scryfall/localization.ts");
	assert.equal(localizedPrintingKey(canonical, "en", false), null);
	assert.equal(localizedPrintingKey(canonical, "fr", false), "localized:fr:oracle:oracle-123");
	assert.equal(localizedPrintingKey(canonical, "fr", true), "localized:fr:set:m10:123");
	assert.equal(localizedPrintingKey({ ...canonical, oracle_id: undefined }, "fr", true), null);
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
