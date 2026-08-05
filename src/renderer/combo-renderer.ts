import { MarkdownPostProcessorContext } from "obsidian";
import type MtgDecklistPlugin from "../main";
import { parseCombo } from "../parser/combo-parser";
import type { ComboLine, ComboLoopSegment, ParsedCombo } from "../parser/combo-types";
import { renderManaCost } from "../ui/mana-symbols";
import { createInlineCardLink } from "./inline-processor";

const MANA_TOKEN_RE = /\{([A-Za-z0-9/]+)\}/g;
const CARD_TOKEN_RE = /`mtg:([^`\n]+)`|\[([^\]]+)\]\(mtg:([^)]+)\)/gi;

let comboLoopMarkerSeq = 0;

export function createComboProcessor(plugin: MtgDecklistPlugin) {
	return (source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
		el.empty();
		const combo = parseCombo(source);
		renderComboView(combo, el, plugin);
	};
}

export function renderComboView(combo: ParsedCombo, container: HTMLElement, plugin: MtgDecklistPlugin): void {
	container.addClass("mtg-combo");

	if (combo.errors.length > 0) {
		const box = container.createDiv({ cls: "mtg-combo-errors" });
		box.createDiv({ cls: "mtg-combo-errors-title", text: "Combo parse warnings" });
		for (const err of combo.errors) box.createDiv({ cls: "mtg-combo-error", text: err });
	}

	const header = container.createDiv({ cls: "mtg-combo-header" });
	const titleRow = header.createDiv({ cls: "mtg-combo-title-row" });
	titleRow.createDiv({ cls: "mtg-combo-name", text: combo.name || "Untitled combo" });
	if (combo.infinite === true) {
		const inf = titleRow.createSpan({ cls: "mtg-combo-infinite-badge" });
		inf.setText("∞");
		inf.setAttribute("title", "Infinite combo");
		inf.setAttribute("aria-label", "Infinite combo");
	}
	if (combo.result) {
		const result = header.createDiv({ cls: "mtg-combo-result" });
		result.createSpan({ cls: "mtg-combo-result-label", text: "Result" });
		const value = result.createSpan({ cls: "mtg-combo-result-value" });
		renderRichText(value, combo.result, plugin);
	}

	const body = container.createDiv({ cls: "mtg-combo-body" });

	const hasSetup =
		combo.battlefield.length > 0 || combo.hand.length > 0 || combo.prerequisites.length > 0;
	const hasSteps = combo.steps.length > 0;

	if (hasSetup) {
		const setup = body.createDiv({ cls: "mtg-combo-section mtg-combo-section-setup" });
		if (combo.battlefield.length > 0) {
			renderSubsection(setup, "Battlefield", "mtg-combo-subsection-battlefield", combo.battlefield, plugin);
		}
		if (combo.hand.length > 0) {
			renderSubsection(setup, "Hand", "mtg-combo-subsection-hand", combo.hand, plugin);
		}
		if (combo.prerequisites.length > 0) {
			renderSubsection(setup, "Prerequisites", "mtg-combo-subsection-prereqs", combo.prerequisites, plugin);
		}
	}

	if (hasSteps) {
		const stepsCls = hasSetup ? "mtg-combo-section-steps" : "mtg-combo-section-steps mtg-combo-section-steps-wide";
		renderListSection(body, "Steps", stepsCls, combo.steps, plugin, "ordered");
	}

	if (combo.loops.length > 0) {
		renderLoopSegments(body, combo.loops, plugin);
	}

	if (combo.interact.length > 0) {
		renderListSection(body, "How to disrupt", "mtg-combo-section-interact", combo.interact, plugin, "•");
	}

	if (combo.notes.length > 0) {
		renderListSection(body, "Notes", "mtg-combo-section-notes", combo.notes, plugin, "•");
	}

	if (combo.lines.length > 0) {
		renderLinesSection(container, combo.lines, plugin);
	}
}

function renderSubsection(
	parent: HTMLElement,
	title: string,
	cls: string,
	items: string[],
	plugin: MtgDecklistPlugin,
	marker: "•" | "ordered" = "•",
): void {
	const sub = parent.createDiv({ cls: `mtg-combo-subsection ${cls}` });
	sub.createDiv({ cls: "mtg-combo-subsection-title", text: title });
	const list = sub.createEl(marker === "ordered" ? "ol" : "ul", {
		cls: marker === "ordered" ? "mtg-combo-list mtg-combo-list-ordered" : "mtg-combo-list mtg-combo-list-bullet",
	});
	for (const item of items) {
		const li = list.createEl("li", { cls: "mtg-combo-item" });
		renderRichText(li, item, plugin);
	}
}

function renderLinesSection(parent: HTMLElement, lines: ComboLine[], plugin: MtgDecklistPlugin): void {
	const wrap = parent.createDiv({ cls: "mtg-combo-lines" });
	wrap.createDiv({ cls: "mtg-combo-section-title", text: "Lines" });
	const list = wrap.createDiv({ cls: "mtg-combo-lines-list" });
	for (let i = 0; i < lines.length; i++) {
		renderLineCard(list, lines[i] as ComboLine, i + 1, plugin);
	}
}

function renderLineCard(
	parent: HTMLElement,
	line: ComboLine,
	index: number,
	plugin: MtgDecklistPlugin,
): void {
	const card = parent.createDiv({ cls: "mtg-combo-line" });

	const headerEl = card.createDiv({ cls: "mtg-combo-line-header" });
	headerEl.createSpan({ cls: "mtg-combo-line-badge", text: `Line ${index}` });
	if (line.name) {
		headerEl.createSpan({ cls: "mtg-combo-line-sep", text: "—" });
		const nameEl = headerEl.createSpan({ cls: "mtg-combo-line-name" });
		renderRichText(nameEl, line.name, plugin);
	}
	if (line.infinite === true) {
		const inf = headerEl.createSpan({ cls: "mtg-combo-infinite-badge mtg-combo-infinite-badge-line" });
		inf.setText("∞");
		inf.setAttribute("title", "Infinite line");
		inf.setAttribute("aria-label", "Infinite line");
	}

	const body = card.createDiv({ cls: "mtg-combo-line-body" });

	if (line.battlefield.length > 0) {
		renderSubsection(body, "Battlefield", "mtg-combo-subsection-battlefield", line.battlefield, plugin);
	}
	if (line.hand.length > 0) {
		renderSubsection(body, "Hand", "mtg-combo-subsection-hand", line.hand, plugin);
	}
	if (line.prerequisites.length > 0) {
		renderSubsection(body, "Prerequisites", "mtg-combo-subsection-prereqs", line.prerequisites, plugin);
	}
	if (line.steps.length > 0) {
		renderSubsection(body, "Steps", "mtg-combo-subsection-steps", line.steps, plugin, "ordered");
	}
	if (line.loops.length > 0) {
		renderLoopSegments(body, line.loops, plugin);
	}
	if (line.notes.length > 0) {
		renderSubsection(body, "Notes", "mtg-combo-subsection-notes", line.notes, plugin);
	}
}

function renderListSection(
	parent: HTMLElement,
	title: string,
	cls: string,
	items: string[],
	plugin: MtgDecklistPlugin,
	marker: "•" | "ordered",
): void {
	const section = parent.createDiv({ cls: `mtg-combo-section ${cls}` });
	section.createDiv({ cls: "mtg-combo-section-title", text: title });

	const list = section.createEl(marker === "ordered" ? "ol" : "ul", {
		cls: marker === "ordered" ? "mtg-combo-list mtg-combo-list-ordered" : "mtg-combo-list mtg-combo-list-bullet",
	});
	for (const item of items) {
		const li = list.createEl("li", { cls: "mtg-combo-item" });
		renderRichText(li, item, plugin);
	}
}

function renderLoopSegments(
	parent: HTMLElement,
	segments: ComboLoopSegment[],
	plugin: MtgDecklistPlugin,
): void {
	for (const seg of segments) {
		if (seg.loop.length > 0) {
			renderLoopSection(parent, seg.loop, seg.breaks, plugin);
		} else if (seg.breaks.length > 0) {
			renderListSection(parent, "Break", "mtg-combo-section-break", seg.breaks, plugin, "•");
		}
	}
}

function renderLoopSection(
	parent: HTMLElement,
	loopSteps: string[],
	breaks: string[],
	plugin: MtgDecklistPlugin,
): void {
	const section = parent.createDiv({ cls: "mtg-combo-section mtg-combo-section-loop" });

	const header = section.createDiv({ cls: "mtg-combo-section-title-row" });
	header.createDiv({ cls: "mtg-combo-section-title", text: "Loop" });
	header.createSpan({ cls: "mtg-combo-loop-badge", text: "↻ repeats" });

	const flowWrap = section.createDiv({ cls: "mtg-combo-loop" });
	const arc = flowWrap.createSvg("svg", { cls: "mtg-combo-loop-arc" });
	arc.setAttribute("aria-hidden", "true");
	arc.setAttribute("xmlns", "http://www.w3.org/2000/svg");

	const track = flowWrap.createDiv({ cls: "mtg-combo-loop-track" });
	const stepEls: HTMLElement[] = [];

	for (let i = 0; i < loopSteps.length; i++) {
		if (i > 0) {
			const arrow = track.createDiv({ cls: "mtg-combo-loop-arrow" });
			arrow.setText("↓");
		}
		const box = track.createDiv({ cls: "mtg-combo-loop-step" });
		const num = box.createSpan({ cls: "mtg-combo-loop-step-num" });
		num.setText(String(i + 1));
		const text = box.createSpan({ cls: "mtg-combo-loop-step-text" });
		renderRichText(text, loopSteps[i] ?? "", plugin);
		stepEls.push(box);
	}

	const markerId = `mtg-combo-loop-arrowhead-${comboLoopMarkerSeq++}`;
	scheduleArcLayout(flowWrap, arc, stepEls, markerId);

	if (breaks.length > 0) {
		const breakWrap = section.createDiv({ cls: "mtg-combo-loop-breaks" });
		breakWrap.createDiv({ cls: "mtg-combo-loop-breaks-title", text: "Break out" });
		const ul = breakWrap.createEl("ul", { cls: "mtg-combo-list mtg-combo-list-bullet" });
		for (const b of breaks) {
			const li = ul.createEl("li", { cls: "mtg-combo-item mtg-combo-break-item" });
			renderRichText(li, b, plugin);
		}
	}
}

function scheduleArcLayout(wrap: HTMLElement, arc: SVGSVGElement, stepEls: HTMLElement[], markerId: string): void {
	if (stepEls.length < 2) {
		arc.setAttribute("width", "0");
		arc.setAttribute("height", "0");
		return;
	}

	const draw = () => {
		const wrapRect = wrap.getBoundingClientRect();
		const firstRect = stepEls[0]?.getBoundingClientRect();
		const lastRect = stepEls[stepEls.length - 1]?.getBoundingClientRect();
		if (!firstRect || !lastRect || wrapRect.width === 0) return;

		const padLeft = parseFloat(getComputedStyle(wrap).paddingLeft || "0");
		const arcWidth = Math.max(padLeft - 2, 12);
		const totalHeight = wrapRect.height;
		const startX = arcWidth - 1;
		const startY = (firstRect.top - wrapRect.top) + firstRect.height / 2;
		const endY = (lastRect.top - wrapRect.top) + lastRect.height / 2;
		const farX = 2;
		const cpOffset = Math.max((endY - startY) * 0.45, 24);

		arc.setAttribute("width", String(Math.ceil(arcWidth)));
		arc.setAttribute("height", String(Math.ceil(totalHeight)));
		arc.setAttribute("viewBox", `0 0 ${arcWidth} ${totalHeight}`);

		while (arc.firstChild) arc.removeChild(arc.firstChild);

		const defs = arc.createSvg("defs");
		const marker = defs.createSvg("marker", {
			attr: {
				id: markerId,
				viewBox: "0 0 10 10",
				refX: "8",
				refY: "5",
				markerWidth: "6",
				markerHeight: "6",
				orient: "auto-start-reverse",
			},
		});
		marker.createSvg("path", {
			cls: "mtg-combo-loop-arrow-head",
			attr: { d: "M0,0 L10,5 L0,10 z" },
		});

		const d = `M ${startX} ${endY} C ${farX} ${endY - cpOffset}, ${farX} ${startY + cpOffset}, ${startX} ${startY}`;
		arc.createSvg("path", {
			cls: "mtg-combo-loop-arc-path",
			attr: {
				d,
				fill: "none",
				"marker-end": `url(#${markerId})`,
			},
		});
	};

	window.requestAnimationFrame(() => window.requestAnimationFrame(draw));

	if (typeof ResizeObserver !== "undefined") {
		const ro = new ResizeObserver(() => draw());
		ro.observe(wrap);
		for (const el of stepEls) ro.observe(el);
	}

	window.addEventListener("resize", draw, { passive: true });
}

export function renderRichText(container: HTMLElement, text: string, plugin: MtgDecklistPlugin): void {
	const cardSpans = collectCardSpans(text);
	let cursor = 0;

	for (const span of cardSpans) {
		if (span.start > cursor) {
			renderManaInto(container, text.slice(cursor, span.start), plugin);
		}
		const link = createInlineCardLink(span.cardName, span.display, plugin);
		container.appendChild(link);
		cursor = span.end;
	}
	if (cursor < text.length) {
		renderManaInto(container, text.slice(cursor), plugin);
	}
}

interface CardSpan {
	start: number;
	end: number;
	cardName: string;
	display?: string;
}

function collectCardSpans(text: string): CardSpan[] {
	const spans: CardSpan[] = [];
	CARD_TOKEN_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = CARD_TOKEN_RE.exec(text)) !== null) {
		if (m[1] !== undefined) {
			const cardName = m[1].trim();
			if (!cardName) continue;
			spans.push({
				start: m.index,
				end: m.index + m[0].length,
				cardName,
			});
		} else if (m[2] !== undefined && m[3] !== undefined) {
			const display = m[2].trim();
			const cardName = m[3].trim();
			if (!cardName) continue;
			spans.push({
				start: m.index,
				end: m.index + m[0].length,
				cardName,
				display: display || undefined,
			});
		}
	}
	return spans;
}

function renderManaInto(container: HTMLElement, text: string, plugin: MtgDecklistPlugin): void {
	if (!text) return;
	MANA_TOKEN_RE.lastIndex = 0;
	let last = 0;
	let m: RegExpExecArray | null;
	let foundAny = false;
	while ((m = MANA_TOKEN_RE.exec(text)) !== null) {
		foundAny = true;
		if (m.index > last) container.appendText(text.slice(last, m.index));
		const wrapper = container.createSpan({ cls: "mtg-inline-mana" });
		renderManaCost(wrapper, `{${m[1]}}`, plugin.symbology);
		last = m.index + m[0].length;
	}
	if (!foundAny) {
		container.appendText(text);
	} else if (last < text.length) {
		container.appendText(text.slice(last));
	}
}
