export const SNIPE_WINDOW_MS = 30_000; // 30 seconds before deadline
export const EXTENSION_MS = 60_000;    // 60 seconds extension if bid lands in snipe window

export interface PricingParams {
  currentPrice: number | null;
  startPrice: number;
  maxPrice: number;
  minIncrement: number;
}

/**
 * Calculates the next minimum required bid for an auction.
 * Returns null if the auction currentPrice has reached or exceeded maxPrice (locked).
 */
export function nextMinBid(a: PricingParams): number | null {
  if (a.currentPrice === null) return a.startPrice;
  if (a.currentPrice >= a.maxPrice) return null; // locked
  return Math.min(a.currentPrice + a.minIncrement, a.maxPrice);
}

/**
 * Calculates deadline extension for anti-sniping.
 * If a bid lands within 30s of closesAt, extend closesAt to now + 60s.
 */
export function calculateClosingTime(
  currentClosesAt: Date,
  serverNow: Date
): { closesAt: Date; extended: boolean } {
  const diff = currentClosesAt.getTime() - serverNow.getTime();
  if (diff <= SNIPE_WINDOW_MS) {
    return {
      closesAt: new Date(serverNow.getTime() + EXTENSION_MS),
      extended: true,
    };
  }
  return {
    closesAt: currentClosesAt,
    extended: false,
  };
}
