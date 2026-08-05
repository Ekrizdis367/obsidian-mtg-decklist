import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	type PluginValue,
	type ViewUpdate,
	ViewPlugin,
	WidgetType,
} from "@codemirror/view";
import type MtgDecklistPlugin from "../main";
import { createInlineCardLink } from "./inline-processor";
import { renderManaCost } from "../ui/mana-symbols";

const MANA_TOKEN_RE = /\{([A-Za-z0-9/]+)\}/g;
const INLINE_CARD_CODE_RE = /^`mtg:([^`]+)`/i;
const MD_LINK_CARD_RE = /\[([^\]\n]+)\]\(mtg:([^)]+)\)/gi;

class ManaWidget extends WidgetType {
	constructor(
		private readonly token: string,
		private readonly plugin: MtgDecklistPlugin,
	) {
		super();
	}

	toDOM(): HTMLElement {
		const span = createSpan({ cls: "mtg-inline-mana" });
		renderManaCost(span, `{${this.token}}`, this.plugin.symbology);
		return span;
	}

	eq(other: WidgetType): boolean {
		return other instanceof ManaWidget && other.token === this.token;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

class InlineCardWidget extends WidgetType {
	constructor(
		private readonly cardName: string,
		private readonly displayText: string,
		private readonly plugin: MtgDecklistPlugin,
	) {
		super();
	}

	toDOM(): HTMLElement {
		return createInlineCardLink(this.cardName, this.displayText, this.plugin);
	}

	eq(other: WidgetType): boolean {
		return (
			other instanceof InlineCardWidget &&
			other.cardName === this.cardName &&
			other.displayText === this.displayText
		);
	}

	ignoreEvent(): boolean {
		return false;
	}
}

interface CodeRange {
	from: number;
	to: number;
	kind: "fenced" | "inline";
}

export function createInlineEditorExtension(plugin: MtgDecklistPlugin) {
	return ViewPlugin.fromClass(
		class implements PluginValue {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, plugin);
			}

			update(update: ViewUpdate): void {
				if (update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = buildDecorations(update.view, plugin);
				}
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

function buildDecorations(view: EditorView, plugin: MtgDecklistPlugin): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const sel = view.state.selection.main;
	const settings = plugin.settings;

	if (!settings.inlineManaSymbols && !settings.inlineCardLinks) {
		return builder.finish();
	}

	for (const { from: rFrom, to: rTo } of view.visibleRanges) {
		const codeRanges = collectCodeRanges(view, rFrom, rTo);
		const candidates: { from: number; to: number; deco: Decoration }[] = [];

		if (settings.inlineCardLinks) {
			for (const range of codeRanges) {
				if (range.kind !== "inline") continue;
				const text = view.state.sliceDoc(range.from, range.to);
				const m = text.match(INLINE_CARD_CODE_RE);
				if (!m) continue;
				const cardName = (m[1] ?? "").trim();
				if (!cardName) continue;
				candidates.push({
					from: range.from,
					to: range.to,
					deco: Decoration.replace({
						widget: new InlineCardWidget(cardName, cardName, plugin),
					}),
				});
			}

			const segmentText = view.state.sliceDoc(rFrom, rTo);
			MD_LINK_CARD_RE.lastIndex = 0;
			let linkMatch: RegExpExecArray | null;
			while ((linkMatch = MD_LINK_CARD_RE.exec(segmentText)) !== null) {
				const matchFrom = rFrom + linkMatch.index;
				const matchTo = matchFrom + linkMatch[0].length;
				if (isInsideAnyRange(matchFrom, matchTo, codeRanges, "fenced")) continue;
				const display = (linkMatch[1] ?? "").trim();
				const cardName = decodeURIComponent((linkMatch[2] ?? "").trim());
				if (!cardName) continue;
				candidates.push({
					from: matchFrom,
					to: matchTo,
					deco: Decoration.replace({
						widget: new InlineCardWidget(cardName, display || cardName, plugin),
					}),
				});
			}
		}

		if (settings.inlineManaSymbols) {
			const segmentText = view.state.sliceDoc(rFrom, rTo);
			MANA_TOKEN_RE.lastIndex = 0;
			let manaMatch: RegExpExecArray | null;
			while ((manaMatch = MANA_TOKEN_RE.exec(segmentText)) !== null) {
				const matchFrom = rFrom + manaMatch.index;
				const matchTo = matchFrom + manaMatch[0].length;
				if (isInsideAnyRange(matchFrom, matchTo, codeRanges)) continue;
				candidates.push({
					from: matchFrom,
					to: matchTo,
					deco: Decoration.replace({
						widget: new ManaWidget(manaMatch[1] ?? "", plugin),
					}),
				});
			}
		}

		candidates.sort((a, b) => a.from - b.from);
		for (const c of candidates) {
			if (selectionTouches(sel, c.from, c.to)) continue;
			builder.add(c.from, c.to, c.deco);
		}
	}

	return builder.finish();
}

function selectionTouches(
	sel: { from: number; to: number },
	from: number,
	to: number,
): boolean {
	return sel.from <= to && sel.to >= from;
}

function isInsideAnyRange(
	from: number,
	to: number,
	ranges: CodeRange[],
	onlyKind?: CodeRange["kind"],
): boolean {
	for (const r of ranges) {
		if (onlyKind && r.kind !== onlyKind) continue;
		if (from >= r.from && to <= r.to) return true;
	}
	return false;
}

function collectCodeRanges(view: EditorView, from: number, to: number): CodeRange[] {
	const ranges: CodeRange[] = [];
	syntaxTree(view.state).iterate({
		from,
		to,
		enter(node) {
			const name = node.type.name;
			if (!name) return;
			const lower = name.toLowerCase();
			if (
				lower.includes("fencedcode") ||
				lower.includes("codeblock") ||
				lower.includes("hmd-codeblock") ||
				lower.includes("hypermd-codeblock")
			) {
				ranges.push({ from: node.from, to: node.to, kind: "fenced" });
			} else if (lower.includes("inline-code") || lower === "inlinecode") {
				ranges.push({ from: node.from, to: node.to, kind: "inline" });
			}
		},
	});
	return mergeAdjacentInline(ranges, view);
}

function mergeAdjacentInline(ranges: CodeRange[], view: EditorView): CodeRange[] {
	const inline = ranges.filter((r) => r.kind === "inline").sort((a, b) => a.from - b.from);
	const fenced = ranges.filter((r) => r.kind === "fenced");
	const merged: CodeRange[] = [];
	for (const r of inline) {
		const last = merged[merged.length - 1];
		if (last && last.to >= r.from) {
			last.to = Math.max(last.to, r.to);
		} else {
			merged.push({ ...r });
		}
	}
	const expanded = merged.map((r) => expandInlineCodeRange(view, r));
	return [...expanded, ...fenced];
}

function expandInlineCodeRange(view: EditorView, range: CodeRange): CodeRange {
	const doc = view.state.doc;
	let from = range.from;
	let to = range.to;
	while (from > 0 && doc.sliceString(from - 1, from) === "`") from--;
	while (to < doc.length && doc.sliceString(to, to + 1) === "`") to++;
	return { from, to, kind: "inline" };
}
