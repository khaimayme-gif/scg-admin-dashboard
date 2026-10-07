// SochicGifts platform fee on Japan orders, in yen.
// Never less than 500 yen, and 30% of the selling price once that is more than 500 yen:
// up to about 1,667 yen -> 500 yen, 2,000 yen -> 600 yen, 10,000 yen -> 3,000 yen.
// The server calculates the real figure (lib/platform-fee.js); this one is for live previews.
export const MIN_FEE_JPY = 500;
export const FEE_RATE = 0.3;

export function platformFeeJpy(sellingJpy: number): number {
  if (!(sellingJpy > 0)) return 0;
  return Math.max(MIN_FEE_JPY, Math.round(sellingJpy * FEE_RATE));
}
