import { App, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type MtgDecklistPlugin from "./main";
import { ARCHIDEKT_DEFAULT_TTL_MINUTES, MOXFIELD_DEFAULT_TTL_MINUTES } from "./utils/constants";
import { t } from "./utils/i18n";

export type GroupingMode = "auto" | "manual" | "respect-manual";
export type CardSortOrder = "source" | "name" | "cmc-name";
export type ImageQuality = "small" | "normal" | "large" | "png";
export type CardLanguage = "en" | "fr";
export type LegalityFormat =
	| "off"
	| "standard"
	| "pioneer"
	| "modern"
	| "legacy"
	| "vintage"
	| "pauper"
	| "commander"
	| "brawl";

export interface MtgDecklistSettings {
	groupingMode: GroupingMode;
	cardSortOrder: CardSortOrder;
	imageQuality: ImageQuality;
	cardLanguage: CardLanguage;
	hoverDelayMs: number;
	legalityFormat: LegalityFormat;
	showStats: boolean;
	collapseSideboardByDefault: boolean;
	inlineManaSymbols: boolean;
	inlineCardLinks: boolean;
	moxfieldCacheTtlMinutes: number;
	archidektCacheTtlMinutes: number;
}

export const DEFAULT_SETTINGS: MtgDecklistSettings = {
	groupingMode: "respect-manual",
	cardSortOrder: "name",
	imageQuality: "normal",
	cardLanguage: "en",
	hoverDelayMs: 200,
	legalityFormat: "off",
	showStats: true,
	collapseSideboardByDefault: true,
	inlineManaSymbols: true,
	inlineCardLinks: true,
	moxfieldCacheTtlMinutes: MOXFIELD_DEFAULT_TTL_MINUTES,
	archidektCacheTtlMinutes: ARCHIDEKT_DEFAULT_TTL_MINUTES,
};

export class MtgDecklistSettingTab extends PluginSettingTab {
	plugin: MtgDecklistPlugin;

	constructor(app: App, plugin: MtgDecklistPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const plugin = this.plugin;
		const lang = plugin.settings.cardLanguage;
		const tr = (message: string, values: Record<string, string | number> = {}) => t(lang, message, values);

		const cardLinkDesc = createFragment();
		cardLinkDesc.appendText(tr("Render `mtg:Card Name` and [Display](mtg:Card Name) as hoverable card links. "));
		cardLinkDesc.createEl("strong", { text: tr("Tip: ") });
		cardLinkDesc.appendText(
			tr("Desktop: hover to preview the image; click the link to open in browser. Mobile: tap for preview only, then tap open in browser in the overlay to open the site."),
		);

		return [
			{
				type: "group",
				heading: tr("Rendering"),
				items: [
					{
						name: tr("Grouping mode"),
						desc: tr("How to group cards. Auto groups by card type. Manual uses your # section headers. Respect-manual uses your headers when present and otherwise falls back to auto-grouping."),
						render: (setting) => {
							setting.addDropdown((dd) =>
								dd
									.addOption("respect-manual", tr("Respect manual, fall back to auto"))
									.addOption("auto", tr("Auto (by card type)"))
									.addOption("manual", tr("Manual (only your headers)"))
									.setValue(plugin.settings.groupingMode)
									.onChange(async (value) => {
										plugin.settings.groupingMode = value as GroupingMode;
										await plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: tr("Sort within group"),
						desc: tr("Order cards inside each section. Source keeps the order you typed."),
						render: (setting) => {
							setting.addDropdown((dd) =>
								dd
									.addOption("name", tr("Name (alphabetical)"))
									.addOption("cmc-name", tr("Mana value, then name"))
									.addOption("source", tr("Source (as typed)"))
									.setValue(plugin.settings.cardSortOrder)
									.onChange(async (value) => {
										plugin.settings.cardSortOrder = value as CardSortOrder;
										await plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: tr("Card language"),
						desc: tr("Language for card names and preview images. French prints are used when available, otherwise English is shown. Reopen a note to refresh its decklists."),
						render: (setting) => {
							setting.addDropdown((dd) =>
								dd
									.addOption("en", tr("English (default)"))
									.addOption("fr", "Français")
									.setValue(plugin.settings.cardLanguage)
									.onChange(async (value) => {
										plugin.settings.cardLanguage = value as CardLanguage;
										await plugin.saveSettings();
										this.update();
									}),
							);
						},
					},
					{
						name: tr("Image quality"),
						desc: tr("Size of the card image shown in the hover/tap preview."),
						render: (setting) => {
							setting.addDropdown((dd) =>
								dd
									.addOption("small", tr("Small"))
									.addOption("normal", tr("Normal"))
									.addOption("large", tr("Large"))
									.addOption("png", tr("PNG (highest quality)"))
									.setValue(plugin.settings.imageQuality)
									.onChange(async (value) => {
										plugin.settings.imageQuality = value as ImageQuality;
										await plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: tr("Hover delay (ms)"),
						desc: tr("Delay before showing the card preview on desktop hover."),
						render: (setting) => {
							setting.addText((text) =>
								text
									.setPlaceholder("200")
									.setValue(String(plugin.settings.hoverDelayMs))
									.onChange(async (value) => {
										const n = Number.parseInt(value, 10);
										if (Number.isFinite(n) && n >= 0 && n <= 5000) {
											plugin.settings.hoverDelayMs = n;
											await plugin.saveSettings();
										}
									}),
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: tr("Sections"),
				items: [
					{
						name: tr("Collapse sideboard by default"),
						desc: tr("Sideboard and maybeboard sections start collapsed."),
						render: (setting) => {
							setting.addToggle((tg) =>
								tg
									.setValue(plugin.settings.collapseSideboardByDefault)
									.onChange(async (value) => {
										plugin.settings.collapseSideboardByDefault = value;
										await plugin.saveSettings();
									}),
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: tr("Stats and metadata"),
				items: [
					{
						name: tr("Show deck stats"),
						desc: tr("Display mana curve, color identity, and type distribution."),
						render: (setting) => {
							setting.addToggle((tg) =>
								tg.setValue(plugin.settings.showStats).onChange(async (value) => {
									plugin.settings.showStats = value;
									await plugin.saveSettings();
								}),
							);
						},
					},
					{
						name: tr("Legality warnings"),
						desc: tr("Warn when cards are not legal in the selected format, and (for commander decks) when cards are outside the commanders' color identity. Override per block with a legality: directive."),
						render: (setting) => {
							setting.addDropdown((dd) =>
								dd
									.addOption("off", tr("Off"))
									.addOption("standard", "Standard")
									.addOption("pioneer", "Pioneer")
									.addOption("modern", "Modern")
									.addOption("legacy", "Legacy")
									.addOption("vintage", "Vintage")
									.addOption("pauper", "Pauper")
									.addOption("commander", "Commander")
									.addOption("brawl", "Brawl")
									.setValue(plugin.settings.legalityFormat)
									.onChange(async (value) => {
										plugin.settings.legalityFormat = value as LegalityFormat;
										await plugin.saveSettings();
									}),
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: tr("Inline rendering"),
				items: [
					{
						name: tr("Render inline mana symbols"),
						desc: tr("Replace mana tokens like {R}, {2}{U}, or {W/U} in regular note text with Scryfall icons."),
						render: (setting) => {
							setting.addToggle((tg) =>
								tg.setValue(plugin.settings.inlineManaSymbols).onChange(async (value) => {
									plugin.settings.inlineManaSymbols = value;
									await plugin.saveSettings();
								}),
							);
						},
					},
					{
						name: tr("Render inline card links"),
						desc: cardLinkDesc,
						render: (setting) => {
							setting.addToggle((tg) =>
								tg.setValue(plugin.settings.inlineCardLinks).onChange(async (value) => {
									plugin.settings.inlineCardLinks = value;
									await plugin.saveSettings();
								}),
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: tr("Remote sources"),
				items: [
					{
						name: tr("Moxfield cache lifetime (minutes)"),
						desc: tr("Moxfield decks are cached for this long before being refetched. Use the refresh button on a deck to force a refresh sooner."),
						render: (setting) => {
							setting.addText((text) =>
								text
									.setPlaceholder(`${MOXFIELD_DEFAULT_TTL_MINUTES}`)
									.setValue(String(plugin.settings.moxfieldCacheTtlMinutes))
									.onChange(async (value) => {
										const n = Number.parseInt(value, 10);
										if (Number.isFinite(n) && n >= 1 && n <= 60 * 24 * 30) {
											plugin.settings.moxfieldCacheTtlMinutes = n;
											await plugin.saveSettings();
										}
									}),
							);
						},
					},
					{
						name: tr("Archidekt cache lifetime (minutes)"),
						desc: tr("Archidekt decks are cached for this long before being refetched. Use the refresh button on a deck to force a refresh sooner."),
						render: (setting) => {
							setting.addText((text) =>
								text
									.setPlaceholder(`${ARCHIDEKT_DEFAULT_TTL_MINUTES}`)
									.setValue(String(plugin.settings.archidektCacheTtlMinutes))
									.onChange(async (value) => {
										const n = Number.parseInt(value, 10);
										if (Number.isFinite(n) && n >= 1 && n <= 60 * 24 * 30) {
											plugin.settings.archidektCacheTtlMinutes = n;
											await plugin.saveSettings();
										}
									}),
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: tr("Cache"),
				items: [
					{
						name: tr("Card cache"),
						desc: tr("Cached cards: {count}", { count: plugin.cardCache?.size() ?? 0 }),
						render: (setting) => {
							setting.addButton((btn) =>
								btn
									.setButtonText(tr("Clear cache"))
									.setDestructive()
									.onClick(async () => {
										await plugin.clearCardCache();
										this.update();
									}),
							);
						},
					},
					{
						name: tr("Moxfield deck cache"),
						desc: tr("Cached decks: {count}", { count: plugin.moxfield?.size() ?? 0 }),
						render: (setting) => {
							setting.addButton((btn) =>
								btn
									.setButtonText(tr("Clear cache"))
									.setDestructive()
									.onClick(async () => {
										await plugin.clearMoxfieldCache();
										this.update();
									}),
							);
						},
					},
					{
						name: tr("Archidekt deck cache"),
						desc: tr("Cached decks: {count}", { count: plugin.archidekt?.size() ?? 0 }),
						render: (setting) => {
							setting.addButton((btn) =>
								btn
									.setButtonText(tr("Clear cache"))
									.setDestructive()
									.onClick(async () => {
										await plugin.clearArchidektCache();
										this.update();
									}),
							);
						},
					},
				],
			},
		];
	}
}
