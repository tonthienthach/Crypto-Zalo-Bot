/** Max trades one chat can record (spec EPIC-003-NFR05). */
export const MAX_TRADES_PER_CHAT = 200;

/** Max distinct coins one chat can hold at once (spec EPIC-003-NFR05). */
export const MAX_HELD_COINS = 20;

/** Largest quantity accepted in one trade (spec EPIC-003-NFR05: (0, 10^12]). */
export const MAX_QUANTITY = 1e12;

/** Quantities are stored with this many decimals (spec EPIC-003-FR02). */
export const MAX_QUANTITY_DECIMALS = 8;

/** Longest coin symbol stored (spec EPIC-003-NFR05). */
export const MAX_PORTFOLIO_SYMBOL_LENGTH = 20;

/** Trades per "/danhmuc lichsu" page (spec EPIC-003-FR09). */
export const HISTORY_PAGE_SIZE = 20;

/**
 * Quantities are exact decimals with 8 places, so the calculator works in
 * integer units of 10^-8 — "sold everything" is then an exact comparison
 * with zero, not a floating-point one.
 */
export const QUANTITY_SCALE = 10n ** BigInt(MAX_QUANTITY_DECIMALS);

/** How close together two identical trades must be for the reply to flag the second one. */
export const TWIN_TRADE_WINDOW_MS = 2 * 60 * 1000;

/** Longest Zalo message_id kept for de-duplication; matches the column CHECK in migration 0002. */
export const MAX_SOURCE_MESSAGE_ID_LENGTH = 128;
