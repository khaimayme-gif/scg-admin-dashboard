import '@fontsource/arsenal/400.css';
import '@fontsource/arsenal/700.css';
import '@fontsource/noto-sans-myanmar/400.css';
import birthdayBg from './assets/love-note-birthday.png';

// The printed love note that goes with every order. The artwork (bow, frame, hearts, the title, "With
// love," and the closing line) is a fixed image; only the date, the greeting, the message and the
// name are drawn on top. Positions are in pixels of that artwork, so a sharper copy of the same
// artwork (same shape) can replace the file and the text lands in the same places.

export interface LoveNoteTemplate {
  id: string;
  name: string;
  background: string;
  width: number; // artwork size in px
  height: number;
  color: string;
  defaultGreeting: string;
  date: { x: number; y: number; size: number; spacing: number }; // centred
  greeting: { x: number; y: number; size: number; maxWidth: number };
  body: { x: number; y: number; maxWidth: number; maxBottom: number; size: number; minSize: number; pitch: number };
  from: { x: number; y: number; size: number }; // right-aligned at x
}

export const LOVE_NOTE_TEMPLATES: LoveNoteTemplate[] = [
  {
    id: 'birthday',
    name: 'Birthday',
    background: birthdayBg,
    width: 624,
    height: 892,
    color: '#bb2e33',
    defaultGreeting: 'Happy Birthday, Baby!',
    date: { x: 316, y: 206.5, size: 21, spacing: 1 },
    greeting: { x: 161.5, y: 321.5, size: 19.5, maxWidth: 335 },
    body: { x: 161.5, y: 381.5, maxWidth: 335, maxBottom: 496, size: 19.5, minSize: 12, pitch: 1.55 },
    from: { x: 473, y: 572, size: 24 },
  },
];

export interface LoveNoteText {
  greeting: string;
  body: string;
  from: string;
  date: string; // already written out, e.g. "18 October, 2026"
}

const FONT = "'Arsenal', 'Noto Sans Myanmar', sans-serif";

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "2026-10-18" → "18 October, 2026"
export const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${d} ${MONTHS[m - 1]}, ${y}`;
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

const loadFonts = () =>
  Promise.all([document.fonts.load(`400 40px ${FONT}`), document.fonts.load(`700 40px ${FONT}`), document.fonts.load(`400 40px 'Noto Sans Myanmar'`)]);

// Breaks a paragraph into lines no wider than maxWidth. A word that is wider than a line on its own
// (Burmese text has few spaces) is broken between characters.
const wrap = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const lines: string[] = [];
  let line = '';
  const push = (word: string) => {
    const tryLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(tryLine).width <= maxWidth) {
      line = tryLine;
      return;
    }
    if (line) {
      lines.push(line);
      line = '';
    }
    if (ctx.measureText(word).width <= maxWidth) {
      line = word;
      return;
    }
    for (const ch of Array.from(word)) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
  };
  text.split(/\s+/).filter(Boolean).forEach(push);
  if (line) lines.push(line);
  return lines;
};

export interface LoveNoteResult {
  canvas: HTMLCanvasElement;
  overflow: boolean; // the message is too long to fit even at the smallest size
}

export async function drawLoveNote(template: LoveNoteTemplate, text: LoveNoteText, scale = 3): Promise<LoveNoteResult> {
  const [bg] = await Promise.all([loadImage(template.background), loadFonts()]);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(template.width * scale);
  canvas.height = Math.round(template.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.fillStyle = template.color;
  ctx.textBaseline = 'alphabetic';

  // Date, centred above the title.
  if (text.date) {
    const d = template.date;
    ctx.font = `400 ${d.size}px ${FONT}`;
    ctx.letterSpacing = `${d.spacing}px`;
    ctx.textAlign = 'center';
    ctx.fillText(text.date, d.x + d.spacing / 2, d.y);
    ctx.letterSpacing = '0px';
  }

  // Greeting: one line, shrunk if it is long.
  ctx.textAlign = 'left';
  const g = template.greeting;
  let gs = g.size;
  ctx.font = `400 ${gs}px ${FONT}`;
  while (ctx.measureText(text.greeting).width > g.maxWidth && gs > 12) {
    gs -= 0.5;
    ctx.font = `400 ${gs}px ${FONT}`;
  }
  if (text.greeting) ctx.fillText(text.greeting, g.x, g.y);

  // Message: the largest size at which it fits between the greeting and "With love,".
  const b = template.body;
  const paragraphs = text.body.replace(/\r/g, '').split('\n');
  let size = b.size;
  let lines: string[] = [];
  let overflow = false;
  for (;;) {
    ctx.font = `400 ${size}px ${FONT}`;
    lines = [];
    for (const p of paragraphs) {
      if (p.trim() === '') lines.push('');
      else lines.push(...wrap(ctx, p, b.maxWidth));
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const lastBaseline = b.y + (lines.length - 1) * size * b.pitch;
    if (lastBaseline <= b.maxBottom) break;
    if (size <= b.minSize) {
      overflow = true;
      break;
    }
    size -= 0.5;
  }
  lines.forEach((line, i) => {
    if (line) ctx.fillText(line, b.x, b.y + i * size * b.pitch);
  });

  // From, under "With love,".
  if (text.from) {
    ctx.textAlign = 'right';
    const f = template.from;
    let fs = f.size;
    ctx.font = `400 ${fs}px ${FONT}`;
    while (ctx.measureText(text.from).width > 200 && fs > 12) {
      fs -= 0.5;
      ctx.font = `400 ${fs}px ${FONT}`;
    }
    ctx.fillText(text.from, f.x, f.y);
  }

  return { canvas, overflow };
}

export async function renderLoveNotePng(template: LoveNoteTemplate, text: LoveNoteText, scale = 3): Promise<{ blob: Blob; overflow: boolean }> {
  const { canvas, overflow } = await drawLoveNote(template, text, scale);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image'))), 'image/png'));
  return { blob, overflow };
}
