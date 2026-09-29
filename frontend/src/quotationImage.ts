import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/linden-hill/400.css';
import bowUrl from './assets/quotation-bow.png';

// Draws the "Price Quotation" card as a PNG, matching the Canva template.
// Only the customer-facing numbers go in: item names, selling prices and the total.
// Original prices and revenue are never passed in here.

export interface QuotationImageData {
  quoteNo: string; // e.g. 20260928-001
  quoteDate: string; // YYYY-MM-DD
  items: { name: string; sellingPrice: number }[];
}

const SANS = "'Space Grotesk', 'Noto Sans Myanmar', sans-serif";
const SERIF = "'Linden Hill', 'Noto Serif Myanmar', serif";

const GRAY = '#5b5c62';
const PINK = '#da7282';
const RULE = '#d4d4d8';
const BG = '#fffafc';
const DOT = '#ffdeeb';

const W = 1080;
const BASE_H = 1350;
const ROW_PITCH = 64;
const ROW_SIZE = 50;
const BASE_ROWS = 4; // the template shows 4 rows in 1080x1350; each extra row makes the card 64px taller
const CARD_X = 63;
const CARD_R = 52;
const TEXT_L = 194;
const TEXT_R = 886;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

const loadFonts = () =>
  Promise.all([
    document.fonts.load(`700 70px ${SANS}`),
    document.fonts.load(`500 38px ${SANS}`),
    document.fonts.load(`400 38px ${SANS}`),
    document.fonts.load(`400 46px ${SERIF}`),
  ]);

// Shrinks a font size until the text fits the given width.
const fitText = (ctx: CanvasRenderingContext2D, text: string, font: (size: number) => string, size: number, maxW: number) => {
  let s = size;
  ctx.font = font(s);
  while (ctx.measureText(text).width > maxW && s > 20) {
    s -= 2;
    ctx.font = font(s);
  }
  return s;
};

// Linden Hill is lighter than the template's serif, so a hairline stroke in the same colour adds weight.
const serif = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, weight = 0.5) => {
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = weight;
  ctx.lineJoin = 'round';
  ctx.fillText(text, x, y);
  ctx.strokeText(text, x, y);
};

export async function renderQuotationPng(data: QuotationImageData): Promise<Blob> {
  const [bow] = await Promise.all([loadImage(bowUrl), loadFonts()]);

  const rows = data.items.map((it) => ({
    name: it.name,
    price: it.sellingPrice > 0 ? `${fmt(it.sellingPrice)} ฿` : 'Complimentary',
    free: it.sellingPrice <= 0,
  }));
  const total = data.items.reduce((sum, it) => sum + it.sellingPrice, 0);

  // Up to 4 rows the card is exactly 1080x1350 like the template; more rows make it taller.
  const extraRows = Math.max(0, rows.length - BASE_ROWS);
  const H = BASE_H + extraRows * ROW_PITCH;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';

  // Background: staggered polka dots, 54px pitch, ~21px across.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = DOT;
  for (let y = 13, j = 0; y < H + 27; y += 27, j++) {
    const offset = j % 2 === 0 ? 13 : 40;
    for (let x = offset; x < W + 27; x += 54) {
      ctx.beginPath();
      ctx.arc(x, y, 10.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // White card.
  const cardTop = 121;
  const cardBottom = H - 77;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(CARD_X, cardTop, W - CARD_X * 2 + 1, cardBottom - cardTop, CARD_R);
  ctx.fill();

  // Bow overlaps the top edge of the card.
  ctx.drawImage(bow, (W - bow.width) / 2, 55);

  ctx.textAlign = 'center';

  // Wordmark, letter-spaced, sits on the bow's tails.
  ctx.fillStyle = GRAY;
  ctx.font = `700 27px ${SANS}`;
  ctx.letterSpacing = '4px';
  ctx.fillText('SOCHICGIFTS', W / 2 + 2, 258);
  ctx.letterSpacing = '0px';

  // Title and tagline.
  ctx.font = `700 72px ${SANS}`;
  ctx.letterSpacing = '2px';
  ctx.fillText('PRICE QUOTATION', W / 2 + 1, 363);
  ctx.letterSpacing = '0px';
  ctx.font = `italic 400 38px ${SANS}`;
  ctx.fillText('A little surprise, a lot of love.', W / 2, 424);

  // ID and date.
  ctx.font = `400 28px ${SERIF}`;
  ctx.textAlign = 'left';
  serif(ctx, `QuotationID: ${data.quoteNo}`, TEXT_L, 507, 0.2);
  ctx.textAlign = 'right';
  serif(ctx, `Date: ${formatDate(data.quoteDate)}`, TEXT_R + 7, 507, 0.2);

  // Section heading.
  ctx.textAlign = 'center';
  ctx.fillStyle = PINK;
  ctx.font = `400 38px ${SANS}`;
  ctx.fillText('Order Summary', W / 2 + 8, 596);

  // Item rows.
  let y = 706;
  for (const row of rows) {
    ctx.fillStyle = GRAY;
    ctx.textAlign = 'left';
    const priceFont = (s: number) => `400 ${s}px ${SERIF}`;
    ctx.font = priceFont(ROW_SIZE);
    const priceW = ctx.measureText(row.price).width;
    const nameMax = TEXT_R - TEXT_L - priceW - 30;
    const nameSize = fitText(ctx, row.name, priceFont, ROW_SIZE, nameMax);
    ctx.font = priceFont(nameSize);
    serif(ctx, row.name, TEXT_L, y);

    ctx.textAlign = 'right';
    ctx.font = row.free ? priceFont(44) : priceFont(ROW_SIZE);
    serif(ctx, row.price, TEXT_R, y);
    y += ROW_PITCH;
  }

  // Divider and total.
  const ruleY = y - 7;
  ctx.fillStyle = RULE;
  ctx.fillRect(TEXT_L - 1, ruleY, 635, 2);

  const totalY = ruleY + 85;
  ctx.textAlign = 'left';
  ctx.fillStyle = GRAY;
  ctx.font = `400 ${ROW_SIZE}px ${SERIF}`;
  serif(ctx, 'Total', TEXT_L, totalY);
  ctx.textAlign = 'right';
  ctx.fillStyle = PINK;
  serif(ctx, `${fmt(total)} ฿`, TEXT_R, totalY);

  // Footer.
  ctx.textAlign = 'center';
  ctx.fillStyle = GRAY;
  ctx.font = `400 29px ${SERIF}`;
  serif(ctx, 'This quotation is valid for 24 hours. Product availability and', W / 2, totalY + 87, 0.2);
  serif(ctx, 'prices are subject to change until your order is confirmed.', W / 2, totalY + 122, 0.2);
  ctx.fillStyle = PINK;
  serif(ctx, 'Thank you for choosing So Chic Gifts ♡', W / 2, totalY + 167, 0.2);

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image.'))), 'image/png');
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
