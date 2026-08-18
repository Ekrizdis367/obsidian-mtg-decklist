import type { MarkdownPostProcessorContext } from "obsidian";
import { setIcon } from "obsidian";
import type MtgDecklistPlugin from "../main";
import { parseDecklist } from "../parser/decklist-parser";
import type { ParsedDecklist, RemoteSource } from "../parser/types";
import { renderDeckView } from "./deck-view";
import { applyTagOverlay, collectTagOverlay, translateMoxfieldDeck } from "../moxfield/translator";
import { MoxfieldFetchError } from "../moxfield/types";
import { moxfieldDeckUrl } from "../moxfield/url";
import { translateArchidektDeck } from "../archidekt/translator";
import { ArchidektFetchError } from "../archidekt/types";
import { archidektDeckUrl } from "../archidekt/url";

export function createDecklistProcessor(plugin: MtgDecklistPlugin) {
	return (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext): void => {
		const parsed = parseDecklist(source);
		if (parsed.remoteSource) {
			void renderRemoteDeck(parsed, parsed.remoteSource, el, plugin);
			return;
		}
		renderDeckView(parsed, el, plugin);
	};
}

async function renderRemoteDeck(
	parsedShell: ParsedDecklist,
	source: RemoteSource,
	container: HTMLElement,
	plugin: MtgDecklistPlugin,
	options: { force?: boolean } = {},
): Promise<void> {
	container.empty();
	container.addClass("mtg-decklist", "mtg-decklist-remote");

	if (parsedShell.errors.length > 0) {
		const errBox = container.createDiv({ cls: "mtg-decklist-errors" });
		errBox.createDiv({ cls: "mtg-decklist-errors-title", text: "Decklist parse warnings" });
		for (const err of parsedShell.errors) {
			errBox.createDiv({
				cls: "mtg-decklist-error",
				text: `Line ${err.lineNumber}: ${err.message} (${err.rawLine.trim()})`,
			});
		}
	}

	renderRemoteLoadingState(container, source);

	try {
		const { translated, deckName } = await fetchAndTranslate(source, plugin, options.force === true);
		await plugin.persistCacheIfDirty();

		const overlay = collectTagOverlay(parsedShell);
		const overlayResult = applyTagOverlay(translated, overlay);

		const sourceLabel = source.kind === "archidekt" ? "Archidekt" : "Moxfield";
		const overlayWarnings = overlayResult.unmatched.map((name) => ({
			lineNumber: 0,
			rawLine: name,
			message: `Tag annotation for "${name}" did not match any card in the ${sourceLabel} deck.`,
		}));

		const merged: ParsedDecklist = {
			...translated,
			errors: [...translated.errors, ...parsedShell.errors, ...overlayWarnings],
			directives: { ...parsedShell.directives },
			remoteSource: source,
		};

		renderDeckView(merged, container, plugin, {
			remoteSource: source,
			deckName,
			onRefresh: () => {
				void renderRemoteDeck(parsedShell, source, container, plugin, { force: true });
			},
		});
	} catch (err) {
		renderRemoteError(container, source, err, () => {
			void renderRemoteDeck(parsedShell, source, container, plugin, { force: true });
		});
	}
}

async function fetchAndTranslate(
	source: RemoteSource,
	plugin: MtgDecklistPlugin,
	force: boolean,
): Promise<{ translated: ParsedDecklist; deckName?: string }> {
	if (source.kind === "archidekt") {
		const deck = await plugin.archidekt.fetch(source.id, { force, ttlMs: archidektTtlMs(plugin) });
		return { translated: translateArchidektDeck(deck), deckName: deck.name };
	}
	const deck = await plugin.moxfield.fetch(source.id, { force, ttlMs: moxfieldTtlMs(plugin) });
	return { translated: translateMoxfieldDeck(deck), deckName: deck.name };
}

function renderRemoteLoadingState(container: HTMLElement, source: RemoteSource): void {
	const wrap = container.createDiv({ cls: "mtg-decklist-loading-state" });
	const spinner = wrap.createSpan({ cls: "mtg-decklist-loading-spinner" });
	setIcon(spinner, "loader");
	const text = wrap.createSpan({ cls: "mtg-decklist-loading-text" });
	const sourceLabel = source.kind === "archidekt" ? "Archidekt" : "Moxfield";
	text.setText(`Loading deck from ${sourceLabel} (${source.id})…`);
}

function renderRemoteError(
	container: HTMLElement,
	source: RemoteSource,
	err: unknown,
	onRetry: () => void,
): void {
	container.empty();
	container.addClass("mtg-decklist", "mtg-decklist-remote", "mtg-decklist-remote-error");

	const sourceLabel = source.kind === "archidekt" ? "Archidekt" : "Moxfield";

	const box = container.createDiv({ cls: "mtg-decklist-remote-error-box" });
	const head = box.createDiv({ cls: "mtg-decklist-remote-error-head" });
	const icon = head.createSpan({ cls: "mtg-decklist-remote-error-icon" });
	setIcon(icon, "triangle-alert");
	head.createSpan({ cls: "mtg-decklist-remote-error-title", text: `Couldn't load ${sourceLabel} deck` });

	const detail =
		err instanceof MoxfieldFetchError || err instanceof ArchidektFetchError
			? err.message
			: err instanceof Error
				? err.message
				: String(err);
	box.createDiv({ cls: "mtg-decklist-remote-error-detail", text: detail });

	const meta = box.createDiv({ cls: "mtg-decklist-remote-error-meta" });
	const link = meta.createEl("a", {
		text: `${sourceLabel}: open deck`,
		href: source.kind === "archidekt" ? archidektDeckUrl(source.id) : moxfieldDeckUrl(source.id),
	});
	link.setAttribute("target", "_blank");
	link.setAttribute("rel", "noopener");

	const retryBtn = meta.createEl("button", { cls: "mtg-decklist-remote-error-retry", text: "Retry" });
	retryBtn.addEventListener("click", () => onRetry());
}

function moxfieldTtlMs(plugin: MtgDecklistPlugin): number {
	const minutes = plugin.settings.moxfieldCacheTtlMinutes;
	const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 360;
	return safe * 60 * 1000;
}

function archidektTtlMs(plugin: MtgDecklistPlugin): number {
	const minutes = plugin.settings.archidektCacheTtlMinutes;
	const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 360;
	return safe * 60 * 1000;
}
