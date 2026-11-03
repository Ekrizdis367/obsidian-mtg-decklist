import { setIcon } from "obsidian";
import type MtgDecklistPlugin from "../main";
import type { ParsedDecklist, RemoteSource } from "../parser/types";
import { renderCardRow } from "./card-row";
import { buildResolvedSections, sectionEntryCount, type ResolvedEntry, type ResolvedSection } from "./grouping";
import { colorIdentityViolations } from "./legality";
import { computeStats, type DeckStats } from "./stats";
import { renderColorIdentityPips } from "../ui/mana-symbols";
import { colorComboName } from "../utils/color-names";
import { moxfieldDeckUrl } from "../moxfield/url";
import { archidektDeckUrl } from "../archidekt/url";
import { printingKey } from "../scryfall/cache";
import { localizedDisplayName, localizedPrintingKey } from "../scryfall/localization";
import type { ScryfallCard } from "../scryfall/types";
import type { CardLanguage, LegalityFormat } from "../settings";
import { t as translateUi, translatedError, translatedSection } from "../utils/i18n";

const COLOR_ORDER = ["W", "U", "B", "R", "G"];

const RENDER_TOKEN_PROP = "__mtgRenderToken";
let renderCounter = 0;

const PROGRESS_RERENDER_MIN_INTERVAL_MS = 4000;
const PROGRESS_RERENDER_MIN_NEW_CARDS = 6;

interface ContainerWithToken extends HTMLElement {
	[RENDER_TOKEN_PROP]?: number;
}

export interface RenderDeckOptions {
	remoteSource?: RemoteSource;
	deckName?: string;
	onRefresh?: () => void;
}

function collectMainDeckCards(sections: ResolvedSection[]): ScryfallCard[] {
	const cards: ScryfallCard[] = [];
	for (const section of sections) {
		if (section.kind === "sideboard" || section.kind === "maybeboard" || section.kind === "commander") {
			continue;
		}
		for (const entry of section.entries) {
			if (entry.card) cards.push(entry.card);
		}
	}
	return cards;
}

export function renderDeckView(
	parsed: ParsedDecklist,
	container: HTMLElement,
	plugin: MtgDecklistPlugin,
	options: RenderDeckOptions = {},
): void {
	container.empty();
	container.addClass("mtg-decklist");
	const cardLanguage: CardLanguage = parsed.directives.language ?? plugin.settings.cardLanguage;

	if (parsed.errors.length > 0) {
		const errBox = container.createDiv({ cls: "mtg-decklist-errors" });
		errBox.createDiv({ cls: "mtg-decklist-errors-title", text: translateUi(cardLanguage, "Decklist parse warnings") });
		for (const err of parsed.errors) {
			errBox.createDiv({
				cls: "mtg-decklist-error",
				text: translateUi(cardLanguage, "Line {number}: {message} ({raw})", {
					number: err.lineNumber,
					message: translatedError(cardLanguage, err.message),
					raw: err.rawLine.trim(),
				}),
			});
		}
	}

	const lookup = {
		byName: (name: string) => plugin.client.getCached(name),
		byPrinting: (set: string, cn: string) => plugin.client.getCachedPrinting(set, cn),
	};

	const groupingMode = parsed.directives.group ?? plugin.settings.groupingMode;
	const sortOrder = parsed.directives.sort ?? plugin.settings.cardSortOrder;
	const legalityFormat: LegalityFormat = parsed.directives.legality ?? plugin.settings.legalityFormat;
	const sections = buildResolvedSections(parsed, groupingMode, sortOrder, lookup);
	const commanderCards = collectCommanderCards(sections);
	const deckColorIdentity = computeDeckColorIdentity(sections, commanderCards);
	const isCommanderDeck = commanderCards.length > 0;

	const violations =
		isCommanderDeck && legalityFormat !== "off"
			? new Map(
					colorIdentityViolations(deckColorIdentity, collectMainDeckCards(sections)).map((v) => [
						v.card.id,
						v.offending,
					]),
				)
			: new Map<string, string[]>();

	for (const c of deckColorIdentity) {
		container.addClass(`mtg-decklist-ci-${c.toLowerCase()}`);
	}
	if (deckColorIdentity.length === 0) {
		container.addClass("mtg-decklist-ci-c");
	}
	if (isCommanderDeck) {
		container.addClass("mtg-decklist-singleton");
	}

	const commanderNames = collectCommanderNames(sections, plugin, cardLanguage);
	renderHeader(container, parsed, plugin, deckColorIdentity, isCommanderDeck, commanderNames, options, cardLanguage);

	const body = container.createDiv({ cls: "mtg-decklist-body" });
	const splitAt = Math.ceil(sections.length / 2);
	const col1 = body.createDiv({ cls: "mtg-decklist-column" });
	const col2 = body.createDiv({ cls: "mtg-decklist-column" });
	sections.forEach((section, i) => {
		renderSection(i < splitAt ? col1 : col2, section, plugin, violations, isCommanderDeck, legalityFormat, cardLanguage);
	});

	if (plugin.settings.showStats) {
		const stats = computeStats(sections);
		renderStats(container, stats, plugin, cardLanguage);
	}

	const token = ++renderCounter;
	(container as ContainerWithToken)[RENDER_TOKEN_PROP] = token;
	void triggerAsyncWork(parsed, container, plugin, sections, options, token);
}

function renderHeader(
	container: HTMLElement,
	parsed: ParsedDecklist,
	plugin: MtgDecklistPlugin,
	deckColorIdentity: string[],
	isCommanderDeck: boolean,
	commanderNames: string[],
	options: RenderDeckOptions,
	language: CardLanguage,
): void {
	const header = container.createDiv({ cls: "mtg-decklist-header" });

	const titleText = options.deckName ?? (commanderNames.length > 0 ? commanderNames.join(" // ") : "");
	if (titleText) {
		const titleRow = header.createDiv({ cls: "mtg-decklist-title-row" });
		const cmdrEl = titleRow.createDiv({ cls: "mtg-decklist-commander-name" });
		cmdrEl.setText(titleText);
		if (options.remoteSource || options.onRefresh) {
			renderRemoteControls(titleRow, options, language);
		}
	} else if (options.remoteSource || options.onRefresh) {
		const titleRow = header.createDiv({ cls: "mtg-decklist-title-row mtg-decklist-title-row-empty" });
		renderRemoteControls(titleRow, options, language);
	}

	const row = header.createDiv({ cls: "mtg-decklist-header-row" });

	const ciStrip = row.createSpan({ cls: "mtg-decklist-ci-strip" });
	renderColorIdentityPips(ciStrip, deckColorIdentity, plugin.symbology, {
		sizeClass: "mtg-mana-symbol-lg",
		emptyAsColorless: true,
	});

	const ciLabel = row.createSpan({ cls: "mtg-decklist-ci-label" });
	ciLabel.setText(formatColorIdentityLabel(deckColorIdentity, isCommanderDeck, language));

	row.createSpan({ cls: "mtg-decklist-total", text: translateUi(language, "{count} cards", { count: parsed.totalCards }) });
}

function renderRemoteControls(parent: HTMLElement, options: RenderDeckOptions, language: CardLanguage): void {
	const controls = parent.createDiv({ cls: "mtg-decklist-remote-controls" });

	if (options.remoteSource) {
		const isArchidekt = options.remoteSource.kind === "archidekt";
		const label = isArchidekt ? "Archidekt" : "Moxfield";
		const link = controls.createEl("a", {
			cls: "mtg-decklist-remote-source",
			href: isArchidekt ? archidektDeckUrl(options.remoteSource.id) : moxfieldDeckUrl(options.remoteSource.id),
			text: label,
		});
		link.setAttribute("target", "_blank");
		link.setAttribute("rel", "noopener");
		link.setAttribute("title", translateUi(language, "{source}: open deck", { source: label }));
	}

	if (options.onRefresh) {
		const btn = controls.createEl("button", { cls: "mtg-decklist-refresh-btn" });
		setIcon(btn, "refresh-cw");
		btn.setAttribute("title", translateUi(language, "Refresh deck from source"));
		btn.setAttribute("aria-label", translateUi(language, "Refresh deck from source"));
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			options.onRefresh?.();
		});
	}
}

function collectCommanderCards(sections: ResolvedSection[]): ScryfallCard[] {
	const commanderSection = sections.find((s) => s.kind === "commander");
	if (!commanderSection) return [];
	const cards: ScryfallCard[] = [];
	for (const { card } of commanderSection.entries) {
		if (card) cards.push(card);
	}
	return cards;
}

function collectCommanderNames(sections: ResolvedSection[], plugin: MtgDecklistPlugin, language: CardLanguage): string[] {
	const commanderSection = sections.find((s) => s.kind === "commander");
	if (!commanderSection) return [];
	return commanderSection.entries.map(({ entry, card }) =>
		card
			? localizedDisplayName(card, plugin.client.getLocalizedCard(card, language, Boolean(entry.set)))
			: entry.name,
	);
}

function unionColorIdentity(cards: ScryfallCard[]): string[] {
	const set = new Set<string>();
	for (const card of cards) {
		for (const c of card.color_identity ?? []) {
			const upper = c.toUpperCase();
			if (COLOR_ORDER.includes(upper)) set.add(upper);
		}
	}
	return COLOR_ORDER.filter((c) => set.has(c));
}

function computeDeckColorIdentity(sections: ResolvedSection[], commanders: ScryfallCard[]): string[] {
	if (commanders.length > 0) {
		return unionColorIdentity(commanders);
	}
	const set = new Set<string>();
	for (const section of sections) {
		if (section.kind === "sideboard" || section.kind === "maybeboard") continue;
		for (const { entry, card } of section.entries) {
			const ci = card?.color_identity ?? entry.hints?.color_identity ?? [];
			for (const c of ci) {
				const upper = c.toUpperCase();
				if (COLOR_ORDER.includes(upper)) set.add(upper);
			}
		}
	}
	return COLOR_ORDER.filter((c) => set.has(c));
}

function formatColorIdentityLabel(colors: string[], isCommanderDeck: boolean, language: CardLanguage): string {
	const combo = translateUi(language, colorComboName(colors));
	return isCommanderDeck ? translateUi(language, "{name} commander", { name: combo }) : combo;
}

function isLandSection(section: ResolvedSection): boolean {
	const titleMatch = /^(lands?|terrains?)$/i.test(section.title.trim());
	const cardsAllLand =
		section.entries.length > 0 &&
		section.entries.every(({ entry, card }) => {
			const tl = card?.type_line ?? entry.hints?.type_line ?? "";
			return tl.toLowerCase().includes("land");
		});
	return titleMatch || cardsAllLand;
}

function renderSection(
	parent: HTMLElement,
	section: ResolvedSection,
	plugin: MtgDecklistPlugin,
	violations: Map<string, string[]>,
	isCommanderDeck: boolean,
	legalityFormat: LegalityFormat,
	language: CardLanguage,
): void {
	const sectionEl = parent.createDiv({ cls: `mtg-section mtg-section-${section.kind}` });
	if (isLandSection(section)) sectionEl.addClass("mtg-section-lands");

	const startCollapsed =
		(section.kind === "sideboard" || section.kind === "maybeboard") && plugin.settings.collapseSideboardByDefault;
	if (startCollapsed) sectionEl.addClass("is-collapsed");

	const headerEl = sectionEl.createDiv({ cls: "mtg-section-header" });
	const caret = headerEl.createSpan({ cls: "mtg-section-caret", text: "\u25BE" });
	headerEl.createSpan({ cls: "mtg-section-title", text: translatedSection(language, section.title, section.kind) });
	headerEl.createSpan({ cls: "mtg-section-count", text: `${sectionEntryCount(section)}` });

	const list = sectionEl.createDiv({ cls: "mtg-section-list" });
	for (const resolved of section.entries) {
		renderCardRow(list, resolved, {
			preview: plugin.preview,
				uiLanguage: language,
			localizedCard: resolved.card
				? plugin.client.getLocalizedCard(resolved.card, language, Boolean(resolved.entry.set))
				: undefined,
			symbology: plugin.symbology,
			hoverDelayMs: plugin.settings.hoverDelayMs,
			imageQuality: plugin.settings.imageQuality,
			legalityFormat,
			colorIdentityViolation: resolved.card ? violations.get(resolved.card.id) : undefined,
			isCommanderDeck,
			registerDom: (target, type, listener) =>
				plugin.registerDomEvent(target as HTMLElement, type as keyof HTMLElementEventMap, listener as EventListener),
		});
	}

	headerEl.addEventListener("click", () => {
		sectionEl.toggleClass("is-collapsed", !sectionEl.hasClass("is-collapsed"));
		caret.setText(sectionEl.hasClass("is-collapsed") ? "\u25B8" : "\u25BE");
	});
	if (startCollapsed) caret.setText("\u25B8");
}

function renderStats(container: HTMLElement, stats: DeckStats, plugin: MtgDecklistPlugin, language: CardLanguage): void {
	const wrap = container.createDiv({ cls: "mtg-stats" });

	if (stats.manaCurve.some((b) => b.count > 0)) {
		const curve = wrap.createDiv({ cls: "mtg-stats-curve" });
		curve.createDiv({ cls: "mtg-stats-title", text: translateUi(language, "Mana curve") });
		const max = Math.max(1, ...stats.manaCurve.map((b) => b.count));
		const bars = curve.createDiv({ cls: "mtg-curve-bars" });
		for (const b of stats.manaCurve) {
			const col = bars.createDiv({ cls: "mtg-curve-col" });
			const barArea = col.createDiv({ cls: "mtg-curve-bar-area" });
			const bar = barArea.createDiv({ cls: "mtg-curve-bar" });
			bar.style.height = `${Math.round((b.count / max) * 100)}%`;
			bar.setAttribute("title", translateUi(language, "{count} card(s)", { count: b.count }));
			col.createDiv({ cls: "mtg-curve-label", text: b.cmc === 7 ? "7+" : `${b.cmc}` });
			col.createDiv({ cls: "mtg-curve-count", text: `${b.count}` });
		}
	}

	if (stats.colors.length > 0) {
		const colorWrap = wrap.createDiv({ cls: "mtg-stats-colors" });
		const body = colorWrap.createDiv({ cls: "mtg-color-body" });

		const legend = body.createDiv({ cls: "mtg-color-legend" });
		for (const c of stats.colors) {
			const item = legend.createDiv({ cls: "mtg-color-legend-item" });
			renderColorIdentityPips(item, [c.color], plugin.symbology, {
				sizeClass: "mtg-mana-symbol-md",
				emptyAsColorless: true,
			});
			item.createSpan({ cls: "mtg-color-legend-count", text: `${c.count}` });
			const label = c.color === "C" ? "colorless" : c.color;
			item.setAttribute("title", translateUi(language, "{count} cards with {color}", { count: c.count, color: translateUi(language, label) }));
		}

		const pieColumn = body.createDiv({ cls: "mtg-color-pie-column" });
			const titleEl = pieColumn.createDiv({ cls: "mtg-stats-title", text: translateUi(language, "Cards by color") });
		titleEl.setAttribute(
			"title",
			translateUi(language, "Number of cards whose color identity includes each color (multicolor cards count toward each of their colors)."),
		);

		const total = stats.colors.reduce((s, c) => s + c.count, 0) || 1;
		const pieWrap = pieColumn.createDiv({ cls: "mtg-color-pie-wrap" });
		const pie = pieWrap.createDiv({ cls: "mtg-color-pie" });
		const stops: string[] = [];
		let cursor = 0;
		for (const c of stats.colors) {
			const start = cursor;
			cursor += (c.count / total) * 100;
			stops.push(`var(--mtg-${c.color.toLowerCase()}) ${start.toFixed(2)}% ${cursor.toFixed(2)}%`);
		}
		pie.setCssStyles({ background: `conic-gradient(${stops.join(", ")})` });
		pie.setAttribute(
			"aria-label",
			stats.colors.map((c) => `${c.color}: ${c.count}`).join(", "),
		);
	}

	if (stats.typeDistribution.length > 0) {
		const typeWrap = wrap.createDiv({ cls: "mtg-stats-types" });
		typeWrap.createDiv({ cls: "mtg-stats-title", text: translateUi(language, "Types") });
		for (const t of stats.typeDistribution) {
			const row = typeWrap.createDiv({ cls: "mtg-type-row" });
			row.createSpan({ cls: "mtg-type-name", text: translateUi(language, t.type) });
			row.createSpan({ cls: "mtg-type-count", text: `${t.count}` });
		}
	}

	if (stats.tagDistribution.length > 0) {
		const tagWrap = wrap.createDiv({ cls: "mtg-stats-tags" });
		tagWrap.createDiv({ cls: "mtg-stats-title", text: translateUi(language, "Roles") });
		for (const t of stats.tagDistribution) {
			const row = tagWrap.createDiv({ cls: "mtg-tag-row" });
			const icon = row.createSpan({ cls: `mtg-tag-icon mtg-card-tag-${t.id}` });
			setIcon(icon, t.icon);
			icon.setAttribute("aria-hidden", "true");
			const name = row.createSpan({ cls: "mtg-tag-name", text: translateUi(language, t.shortLabel) });
			name.setAttribute("title", translateUi(language, t.label));
			row.createSpan({ cls: "mtg-tag-count", text: `${t.count}` });
		}
	}
}

function collectPendingEntries(sections: ResolvedSection[]): ResolvedEntry[] {
	const out: ResolvedEntry[] = [];
	const seen = new Set<string>();
	for (const s of sections) {
		for (const e of s.entries) {
			if (e.card) continue;
			// Dedupe by printing key when present, otherwise by name.
			const key =
				e.entry.set && e.entry.collectorNumber
					? printingKey(e.entry.set, e.entry.collectorNumber)
					: e.entry.name.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(e);
		}
	}
	return out;
}

interface LocalizationJob {
	card: ScryfallCard;
	preferExactPrinting: boolean;
}

function collectPendingLocalizedCards(
	sections: ResolvedSection[],
	plugin: MtgDecklistPlugin,
	language: CardLanguage,
): LocalizationJob[] {
	const jobs: LocalizationJob[] = [];
	const seen = new Set<string>();
	for (const section of sections) {
		for (const { entry, card } of section.entries) {
			if (!card) continue;
			const preferExactPrinting = Boolean(entry.set && entry.collectorNumber);
			const key = localizedPrintingKey(card, language, preferExactPrinting);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			if (plugin.client.needsLocalization(card, language, preferExactPrinting)) {
				jobs.push({ card, preferExactPrinting });
			}
		}
	}
	return jobs;
}

async function triggerAsyncWork(
	parsed: ParsedDecklist,
	container: HTMLElement,
	plugin: MtgDecklistPlugin,
	sections: ResolvedSection[],
	options: RenderDeckOptions,
	token: number,
): Promise<void> {
	const isCancelled = () => (container as ContainerWithToken)[RENDER_TOKEN_PROP] !== token;

	const symbologyMissing = !plugin.symbology.hasAny();
	const pending = collectPendingEntries(sections);
	const language = parsed.directives.language ?? plugin.settings.cardLanguage;
	const localizations = collectPendingLocalizedCards(sections, plugin, language);
	if (!symbologyMissing && pending.length === 0 && localizations.length === 0) return;

	let changed = false;
	if (symbologyMissing) {
		const ok = await plugin.ensureSymbologyLoaded();
		if (isCancelled()) return;
		if (ok) changed = true;
	}

	if (pending.length === 0) {
		if (changed) {
			await plugin.persistCacheIfDirty();
			if (!isCancelled()) renderDeckView(parsed, container, plugin, options);
			return;
		}
		if (localizations.length > 0) {
			await localizePendingCards(parsed, container, plugin, localizations, options, isCancelled);
		}
		return;
	}

	const banner = renderCardLoadingBanner(container, pending.length, language);

	let attempts = 0;
	let successes = 0;
	const startedAt = Date.now();

	for (const pendingEntry of pending) {
		if (isCancelled()) return;
		const e = pendingEntry.entry;
		const card =
			e.set && e.collectorNumber
				? await plugin.client.fetchCardBySet(e.set, e.collectorNumber)
				: await plugin.client.fetchCardByName(e.name);
		if (isCancelled()) return;
		attempts++;
		if (card) {
			successes++;
			changed = true;
		}
		updateCardLoadingBanner(banner, successes, pending.length, attempts, language);

		const remaining = pending.length - successes;
		const elapsed = Date.now() - startedAt;
		if (
			remaining > 0 &&
			successes >= PROGRESS_RERENDER_MIN_NEW_CARDS &&
			elapsed >= PROGRESS_RERENDER_MIN_INTERVAL_MS
		) {
			await plugin.persistCacheIfDirty();
			if (isCancelled()) return;
			renderDeckView(parsed, container, plugin, options);
			return;
		}
	}

	if (changed) {
		await plugin.persistCacheIfDirty();
		if (!isCancelled()) renderDeckView(parsed, container, plugin, options);
		return;
	}

	banner.remove();
	if (localizations.length > 0) {
		await localizePendingCards(parsed, container, plugin, localizations, options, isCancelled);
	}
}

async function localizePendingCards(
	parsed: ParsedDecklist,
	container: HTMLElement,
	plugin: MtgDecklistPlugin,
	jobs: LocalizationJob[],
	options: RenderDeckOptions,
	isCancelled: () => boolean,
): Promise<void> {
	const banner = renderCardLoadingBanner(container, jobs.length, parsed.directives.language ?? plugin.settings.cardLanguage);
	let loaded = 0;
	let completed = 0;
	const language = parsed.directives.language ?? plugin.settings.cardLanguage;
	const startedAt = Date.now();
	banner.label.setText(translateUi(language, "Localizing 0 / {total} cards…", { total: jobs.length }));

	for (const job of jobs) {
		if (isCancelled()) return;
		const translated = await plugin.client.fetchLocalizedCard(job.card, language, job.preferExactPrinting);
		if (isCancelled()) return;
		completed++;
		if (translated) loaded++;
		banner.label.setText(translateUi(language, "Localizing {loaded} / {total} cards…", { loaded: completed, total: jobs.length }));
		if (
			loaded >= PROGRESS_RERENDER_MIN_NEW_CARDS &&
			Date.now() - startedAt >= PROGRESS_RERENDER_MIN_INTERVAL_MS
		) {
			await plugin.persistCacheIfDirty();
			if (!isCancelled()) renderDeckView(parsed, container, plugin, options);
			return;
		}
	}

	if (loaded > 0) {
		await plugin.persistCacheIfDirty();
		if (!isCancelled()) renderDeckView(parsed, container, plugin, options);
	} else {
		banner.remove();
	}
}

interface CardLoadingBanner {
	root: HTMLElement;
	label: HTMLElement;
	remove(): void;
}

function renderCardLoadingBanner(container: HTMLElement, total: number, language: CardLanguage): CardLoadingBanner {
	const root = createDiv({ cls: "mtg-decklist-card-loading" });
	const spinner = root.createSpan({ cls: "mtg-decklist-loading-spinner" });
	setIcon(spinner, "loader-2");
	const label = root.createSpan({
		cls: "mtg-decklist-card-loading-label",
		text: translateUi(language, "Loading 0 / {total} cards…", { total }),
	});

	const header = container.querySelector(".mtg-decklist-header");
	if (header && header.parentElement === container) {
		container.insertBefore(root, header.nextSibling);
	} else {
		container.prepend(root);
	}

	return {
		root,
		label,
		remove: () => root.remove(),
	};
}

function updateCardLoadingBanner(
	banner: CardLoadingBanner,
	successes: number,
	total: number,
	attempts: number,
	language: CardLanguage,
): void {
	const remaining = total - successes;
	if (remaining <= 0) {
		banner.label.textContent = translateUi(language, "Loaded {count} cards", { count: total });
		return;
	}
	const failed = attempts - successes;
	const base = translateUi(language, "Loading {loaded} / {total} cards…", { loaded: successes, total });
	banner.label.textContent = failed > 0 ? `${base} ${translateUi(language, "({count} unavailable)", { count: failed })}` : base;
}
