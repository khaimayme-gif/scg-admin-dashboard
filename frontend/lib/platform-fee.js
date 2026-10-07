// SochicGifts platform fee on Japan orders, in yen.
//   Never less than 500 yen, and 30% of the selling price once that is more than 500 yen,
//   so: up to about 1,667 yen -> 500 yen, 2,000 yen -> 600 yen, 10,000 yen -> 3,000 yen.
// Keep in sync with src/platformFee.ts.
const MIN_FEE_JPY = 500;
const FEE_RATE = 0.3;

function platformFeeJpy(sellingJpy) {
  if (!(sellingJpy > 0)) return 0;
  return Math.max(MIN_FEE_JPY, Math.round(sellingJpy * FEE_RATE));
}

module.exports = { platformFeeJpy, MIN_FEE_JPY, FEE_RATE };
