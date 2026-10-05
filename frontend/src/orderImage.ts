import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/linden-hill/400.css';
import bowUrl from './assets/quotation-bow.png';

// Draws the "Order Confirmation" card as a PNG, matching the Canva template.
// Only customer-facing information goes in: who, where, when, what, and selling prices.
// Cost prices and revenue are never passed in here.

export interface OrderImageItem {
  name: string;
  quantity: number;
  sellingPrice: number; // per unit
  details: string; // free text, one line per detail ("Text on cake: ...")
}

export interface OrderImageData {
  orderNo: string; // e.g. SCG-20260929-001
  orderDate: string; // YYYY-MM-DD
  customer: string; // e.g. "Jasmine / TikTok"
  recipient: string;
  recipientPhone: string;
  deliveryDate: string; // YYYY-MM-DD or ''
  deliveryAddress: string;
  deliveryNote: string;
  items: OrderImageItem[];
  total: number;
  currency: string;
  paymentLabel: string; // e.g. "fully paid"
  paymentTone: 'paid' | 'pending' | 'cancelled';
}

const SANS = "'Space Grotesk', 'Noto Sans Thai', 'Noto Sans Myanmar', sans-serif";
const SERIF = "'Linden Hill', 'Noto Serif Thai', 'Noto Serif Myanmar', serif";

const GRAY = '#5b5c62';
const RULE = '#d4d4d8';
const BG = '#fffafc';
const DOT = '#ffdeeb';

const PILL: Record<OrderImageData['paymentTone'], { bg: string; fg: string }> = {
  paid: { bg: '#b8f5a8', fg: '#3f5c38' },
  pending: { bg: '#fbe3a6', fg: '#6d5316' },
  cancelled: { bg: '#f6c9c9', fg: '#7a2f2f' },
};

const W = 1080;
const MIN_H = 1920; // 9:16, the template's shape
const CARD_X = 93;
const CARD_R = 54;
const TEXT_L = 222;
const TEXT_R = 858;

const ROW_SIZE = 31; // label / value rows
const ROW_PITCH = 50;
const ITEM_SIZE = 32;
const DETAIL_SIZE = 20;
const DETAIL_PITCH = 28;

const CURRENCY_SIGN: Record<string, string> = { THB: '฿', JPY: '¥', MMK: 'Ks' };

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const money = (n: number, currency: string) => `${fmt(n)} ${CURRENCY_SIGN[currency] ?? currency}`;

const formatDate = (iso: string) => {
  if (!iso) return '';
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
    document.fonts.load(`700 66px ${SANS}`),
    document.fonts.load(`400 28px ${SANS}`),
    document.fonts.load(`400 31px ${SERIF}`),
  ]);

// Linden Hill is lighter than the template's serif, so a hairline stroke in the same colour adds weight.
const serif = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, weight = 0.4) => {
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = weight;
  ctx.lineJoin = 'round';
  ctx.fillText(text, x, y);
  ctx.strokeText(text, x, y);
};

// Greedy word wrap using the context's current font. A single word wider than maxW is split
// by character, so a long unbroken address or Thai text (no spaces) still fits.
const wrap = (ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] => {
  const fits = (t: string) => ctx.measureText(t).width <= maxW;
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const token of paragraph.split(/(\s+)/).filter(Boolean)) {
      if (fits(line + token)) {
        line += token;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = token.trimStart();
      // Still too wide on its own line: break it by character.
      while (line && !fits(line)) {
        let cut = 1;
        while (cut < line.length && fits(line.slice(0, cut + 1))) cut += 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  const nonEmpty = lines.filter((l) => l !== '');
  return nonEmpty.length > 0 ? nonEmpty : [''];
};

// Measures and draws in two passes: first to find the height, then for real on a canvas of that height.
type Draw = (ctx: CanvasRenderingContext2D, paint: boolean) => number;

const layout = (data: OrderImageData, bow: HTMLImageElement): Draw => (ctx, paint) => {
  const text = (s: string, x: number, y: number, align: CanvasTextAlign, font: string, useSerif = false) => {
    if (!paint) return;
    ctx.textAlign = align;
    ctx.font = font;
    if (useSerif) serif(ctx, s, x, y);
    else ctx.fillText(s, x, y);
  };

  if (paint) {
    const bw = bow.width * 1.1;
    const bh = bow.height * 1.1;
    ctx.drawImage(bow, (W - bw) / 2, 100, bw, bh);
  }

  ctx.fillStyle = GRAY;

  // Wordmark sits on the bow's tails.
  if (paint) {
    ctx.letterSpacing = '4px';
    text('SOCHICGIFTS', W / 2 + 2, 318, 'center', `700 25px ${SANS}`);
    ctx.letterSpacing = '1px';
    text('ORDER', W / 2, 408, 'center', `700 70px ${SANS}`);
    text('CONFIRMATION', W / 2, 480, 'center', `700 70px ${SANS}`);
    ctx.letterSpacing = '0px';
    text('Your surprise is officially in the making ♡', W / 2, 546, 'center', `400 28px ${SANS}`);
    text(`Order ID: ${data.orderNo}`, TEXT_L, 604, 'left', `400 20px ${SERIF}`, true);
    text(`Date: ${formatDate(data.orderDate)}`, TEXT_R, 604, 'right', `400 20px ${SERIF}`, true);
    ctx.letterSpacing = '1px';
    text('ORDER DETAILS', W / 2, 650, 'center', `400 27px ${SANS}`);
    ctx.letterSpacing = '0px';
  }

  // Label / value rows. Values are right-aligned and wrap onto extra lines if long.
  const rowFont = `400 ${ROW_SIZE}px ${SERIF}`;
  let y = 700;
  const rows: [string, string][] = [
    ['Customer', data.customer],
    ['Recipient', data.recipient],
    ['Phone', data.recipientPhone],
    ['Delivery Date', formatDate(data.deliveryDate)],
    ['Delivery Address', data.deliveryAddress],
    ['Delivery Note', data.deliveryNote],
  ];
  ctx.font = rowFont;
  for (const [label, value] of rows) {
    const labelW = ctx.measureText(label).width;
    const lines = wrap(ctx, value || '—', TEXT_R - TEXT_L - labelW - 40);
    text(label, TEXT_L, y, 'left', rowFont, true);
    lines.forEach((line, i) => text(line, TEXT_R, y + i * (ROW_PITCH - 8), 'right', rowFont, true));
    y += ROW_PITCH + (lines.length - 1) * (ROW_PITCH - 8);
  }

  // Divider, then the gift selection.
  y += 14;
  if (paint) {
    ctx.fillStyle = RULE;
    ctx.fillRect(TEXT_L, y, TEXT_R - TEXT_L, 2);
    ctx.fillStyle = GRAY;
  }
  y += 62;
  if (paint) ctx.letterSpacing = '1px';
  text('YOUR GIFT SELECTION', W / 2, y, 'center', `400 27px ${SANS}`);
  if (paint) ctx.letterSpacing = '0px';
  y += 52;

  const itemFont = `400 ${ITEM_SIZE}px ${SERIF}`;
  const detailFont = `400 ${DETAIL_SIZE}px ${SERIF}`;
  data.items.forEach((item, index) => {
    const lineTotal = item.sellingPrice * item.quantity;
    const price = lineTotal > 0 ? money(lineTotal, data.currency) : 'Complimentary';
    const no = String(index + 1).padStart(2, '0');
    const name = `${no} · ${item.name}${item.quantity > 1 ? ` × ${item.quantity}` : ''}`;

    ctx.font = itemFont;
    const priceW = ctx.measureText(price).width;
    const nameLines = wrap(ctx, name, TEXT_R - TEXT_L - priceW - 40);
    nameLines.forEach((line, i) => text(line, TEXT_L, y + i * (ITEM_SIZE + 8), 'left', itemFont, true));
    text(price, TEXT_R, y, 'right', itemFont, true);
    y += (nameLines.length - 1) * (ITEM_SIZE + 8);

    ctx.font = detailFont;
    const details = item.details.trim() ? wrap(ctx, item.details.trim(), TEXT_R - TEXT_L) : [];
    if (details.length > 0) y += 8;
    for (const line of details) {
      y += DETAIL_PITCH;
      text(line, TEXT_L, y, 'left', detailFont, true);
    }
    y += 64;
  });

  // Divider, total, payment status.
  y -= 22;
  if (paint) {
    ctx.fillStyle = RULE;
    ctx.fillRect(TEXT_L, y, TEXT_R - TEXT_L, 2);
    ctx.fillStyle = GRAY;
  }
  y += 62;
  text('Order Total', TEXT_L, y, 'left', rowFont, true);
  text(money(data.total, data.currency), TEXT_R, y, 'right', rowFont, true);
  y += ROW_PITCH - 6;
  text('Payment Status', TEXT_L, y, 'left', rowFont, true);
  if (paint) {
    const pill = PILL[data.paymentTone];
    ctx.font = `400 26px ${SERIF}`;
    const pw = ctx.measureText(data.paymentLabel).width + 28;
    ctx.fillStyle = pill.bg;
    ctx.beginPath();
    ctx.roundRect(TEXT_R - pw + 6, y - 28, pw, 38, 10);
    ctx.fill();
    ctx.fillStyle = pill.fg;
    text(data.paymentLabel, TEXT_R - 8, y, 'right', `400 26px ${SERIF}`, true);
    ctx.fillStyle = GRAY;
  }

  // Footer.
  y += 60;
  if (paint) ctx.letterSpacing = '1px';
  text('PLEASE REVIEW YOUR ORDER', W / 2, y, 'center', `400 27px ${SANS}`);
  if (paint) ctx.letterSpacing = '0px';
  y += 50;
  const footFont = `400 23px ${SERIF}`;
  ctx.font = footFont;
  const footer = wrap(
    ctx,
    'Please check all order details carefully, especially the delivery address, date, product ' +
      'specifications, and personalized messages. Contact our admin immediately if any ' +
      'information is incorrect.',
    780
  );
  for (const line of footer) {
    text(line, W / 2, y, 'center', footFont, true);
    y += 35;
  }
  text('Thank you for choosing So Chic Gifts ♡', W / 2, y, 'center', footFont, true);

  return y; // baseline of the last line
};

export async function renderOrderPng(data: OrderImageData): Promise<Blob> {
  const [bow] = await Promise.all([loadImage(bowUrl), loadFonts()]);
  const draw = layout(data, bow);

  // Pass 1: measure how tall the content is.
  const probe = document.createElement('canvas').getContext('2d')!;
  const lastY = draw(probe, false);
  const cardTop = 177;
  const cardBottom = lastY + 46;
  const H = Math.max(MIN_H, cardBottom + 112);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';

  // Background: staggered polka dots.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = DOT;
  for (let y = 20, j = 0; y < H + 40; y += 40, j++) {
    const offset = j % 2 === 0 ? 20 : 60;
    for (let x = offset; x < W + 40; x += 80) {
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // White card. When the content is short the card still fills the 9:16 frame.
  const bottom = Math.max(cardBottom, H - 112);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(CARD_X, cardTop, W - CARD_X * 2, bottom - cardTop, CARD_R);
  ctx.fill();

  // Pass 2: draw for real.
  draw(ctx, true);

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image.'))), 'image/png');
  });
}
