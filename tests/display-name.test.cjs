const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTypeScript } = require("./helpers/load-ts.cjs");

let displayCardName;
let localizedCardName;

test.before(async () => {
	({ displayCardName, localizedCardName } = await loadTypeScript("src/utils/display-name.ts"));
});

/** English printing, as /cards/named returns it for an English name. */
const englishBolt = {
	id: "en-bolt",
	name: "Lightning Bolt",
	lang: "en",
};

/** French printing, as /cards/named returns it for "Foudre". */
const frenchBolt = {
	id: "fr-bolt",
	name: "Lightning Bolt",
	printed_name: "Foudre",
	lang: "fr",
};

const englishFireIce = {
	id: "en-fire-ice",
	name: "Fire // Ice",
	lang: "en",
	card_faces: [{ name: "Fire" }, { name: "Ice" }],
};

const russianSculptor = {
	id: "ru-sculptor",
	name: "Torrent Sculptor // Flamethrower Sonata",
	lang: "ru",
	card_faces: [
		{ name: "Torrent Sculptor", printed_name: "Скульптор Течения" },
		{ name: "Flamethrower Sonata", printed_name: "Огнеметная Соната" },
	],
};

test("unresolved card shows the typed name", () => {
	assert.equal(displayCardName("Lightnin Bolt", null), "Lightnin Bolt");
});

test("English printing shows Scryfall's name, correcting the source text", () => {
	assert.equal(displayCardName("Lightnin Bolt", englishBolt), "Lightning Bolt");
	assert.equal(displayCardName("lightning bolt", englishBolt), "Lightning Bolt");
});

test("non-English single-faced printing shows printed_name", () => {
	assert.equal(displayCardName("foudre", frenchBolt), "Foudre");
	assert.equal(displayCardName("Foudre", frenchBolt), "Foudre");
});

test("English multi-faced card keeps the full name when one face is typed", () => {
	assert.equal(displayCardName("Fire", englishFireIce), "Fire // Ice");
	assert.equal(displayCardName("Fire // Ice", englishFireIce), "Fire // Ice");
});

test("non-English multi-faced card shows the full printed name when one face is typed", () => {
	const full = "Скульптор Течения // Огнеметная Соната";
	assert.equal(displayCardName("Скульптор Течения", russianSculptor), full);
	assert.equal(displayCardName(full, russianSculptor), full);
});

test("localizedCardName follows the same rule for tooltips and preview alt text", () => {
	assert.equal(localizedCardName(englishBolt), "Lightning Bolt");
	assert.equal(localizedCardName(englishFireIce), "Fire // Ice");
	assert.equal(localizedCardName(frenchBolt), "Foudre");
	assert.equal(localizedCardName(russianSculptor), "Скульптор Течения // Огнеметная Соната");
});
