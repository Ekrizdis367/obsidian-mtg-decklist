const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTypeScript } = require("./helpers/load-ts.cjs");

let CardCache;
let ScryfallClient;

test.before(async () => {
	({ CardCache } = await loadTypeScript("src/scryfall/cache.ts"));
	({ ScryfallClient } = await loadTypeScript("src/scryfall/client.ts"));
	// ScryfallClient spaces requests with window.setTimeout; fire them at once.
	globalThis.window = { setTimeout: (fn) => queueMicrotask(fn) };
});

test.after(() => {
	delete globalThis.window;
	delete globalThis.__testRequestUrl;
});

/**
 * Answer /cards/named requests from cardsByName, keyed by the fuzzy name in the
 * request URL. Returns the list of names requested, in order.
 */
function stubScryfall(cardsByName) {
	const requested = [];
	globalThis.__testRequestUrl = async (options) => {
		const name = decodeURIComponent(options.url.split("fuzzy=")[1] ?? "");
		requested.push(name);
		if (!cardsByName[name]) {
			return { status: 404, json: {}, headers: {} };
		}
		return { status: 200, json: cardsByName[name], headers: {} };
	};
	return requested;
}

function englishBolt() {
	return {
		id: "en-bolt",
		name: "Lightning Bolt",
		lang: "en",
		scryfall_uri: "https://scryfall.com/card/test-english-bolt",
	};
}

function frenchBolt() {
	return {
		id: "fr-bolt",
		name: "Lightning Bolt",
		printed_name: "Foudre",
		lang: "fr",
		scryfall_uri: "https://scryfall.com/card/test-french-bolt",
	};
}

test("a non-English printing is cached only under the typed name", async () => {
	stubScryfall({ Foudre: frenchBolt() });
	const client = new ScryfallClient(new CardCache());

	const card = await client.fetchCardByName("Foudre");

	assert.equal(card.printed_name, "Foudre");
	assert.equal(client.getCached("Foudre")?.printed_name, "Foudre");
	assert.equal(client.getCached("Lightning Bolt"), undefined);
});

test("an English printing is cached under the typed name and its own name", async () => {
	stubScryfall({ "Lightnin Bolt": englishBolt() });
	const client = new ScryfallClient(new CardCache());

	await client.fetchCardByName("Lightnin Bolt");

	assert.equal(client.getCached("Lightnin Bolt")?.lang, "en");
	assert.equal(client.getCached("Lightning Bolt")?.lang, "en");
});

test("resolving a foreign name does not shadow the English name", async () => {
	const requested = stubScryfall({ Foudre: frenchBolt(), "Lightning Bolt": englishBolt() });
	const client = new ScryfallClient(new CardCache());

	const first = await client.fetchCardByName("Foudre");
	const second = await client.fetchCardByName("Lightning Bolt");

	assert.equal(first.lang, "fr");
	assert.equal(second.lang, "en");
	assert.equal(second.scryfall_uri, englishBolt().scryfall_uri);
	assert.deepEqual(requested, ["Foudre", "Lightning Bolt"]);
	assert.equal(client.getCached("Foudre")?.lang, "fr");
});
