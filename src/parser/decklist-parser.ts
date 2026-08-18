import { extractMoxfieldId } from "../moxfield/url";
import { extractArchidektId } from "../archidekt/url";
import type {
	DecklistDirectives,
	DecklistEntry,
	DecklistError,
	ParsedDecklist,
	RemoteSource,
	Section,
	SectionKind,
} from "./types";

export const DEFAULT_SECTION_TITLE = "Deck";

const VALID_GROUP_VALUES = new Set<DecklistDirectives["group"]>(["auto", "manual", "respect-manual"]);
const VALID_SORT_VALUES = new Set<DecklistDirectives["sort"]>(["name", "cmc-name", "source"]);
const VALID_LEGALITY_VALUES = new Set<DecklistDirectives["legality"]>([
	"off",
	"standard",
	"pioneer",
	"modern",
	"legacy",
	"vintage",
	"pauper",
	"commander",
	"brawl",
]);

interface DirectiveContext {
	directives: DecklistDirectives;
	remoteSource: RemoteSource | undefined;
	errors: DecklistError[];
}

function parseDirective(line: string): { key: string; value: string; rawValue: string } | null {
	const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*[:=]\s*(.+)$/);
	if (!m) return null;
	const rawValue = (m[2] ?? "").trim();
	return {
		key: (m[1] ?? "").toLowerCase(),
		value: rawValue.toLowerCase(),
		rawValue,
	};
}

function applyDirective(
	ctx: DirectiveContext,
	key: string,
	value: string,
	rawValue: string,
	lineNumber: number,
	rawLine: string,
): boolean {
	if (key === "group" || key === "grouping") {
		if (VALID_GROUP_VALUES.has(value as DecklistDirectives["group"])) {
			ctx.directives.group = value as DecklistDirectives["group"];
			return true;
		}
	}
	if (key === "sort" || key === "order") {
		const v = value === "cmc" ? "cmc-name" : value;
		if (VALID_SORT_VALUES.has(v as DecklistDirectives["sort"])) {
			ctx.directives.sort = v as DecklistDirectives["sort"];
			return true;
		}
	}
	if (key === "legality" || key === "format") {
		if (VALID_LEGALITY_VALUES.has(value as DecklistDirectives["legality"])) {
			ctx.directives.legality = value as DecklistDirectives["legality"];
			return true;
		}
	}
	if (key === "moxfield") {
		const id = extractMoxfieldId(rawValue);
		if (id) {
			ctx.remoteSource = { kind: "moxfield", id, rawUrl: rawValue };
			return true;
		}
		ctx.errors.push({
			lineNumber,
			rawLine,
			message: "Could not extract a Moxfield deck ID from this URL.",
		});
		return true;
	}
	if (key === "archidekt") {
		const id = extractArchidektId(rawValue);
		if (id) {
			ctx.remoteSource = { kind: "archidekt", id, rawUrl: rawValue };
			return true;
		}
		ctx.errors.push({
			lineNumber,
			rawLine,
			message: "Could not extract an Archidekt deck ID from this URL.",
		});
		return true;
	}
	if (key === "source") {
		const remote = resolveRemoteSource(rawValue);
		if (remote) {
			ctx.remoteSource = remote;
			return true;
		}
		ctx.errors.push({
			lineNumber,
			rawLine,
			message: "Could not extract a Moxfield or Archidekt deck ID from this URL.",
		});
		return true;
	}
	return false;
}

function resolveRemoteSource(rawValue: string): RemoteSource | null {
	const lower = rawValue.toLowerCase();
	if (lower.includes("archidekt.com")) {
		const id = extractArchidektId(rawValue);
		return id ? { kind: "archidekt", id, rawUrl: rawValue } : null;
	}
	if (lower.includes("moxfield.com")) {
		const id = extractMoxfieldId(rawValue);
		return id ? { kind: "moxfield", id, rawUrl: rawValue } : null;
	}
	// Bare IDs with no host: a purely-numeric ID is Archidekt's format (Moxfield's
	// public IDs are mixed alphanumeric and never digits-only), so check that first.
	const archidektId = extractArchidektId(rawValue);
	if (archidektId && /^\d+$/.test(rawValue.trim())) return { kind: "archidekt", id: archidektId, rawUrl: rawValue };
	const moxfieldId = extractMoxfieldId(rawValue);
	if (moxfieldId) return { kind: "moxfield", id: moxfieldId, rawUrl: rawValue };
	if (archidektId) return { kind: "archidekt", id: archidektId, rawUrl: rawValue };
	return null;
}

const SPECIAL_SECTIONS: Record<string, SectionKind> = {
	commander: "commander",
	commanders: "commander",
	sideboard: "sideboard",
	side: "sideboard",
	sb: "sideboard",
	maybeboard: "maybeboard",
	maybe: "maybeboard",
};

function classifySection(title: string): SectionKind {
	const key = title.trim().toLowerCase();
	return SPECIAL_SECTIONS[key] ?? "general";
}

function extractTrailingTags(rest: string): { name: string; tags: string[] } {
	const tags: string[] = [];
	let working = rest.trim();
	const tokenRe = /\s+#([A-Za-z][A-Za-z0-9_-]*)\s*$/;
	while (true) {
		const m = working.match(tokenRe);
		if (!m) break;
		const tag = m[1];
		if (tag) tags.unshift(tag.toLowerCase());
		const index = m.index;
		if (index === undefined) break;
		working = working.slice(0, index).replace(/\s+$/, "");
	}
	return { name: working.trim(), tags: tags.length > 0 && tags[0] !== undefined ? [tags[0]] : [] };
}

/**
 * Pull an optional trailing printing specifier off a card name, in the
 * Moxfield/MTGO style `(SET) COLLECTOR_NUMBER` — e.g. `Ancient Den (MRD) 278`.
 * The set code is 3-5 alphanumerics; the collector number may contain a letter
 * suffix (e.g. `123a`) or star (`★`). Returns the cleaned name plus the parts.
 */
function extractSetPrinting(rest: string): { name: string; set?: string; collectorNumber?: string } {
	const working = rest.trim();
	const m = working.match(/^(.*\S)\s+\(([A-Za-z0-9]{3,5})\)\s+([0-9]+[A-Za-z★]?)$/);
	if (!m) return { name: working };
	return {
		name: (m[1] ?? "").trim(),
		set: (m[2] ?? "").toLowerCase(),
		collectorNumber: (m[3] ?? "").trim(),
	};
}

function parseEntryLine(line: string, lineNumber: number): DecklistEntry | DecklistError {
	const trimmed = line.trim();

	const match = trimmed.match(/^(\d+)\s*[xX]?\s+(.+)$/);
	if (match) {
		const quantity = Number.parseInt(match[1] ?? "0", 10);
		const { name: taggedName, tags } = extractTrailingTags(match[2] ?? "");
		const { name, set, collectorNumber } = extractSetPrinting(taggedName);
		if (!name) {
			return {
				lineNumber,
				rawLine: line,
				message: "Missing card name after quantity.",
			};
		}
		return {
			quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
			name,
			rawLine: line,
			lineNumber,
			tags,
			...(set ? { set, collectorNumber } : {}),
		};
	}

	if (/^[A-Za-z]/.test(trimmed)) {
		const { name: taggedName, tags } = extractTrailingTags(trimmed);
		const { name, set, collectorNumber } = extractSetPrinting(taggedName);
		return {
			quantity: 1,
			name,
			rawLine: line,
			lineNumber,
			tags,
			...(set ? { set, collectorNumber } : {}),
		};
	}

	return {
		lineNumber,
		rawLine: line,
		message: "Could not parse line. Expected '<qty> <card name>' or '# Section'.",
	};
}

function isError(value: DecklistEntry | DecklistError): value is DecklistError {
	return (value as DecklistError).message !== undefined;
}

export function parseDecklist(source: string): ParsedDecklist {
	const lines = source.split(/\r?\n/);
	const sections: Section[] = [];
	const errors: DecklistError[] = [];
	const directives: DecklistDirectives = {};
	const ctx: DirectiveContext = { directives, remoteSource: undefined, errors };

	let current: Section = {
		title: DEFAULT_SECTION_TITLE,
		kind: "general",
		entries: [],
	};
	let directivesAllowed = true;

	const pushCurrentIfUsed = () => {
		if (current.entries.length > 0 || sections.length === 0) {
			sections.push(current);
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? "";
		const trimmed = raw.trim();

		if (!trimmed) continue;
		if (trimmed.startsWith("//")) continue;

		if (directivesAllowed) {
			const directive = parseDirective(trimmed);
			if (directive && applyDirective(ctx, directive.key, directive.value, directive.rawValue, i + 1, raw)) {
				continue;
			}
		}

		const headerMatch = trimmed.match(/^#+\s*(.+)$/);
		if (headerMatch) {
			directivesAllowed = false;
			if (current.entries.length > 0) {
				sections.push(current);
			}
			const title = (headerMatch[1] ?? "").trim();
			current = {
				title: title || DEFAULT_SECTION_TITLE,
				kind: classifySection(title),
				entries: [],
			};
			continue;
		}

		directivesAllowed = false;
		const parsed = parseEntryLine(raw, i + 1);
		if (isError(parsed)) {
			errors.push(parsed);
		} else {
			current.entries.push(parsed);
		}
	}

	pushCurrentIfUsed();

	const cleanedSections = sections.filter((s) => s.entries.length > 0);
	const totalCards = cleanedSections
		.filter((s) => s.kind !== "sideboard" && s.kind !== "maybeboard")
		.reduce((sum, s) => sum + s.entries.reduce((n, e) => n + e.quantity, 0), 0);

	return {
		sections: cleanedSections,
		errors,
		totalCards,
		directives,
		remoteSource: ctx.remoteSource,
	};
}

export function sectionTotal(section: Section): number {
	return section.entries.reduce((sum, e) => sum + e.quantity, 0);
}
