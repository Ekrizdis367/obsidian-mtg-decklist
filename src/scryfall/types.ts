export interface ScryfallImageUris {
	small?: string;
	normal?: string;
	large?: string;
	png?: string;
	art_crop?: string;
	border_crop?: string;
}

export interface ScryfallCardFace {
	name?: string;
	printed_name?: string;
	printed_text?: string;
	mana_cost?: string;
	type_line?: string;
	oracle_text?: string;
	image_uris?: ScryfallImageUris;
	colors?: string[];
}

export interface ScryfallPrices {
	usd?: string | null;
	usd_foil?: string | null;
	usd_etched?: string | null;
	eur?: string | null;
	eur_foil?: string | null;
	tix?: string | null;
}

export type ScryfallLegality = "legal" | "not_legal" | "restricted" | "banned";

export interface ScryfallLegalities {
	standard?: ScryfallLegality;
	pioneer?: ScryfallLegality;
	modern?: ScryfallLegality;
	legacy?: ScryfallLegality;
	vintage?: ScryfallLegality;
	pauper?: ScryfallLegality;
	commander?: ScryfallLegality;
	brawl?: ScryfallLegality;
}

export interface ScryfallCard {
	id: string;
	oracle_id?: string;
	name: string;
	lang?: string;
	printed_name?: string;
	printed_text?: string;
	mana_cost?: string;
	cmc?: number;
	type_line?: string;
	colors?: string[];
	color_identity?: string[];
	set?: string;
	collector_number?: string;
	scryfall_uri?: string;
	image_uris?: ScryfallImageUris;
	card_faces?: ScryfallCardFace[];
	layout?: string;
	prices?: ScryfallPrices;
	legalities?: ScryfallLegalities;
}

export interface CachedCardEntry {
	card: ScryfallCard;
	cachedAt: number;
}
