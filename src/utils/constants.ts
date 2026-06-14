export const SCRYFALL_API_BASE = "https://api.scryfall.com";
export const SCRYFALL_NAMED_FUZZY = `${SCRYFALL_API_BASE}/cards/named?fuzzy=`;
export const SCRYFALL_CARDS_BASE = `${SCRYFALL_API_BASE}/cards`;

export const DECKLIST_BLOCK_LANG = "decklist";
export const COMBO_BLOCK_LANG = "combo";

export const SCRYFALL_REQUEST_SPACING_MS = 150;

export const SCRYFALL_RETRY_MAX_ATTEMPTS = 3;
export const SCRYFALL_RETRY_BACKOFF_BASE_MS = 1000;
export const SCRYFALL_RETRY_BACKOFF_MAX_MS = 15000;

export const PLUGIN_USER_AGENT = "Obsidian-MTG-Decklist/1.0.0";

export const MOXFIELD_API_BASE = "https://api2.moxfield.com";
export const MOXFIELD_DECK_PATH = "/v3/decks/all";
export const MOXFIELD_DEFAULT_TTL_MINUTES = 360;
