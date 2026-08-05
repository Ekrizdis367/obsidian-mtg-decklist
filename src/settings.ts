import { App, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type MtgDecklistPlugin from "./main";
import { MOXFIELD_DEFAULT_TTL_MINUTES } from "./utils/constants";

export type GroupingMode = "auto" | "manual" | "respect-manual";
export type CardSortOrder = "source" | "name" | "cmc-name";
export type ImageQuality = "small" | "normal" | "large";
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
	hoverDelayMs: number;
	legalityFormat: LegalityFormat;
	showStats: boolean;
	collapseSideboardByDefault: boolean;
	inlineManaSymbols: boolean;
	inlineCardLinks: boolean;
	moxfieldCacheTtlMinutes: number;
}

export const DEFAULT_SETTINGS: MtgDecklistSettings = {
	groupingMode: "respect-manual",
	cardSortOrder: "name",
	imageQuality: "normal",
	hoverDelayMs: 200,
	legalityFormat: "off",
	showStats: true,
	collapseSideboardByDefault: true,
	inlineManaSymbols: true,
	inlineCardLinks: true,
	moxfieldCacheTtlMinutes: MOXFIELD_DEFAULT_TTL_MINUTES,
};

export class MtgDecklistSettingTab extends PluginSettingTab {
	plugin: MtgDecklistPlugin;

	constructor(app: App, plugin: MtgDecklistPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const plugin = this.plugin;

		const cardLinkDesc = createFragment();
		cardLinkDesc.appendText("Render `mtg:Card Name` and [Display](mtg:Card Name) as hoverable card links. ");
		cardLinkDesc.createEl("strong", { text: "Tip: " });
		cardLinkDesc.appendText(
			"Desktop: hover to preview the image; click the link to open in browser. Mobile: tap for preview only, then tap open in browser in the overlay to open the site.",
		);

		return [
			{
				type: "group",
				heading: "Rendering",
				items: [
					{
						name: "Grouping mode",
						desc: "How to group cards. Auto groups by card type. Manual uses your # section headers. Respect-manual uses your headers when present and otherwise falls back to auto-grouping.",
						render: (setting) => {
							setting.addDropdown((dd) =>
								dd
									.addOption("respect-manual", "Respect manual, fall back to auto")
									.addOption("auto", "Auto (by card type)")
									.addOption("manual", "Manual (only your headers)")
									.setValue(plugin.settings.groupingMode)
									.onChange(async (value) => {
										plugin.settings.groupingMode = value as GroupingMode;
										await plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: "Sort within group",
						desc: "Order cards inside each section. Source keeps the order you typed.",
						render: (setting) => {
							setting.addDropdown((dd) =>
								dd
									.addOption("name", "Name (alphabetical)")
									.addOption("cmc-name", "Mana value, then name")
									.addOption("source", "Source (as typed)")
									.setValue(plugin.settings.cardSortOrder)
									.onChange(async (value) => {
										plugin.settings.cardSortOrder = value as CardSortOrder;
										await plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: "Image quality",
						desc: "Size of the card image shown in the hover/tap preview.",
						render: (setting) => {
							setting.addDropdown((dd) =>
								dd
									.addOption("small", "Small")
									.addOption("normal", "Normal")
									.addOption("large", "Large")
									.setValue(plugin.settings.imageQuality)
									.onChange(async (value) => {
										plugin.settings.imageQuality = value as ImageQuality;
										await plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: "Hover delay (ms)",
						desc: "Delay before showing the card preview on desktop hover.",
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
				heading: "Sections",
				items: [
					{
						name: "Collapse sideboard by default",
						desc: "Sideboard and maybeboard sections start collapsed.",
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
				heading: "Stats and metadata",
				items: [
					{
						name: "Show deck stats",
						desc: "Display mana curve, color identity, and type distribution.",
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
						name: "Legality warnings",
						desc: "Warn when cards are not legal in the selected format, and (for commander decks) when cards are outside the commanders' color identity. Override per block with a legality: directive.",
						render: (setting) => {
							setting.addDropdown((dd) =>
								dd
									.addOption("off", "Off")
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
				heading: "Inline rendering",
				items: [
					{
						name: "Render inline mana symbols",
						desc: "Replace mana tokens like {R}, {2}{U}, or {W/U} in regular note text with Scryfall icons.",
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
						name: "Render inline card links",
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
				heading: "Remote sources",
				items: [
					{
						name: "Moxfield cache lifetime (minutes)",
						desc: "Moxfield decks are cached for this long before being refetched. Use the refresh button on a deck to force a refresh sooner.",
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
				],
			},
			{
				type: "group",
				heading: "Cache",
				items: [
					{
						name: "Card cache",
						desc: `Cached cards: ${plugin.cardCache?.size() ?? 0}`,
						render: (setting) => {
							setting.addButton((btn) =>
								btn
									.setButtonText("Clear cache")
									.setDestructive()
									.onClick(async () => {
										await plugin.clearCardCache();
										this.update();
									}),
							);
						},
					},
					{
						name: "Moxfield deck cache",
						desc: `Cached decks: ${plugin.moxfield?.size() ?? 0}`,
						render: (setting) => {
							setting.addButton((btn) =>
								btn
									.setButtonText("Clear cache")
									.setDestructive()
									.onClick(async () => {
										await plugin.clearMoxfieldCache();
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
