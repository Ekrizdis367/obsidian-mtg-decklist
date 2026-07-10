export type ComboSectionKey =
	| "battlefield"
	| "hand"
	| "prerequisites"
	| "steps"
	| "loop"
	| "break"
	| "interact"
	| "notes";

export interface ComboLoopSegment {
	loop: string[];
	breaks: string[];
}

export interface ComboLine {
	name: string;
	infinite?: boolean;
	battlefield: string[];
	hand: string[];
	prerequisites: string[];
	steps: string[];
	loops: ComboLoopSegment[];
	notes: string[];
}

export interface ParsedCombo {
	name: string;
	result?: string;
	infinite?: boolean;
	battlefield: string[];
	hand: string[];
	prerequisites: string[];
	steps: string[];
	loops: ComboLoopSegment[];
	interact: string[];
	notes: string[];
	lines: ComboLine[];
	errors: string[];
}
