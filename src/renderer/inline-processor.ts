import { useTouchCardUi } from "../utils/touch-ui";
import type MtgDecklistPlugin from "../main";
import { renderManaCost } from "../ui/mana-symbols";
import { debounce } from "../utils/debounce";
import type { ScryfallCard } from "../scryfall/types";

const MANA_TOKEN_RE = /\{([A-Za-z0-9/]+)\}/g;
const SKIP_TAGS = new Set(["CODE", "PRE", "SCRIPT", "STYLE", "TEXTAREA", "A"]);
const CARD_PROTOCOL = "mtg:";
const INLINE_CARD_PREFIX = "mtg:";

export function registerInlineProcessor(plugin: MtgDecklistPlugin): void {
	plugin.registerMarkdownPostProcessor((el) => {
		if (el.closest(".mtg-decklist")) return;

		if (plugin.settings.inlineCardLinks) {
			processInlineCardCodes(el, plugin);
			processInlineCardLinks(el, plugin);
		}

		if (plugin.settings.inlineManaSymbols) {
			processManaInTextNodes(el, plugin);
		}
	});
}

function processManaInTextNodes(root: HTMLElement, plugin: MtgDecklistPlugin): void {
	const walker = activeDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const text = node.nodeValue;
			if (!text || text.indexOf("{") === -1) return NodeFilter.FILTER_REJECT;
			const parent = node.parentElement;
			if (!parent || isSkippedAncestor(parent)) return NodeFilter.FILTER_REJECT;
			MANA_TOKEN_RE.lastIndex = 0;
			return MANA_TOKEN_RE.test(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
		},
	});

	const targets: Text[] = [];
	let n: Node | null;
	while ((n = walker.nextNode())) targets.push(n as Text);

	for (const text of targets) replaceTextNodeWithMana(text, plugin);
}

function isSkippedAncestor(el: HTMLElement): boolean {
	let cur: HTMLElement | null = el;
	while (cur) {
		if (SKIP_TAGS.has(cur.tagName)) return true;
		if (cur.classList?.contains("mtg-decklist")) return true;
		if (cur.classList?.contains("mtg-inline-card")) return true;
		if (cur.classList?.contains("mtg-inline-mana")) return true;
		cur = cur.parentElement;
	}
	return false;
}

function replaceTextNodeWithMana(node: Text, plugin: MtgDecklistPlugin): void {
	const value = node.nodeValue ?? "";
	const frag = createFragment();
	let lastIndex = 0;

	MANA_TOKEN_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = MANA_TOKEN_RE.exec(value)) !== null) {
		if (m.index > lastIndex) {
			frag.appendText(value.slice(lastIndex, m.index));
		}
		const wrapper = frag.createSpan({ cls: "mtg-inline-mana" });
		renderManaCost(wrapper, `{${m[1]}}`, plugin.symbology);
		lastIndex = m.index + m[0].length;
	}

	if (lastIndex === 0) return;

	if (lastIndex < value.length) {
		frag.appendText(value.slice(lastIndex));
	}
	node.replaceWith(frag);
}

function processInlineCardCodes(root: HTMLElement, plugin: MtgDecklistPlugin): void {
	const codes = Array.from(root.querySelectorAll<HTMLElement>("code"));
	for (const code of codes) {
		if (code.closest(".mtg-decklist")) continue;
		if (code.closest("pre")) continue;
		const text = (code.textContent ?? "").trim();
		if (!text.toLowerCase().startsWith(INLINE_CARD_PREFIX)) continue;
		const cardName = text.slice(INLINE_CARD_PREFIX.length).trim();
		if (!cardName) continue;
		const link = createInlineCardLink(cardName, undefined, plugin);
		code.replaceWith(link);
	}
}

function processInlineCardLinks(root: HTMLElement, plugin: MtgDecklistPlugin): void {
	const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>("a"));
	for (const a of anchors) {
		const href = a.getAttribute("href") ?? "";
		if (!href.toLowerCase().startsWith(CARD_PROTOCOL)) continue;
		let cardName = href.slice(CARD_PROTOCOL.length);
		try {
			cardName = decodeURIComponent(cardName);
		} catch {
			// keep raw string if decoding fails
		}
		cardName = cardName.trim();
		if (!cardName) continue;
		const display = a.textContent?.trim() || cardName;
		const link = createInlineCardLink(cardName, display, plugin);
		a.replaceWith(link);
	}
}

export function createInlineCardLink(
	cardName: string,
	displayText: string | undefined,
	plugin: MtgDecklistPlugin,
): HTMLAnchorElement {
	const anchor = createEl("a", {
		cls: "mtg-inline-card",
		text: displayText ?? cardName,
		attr: { href: "#", rel: "noopener" },
	});
	anchor.dataset.cardName = cardName;
	attachCardBehavior(anchor, cardName, plugin);
	return anchor;
}

export function attachCardBehavior(el: HTMLAnchorElement, cardName: string, plugin: MtgDecklistPlugin): void {
	const updateFromCard = (card: ScryfallCard) => {
		el.removeClass("mtg-card-pending");
		if (useTouchCardUi()) {
			el.href = "#";
			el.removeAttribute("target");
			if (card.scryfall_uri) {
				el.dataset.scryfallUri = card.scryfall_uri;
			} else {
				delete el.dataset.scryfallUri;
			}
		} else if (card.scryfall_uri) {
			el.href = card.scryfall_uri;
			el.setAttribute("target", "_blank");
			delete el.dataset.scryfallUri;
		}
		el.setAttribute("title", card.type_line ? `${card.name} — ${card.type_line}` : card.name);
	};

	let cached = plugin.client.getCached(cardName) ?? null;
	if (cached) {
		updateFromCard(cached);
	} else {
		el.addClass("mtg-card-pending");
		el.setAttribute("title", `Loading ${cardName}…`);
	}

	const ensureCard = async (): Promise<ScryfallCard | null> => {
		if (cached) return cached;
		const fetched = await plugin.client.fetchCardByName(cardName);
		if (fetched) {
			cached = fetched;
			updateFromCard(fetched);
			await plugin.persistCacheIfDirty();
		} else {
			el.removeClass("mtg-card-pending");
			el.addClass("mtg-card-not-found");
			el.setAttribute("title", `Card not found: ${cardName}`);
		}
		return cached;
	};

	if (useTouchCardUi()) {
		el.addEventListener("click", (ev) => {
			ev.preventDefault();
			void ensureCard().then((card) => {
				if (card) plugin.preview.show(card, el, plugin.settings.imageQuality);
			});
		});
	} else {
		const debounced = debounce(() => {
			void ensureCard().then((card) => {
				if (card) plugin.preview.show(card, el, plugin.settings.imageQuality);
			});
		}, plugin.settings.hoverDelayMs);
		el.addEventListener("mouseenter", () => debounced.call());
		el.addEventListener("mouseleave", () => {
			debounced.cancel();
			plugin.preview.hide();
		});
		el.addEventListener("click", (ev) => {
			if (!cached) {
				ev.preventDefault();
				void ensureCard();
			}
		});
	}
}
