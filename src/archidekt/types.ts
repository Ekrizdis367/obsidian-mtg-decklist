export interface ArchidektOracleCard {
	name?: string;
	cmc?: number;
	manaCost?: string;
	colors?: string[];
	colorIdentity?: string[];
	types?: string[];
	superTypes?: string[];
	subTypes?: string[];
}

export interface ArchidektCard {
	oracleCard?: ArchidektOracleCard;
}

export interface ArchidektDeckCard {
	quantity?: number;
	categories?: string[];
	companion?: boolean;
	card?: ArchidektCard;
}

export interface ArchidektDeckCategory {
	name?: string;
	includedInDeck?: boolean;
	isPremier?: boolean;
}

export interface ArchidektDeck {
	id?: number;
	name?: string;
	cards?: ArchidektDeckCard[];
	categories?: ArchidektDeckCategory[];
}

export interface CachedArchidektDeck {
	deckId: string;
	fetchedAt: number;
	deck: ArchidektDeck;
}

export class ArchidektFetchError extends Error {
	constructor(
		message: string,
		readonly kind:
			| "not-found"
			| "private"
			| "rate-limited"
			| "network"
			| "invalid-id"
			| "unknown",
		readonly status?: number,
	) {
		super(message);
		this.name = "ArchidektFetchError";
	}
}
