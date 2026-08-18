import { Editor, MarkdownView, Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, MtgDecklistSettingTab, type MtgDecklistSettings } from "./settings";
import { CardCache } from "./scryfall/cache";
import { ScryfallClient } from "./scryfall/client";
import { SymbologyClient, type ScryfallSymbol } from "./scryfall/symbology";
import { CardPreview } from "./ui/card-preview";
import { createDecklistProcessor } from "./renderer/decklist-renderer";
import { createComboProcessor } from "./renderer/combo-renderer";
import { registerInlineProcessor } from "./renderer/inline-processor";
import { createInlineEditorExtension } from "./renderer/inline-cm-extension";
import { COMBO_BLOCK_LANG, DECKLIST_BLOCK_LANG } from "./utils/constants";
import { parseDecklist } from "./parser/decklist-parser";
import { toArenaImport, toMoxfieldText } from "./renderer/exporters";
import type { CachedCardEntry } from "./scryfall/types";
import { MoxfieldClient } from "./moxfield/client";
import type { CachedMoxfieldDeck } from "./moxfield/types";
import { extractMoxfieldId } from "./moxfield/url";
import { ArchidektClient } from "./archidekt/client";
import type { CachedArchidektDeck } from "./archidekt/types";
import { extractArchidektId } from "./archidekt/url";
import { DeckExportModal } from "./ui/deck-export-modal";

interface PersistedData {
	settings: MtgDecklistSettings;
	cache: Record<string, CachedCardEntry>;
	symbology?: Record<string, ScryfallSymbol>;
	moxfield?: Record<string, CachedMoxfieldDeck>;
	archidekt?: Record<string, CachedArchidektDeck>;
}

export default class MtgDecklistPlugin extends Plugin {
	settings!: MtgDecklistSettings;
	cardCache!: CardCache;
	client!: ScryfallClient;
	symbology!: SymbologyClient;
	preview!: CardPreview;
	moxfield!: MoxfieldClient;
	archidekt!: ArchidektClient;

	async onload(): Promise<void> {
		const data = (await this.loadData()) as Partial<PersistedData> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
		this.cardCache = new CardCache(data?.cache ?? {});
		this.symbology = new SymbologyClient(data?.symbology ?? {});
		this.client = new ScryfallClient(this.cardCache);
		this.moxfield = new MoxfieldClient(data?.moxfield ?? {});
		this.archidekt = new ArchidektClient(data?.archidekt ?? {});
		this.preview = new CardPreview();

		this.registerMarkdownCodeBlockProcessor(DECKLIST_BLOCK_LANG, createDecklistProcessor(this));
		this.registerMarkdownCodeBlockProcessor(COMBO_BLOCK_LANG, createComboProcessor(this));
		registerInlineProcessor(this);
		this.registerEditorExtension(createInlineEditorExtension(this));

		this.addSettingTab(new MtgDecklistSettingTab(this.app, this));

		if (!this.symbology.hasAny()) {
			void this.ensureSymbologyLoaded();
		}

		this.addCommand({
			id: "clear-card-cache",
			name: "Clear card cache",
			callback: async () => {
				await this.clearCardCache();
				new Notice("Card cache cleared");
			},
		});

		this.addCommand({
			id: "insert-decklist-template",
			name: "Insert decklist template at cursor",
			editorCallback: (editor: Editor, _view: MarkdownView) => {
				editor.replaceSelection(DECKLIST_TEMPLATE);
			},
		});

		this.addCommand({
			id: "copy-decklist-as-moxfield",
			name: "Moxfield: export decklist under cursor as text",
			editorCheckCallback: (checking, editor) =>
				this.exportDecklistUnderCursor(editor, checking, (parsed) => toMoxfieldText(parsed), "Moxfield export"),
		});

		this.addCommand({
			id: "copy-decklist-as-arena",
			name: "Arena: export decklist under cursor as import",
			editorCheckCallback: (checking, editor) =>
				this.exportDecklistUnderCursor(editor, checking, (parsed) => toArenaImport(parsed), "Arena export"),
		});

		this.addCommand({
			id: "refresh-moxfield-deck",
			name: "Moxfield: refresh deck under cursor",
			editorCheckCallback: (checking, editor) => this.refreshMoxfieldUnderCursor(editor, checking),
		});

		this.addCommand({
			id: "clear-moxfield-cache",
			name: "Moxfield: clear deck cache",
			callback: async () => {
				await this.clearMoxfieldCache();
				new Notice("Moxfield cache cleared");
			},
		});

		this.addCommand({
			id: "refresh-archidekt-deck",
			name: "Archidekt: refresh deck under cursor",
			editorCheckCallback: (checking, editor) => this.refreshArchidektUnderCursor(editor, checking),
		});

		this.addCommand({
			id: "clear-archidekt-cache",
			name: "Archidekt: clear deck cache",
			callback: async () => {
				await this.clearArchidektCache();
				new Notice("Archidekt cache cleared");
			},
		});
	}

	onunload(): void {
		this.preview?.destroy();
	}

	async saveSettings(): Promise<void> {
		await this.persist();
	}

	async persistCacheIfDirty(): Promise<void> {
		const cardDirty = this.cardCache.consumeDirty();
		const symDirty = this.symbology.consumeDirty();
		const moxDirty = this.moxfield.consumeDirty();
		const archiDirty = this.archidekt.consumeDirty();
		if (cardDirty || symDirty || moxDirty || archiDirty) {
			await this.persist();
		}
	}

	async clearCardCache(): Promise<void> {
		this.cardCache.clear();
		await this.persist();
	}

	async clearMoxfieldCache(): Promise<void> {
		this.moxfield.clear();
		await this.persist();
	}

	async clearArchidektCache(): Promise<void> {
		this.archidekt.clear();
		await this.persist();
	}

	async ensureSymbologyLoaded(): Promise<boolean> {
		const loaded = await this.symbology.ensureLoaded();
		await this.persistCacheIfDirty();
		return loaded;
	}

	private async persist(): Promise<void> {
		const data: PersistedData = {
			settings: this.settings,
			cache: this.cardCache.serialize(),
			symbology: this.symbology.serialize(),
			moxfield: this.moxfield.serialize(),
			archidekt: this.archidekt.serialize(),
		};
		await this.saveData(data);
	}

	private refreshMoxfieldUnderCursor(editor: Editor, checking: boolean): boolean {
		const block = findDecklistBlockAroundCursor(editor);
		if (!block) return false;
		const id = findRemoteIdInBlock(block, /^(?:moxfield|source)\s*[:=]\s*(.+)$/i, extractMoxfieldId);
		if (!id) return false;
		if (checking) return true;
		this.moxfield.invalidate(id);
		void this.persist();
		new Notice("Moxfield deck cache cleared. Reopen the note or switch modes to refetch.");
		return true;
	}

	private refreshArchidektUnderCursor(editor: Editor, checking: boolean): boolean {
		const block = findDecklistBlockAroundCursor(editor);
		if (!block) return false;
		const id = findRemoteIdInBlock(block, /^(?:archidekt|source)\s*[:=]\s*(.+)$/i, extractArchidektId);
		if (!id) return false;
		if (checking) return true;
		this.archidekt.invalidate(id);
		void this.persist();
		new Notice("Archidekt deck cache cleared. Reopen the note or switch modes to refetch.");
		return true;
	}

	private exportDecklistUnderCursor(
		editor: Editor,
		checking: boolean,
		transform: (parsed: ReturnType<typeof parseDecklist>) => string,
		title: string,
	): boolean {
		const block = findDecklistBlockAroundCursor(editor);
		if (!block) return false;
		if (checking) return true;
		const parsed = parseDecklist(block);
		new DeckExportModal(this.app, title, transform(parsed), editor).open();
		return true;
	}
}

const DECKLIST_TEMPLATE = `\`\`\`decklist
# Commander
1 Atraxa, Praetors' Voice

# Creatures
4 Birds of Paradise

# Lands
10 Forest

# Sideboard
2 Negate
\`\`\`
`;

function findRemoteIdInBlock(
	block: string,
	directiveRe: RegExp,
	extractId: (raw: string) => string | null,
): string | null {
	for (const line of block.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const m = trimmed.match(directiveRe);
		if (m) {
			const id = extractId(m[1] ?? "");
			if (id) return id;
		}
	}
	return null;
}

function findDecklistBlockAroundCursor(editor: Editor): string | null {
	const cursor = editor.getCursor();
	const totalLines = editor.lineCount();

	let start = -1;
	for (let i = cursor.line; i >= 0; i--) {
		const line = editor.getLine(i);
		if (/^```\s*decklist\s*$/i.test(line)) {
			start = i;
			break;
		}
		if (/^```/.test(line) && i !== cursor.line) {
			return null;
		}
	}
	if (start === -1) return null;

	let end = -1;
	for (let i = start + 1; i < totalLines; i++) {
		const line = editor.getLine(i);
		if (/^```\s*$/.test(line)) {
			end = i;
			break;
		}
	}
	if (end === -1) return null;
	if (cursor.line < start || cursor.line > end) return null;

	const lines: string[] = [];
	for (let i = start + 1; i < end; i++) {
		lines.push(editor.getLine(i));
	}
	return lines.join("\n");
}
