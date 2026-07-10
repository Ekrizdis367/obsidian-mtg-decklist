import type { ComboLine, ComboLoopSegment, ParsedCombo } from "./combo-types";

const SCALAR_KEYS = new Set(["name", "result"]);

const LIST_KEYS = new Set([
	"battlefield",
	"hand",
	"prerequisites",
	"steps",
	"interact",
	"notes",
]);

// Keys a per-variant `line:` block may carry. `interact` always routes to the top-level combo.
const LINE_LIST_KEYS = new Set([
	"battlefield",
	"hand",
	"prerequisites",
	"steps",
	"notes",
]);

const KEY_ALIASES: Record<string, string> = {
	prereqs: "prerequisites",
	prereq: "prerequisites",
	requires: "prerequisites",
	"in-play": "battlefield",
	inplay: "battlefield",
	in_play: "battlefield",
	board: "battlefield",
	field: "battlefield",
	play: "battlefield",
	"on-battlefield": "battlefield",
	"in-hand": "hand",
	inhand: "hand",
	in_hand: "hand",
	cards: "hand",
	pieces: "hand",
	"combo-pieces": "hand",
	step: "steps",
	loops: "loop",
	cycle: "loop",
	breaks: "break",
	exit: "break",
	disrupt: "interact",
	disruption: "interact",
	counterplay: "interact",
	note: "notes",
	outcome: "result",
	wins: "result",
	win: "result",
	variant: "line",
	variants: "line",
	lines: "line",
	inf: "infinite",
	infinity: "infinite",
};

interface LoopSegmentContainer {
	loops: ComboLoopSegment[];
}

function parseInfiniteFlag(value: string): boolean {
	const v = value.trim().toLowerCase();
	if (!v) return true;
	if (["false", "no", "n", "0", "off"].includes(v)) return false;
	return ["true", "yes", "y", "on", "1", "inf", "infinite", "infinity"].includes(v);
}

function newLine(name: string): ComboLine {
	return {
		name,
		battlefield: [],
		hand: [],
		prerequisites: [],
		steps: [],
		loops: [],
		notes: [],
	};
}

function startLoopSegment(container: LoopSegmentContainer): string[] {
	const seg: ComboLoopSegment = { loop: [], breaks: [] };
	container.loops.push(seg);
	return seg.loop;
}

function breaksListForCurrentSegment(container: LoopSegmentContainer): string[] {
	let seg = container.loops[container.loops.length - 1];
	if (!seg) {
		seg = { loop: [], breaks: [] };
		container.loops.push(seg);
	}
	return seg.breaks;
}

export function parseCombo(source: string): ParsedCombo {
	const combo: ParsedCombo = {
		name: "",
		result: undefined,
		battlefield: [],
		hand: [],
		prerequisites: [],
		steps: [],
		loops: [],
		interact: [],
		notes: [],
		lines: [],
		errors: [],
	};

	const lines = source.split(/\r?\n/);
	let currentList: string[] | null = null;
	let currentKey: string | null = null;
	let currentLine: ComboLine | null = null;

	const loopContainer = (): LoopSegmentContainer => currentLine ?? combo;

	const targetListFor = (key: string): string[] | null => {
		if (currentLine && LINE_LIST_KEYS.has(key)) {
			return mainListForLine(currentLine, key);
		}
		return mainListForCombo(combo, key);
	};

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? "";
		const trimmed = raw.trim();

		if (!trimmed) {
			currentList = null;
			currentKey = null;
			continue;
		}
		if (trimmed.startsWith("//")) continue;

		if (trimmed.startsWith("- ")) {
			const item = trimmed.slice(2).trim();
			if (!item) continue;
			if (currentList) {
				currentList.push(item);
			} else {
				combo.errors.push(`Line ${i + 1}: list item without an active section ("${trimmed}")`);
			}
			continue;
		}

		const m = raw.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
		if (!m) {
			if (currentKey === "notes" || currentKey === "result") {
				if (currentKey === "result") {
					combo.result = (combo.result ? combo.result + " " : "") + trimmed;
				} else {
					const list = targetListFor("notes");
					if (list) list.push(trimmed);
				}
				continue;
			}
			combo.errors.push(`Line ${i + 1}: unrecognized line "${trimmed}"`);
			continue;
		}

		const rawKey = (m[1] ?? "").toLowerCase();
		const key = KEY_ALIASES[rawKey] ?? rawKey;
		const value = (m[2] ?? "").trim();

		if (key === "line") {
			currentList = null;
			currentKey = "line";
			currentLine = newLine(value);
			combo.lines.push(currentLine);
			continue;
		}

		if (key === "infinite") {
			currentList = null;
			currentKey = "infinite";
			const flag = parseInfiniteFlag(value);
			if (currentLine) {
				currentLine.infinite = flag;
			} else {
				combo.infinite = flag;
			}
			continue;
		}

		if (SCALAR_KEYS.has(key)) {
			currentList = null;
			currentKey = key;
			if (key === "name") {
				combo.name = value;
			} else if (key === "result") {
				combo.result = value || undefined;
			}
			continue;
		}

		if (key === "loop") {
			currentKey = "loop";
			currentList = startLoopSegment(loopContainer());
			if (value) currentList.push(value);
			continue;
		}

		if (key === "break") {
			currentKey = "break";
			currentList = breaksListForCurrentSegment(loopContainer());
			if (value) currentList.push(value);
			continue;
		}

		if (LIST_KEYS.has(key)) {
			currentKey = key;
			currentList = targetListFor(key);
			if (currentList && value) currentList.push(value);
			continue;
		}

		combo.errors.push(`Line ${i + 1}: unknown key "${rawKey}"`);
	}

	if (!combo.name) combo.errors.unshift("Missing required \"name:\" field.");

	return combo;
}

function mainListForCombo(combo: ParsedCombo, key: string): string[] | null {
	switch (key) {
		case "battlefield":
			return combo.battlefield;
		case "hand":
			return combo.hand;
		case "prerequisites":
			return combo.prerequisites;
		case "steps":
			return combo.steps;
		case "interact":
			return combo.interact;
		case "notes":
			return combo.notes;
		default:
			return null;
	}
}

function mainListForLine(line: ComboLine, key: string): string[] | null {
	switch (key) {
		case "battlefield":
			return line.battlefield;
		case "hand":
			return line.hand;
		case "prerequisites":
			return line.prerequisites;
		case "steps":
			return line.steps;
		case "notes":
			return line.notes;
		default:
			return null;
	}
}
