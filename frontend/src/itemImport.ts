import readExcelFile from 'read-excel-file/browser';

// One row of the "Items" sheet of the import template.
export interface ImportRow {
  line: number; // row number in the Excel sheet, for error messages
  type: string;
  group: string;
  name: string;
  detail: string;
  price: number | null;
  cost: number | null;
  photoName: string;
  show: boolean;
}

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');

// Columns are found by their header names, so reordering or adding columns doesn't matter.
const COLUMNS: Record<string, string> = {
  type: 'itemtype',
  group: 'group',
  name: 'itemname',
  detail: 'detail',
  price: 'sellingpricethb',
  cost: 'costthb',
  photoName: 'photofilename',
  show: 'showonwebsite',
};

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

export async function readItemsWorkbook(file: File): Promise<ImportRow[]> {
  const sheets = await readExcelFile(file);
  const sheet = sheets.find((s) => s.sheet === 'Items') ?? sheets.find((s) => s.data[0]?.some((h) => norm(h) === 'itemname'));
  if (!sheet) throw new Error('Could not find the Items sheet. Use the import template.');

  const header = sheet.data[0] ?? [];
  const index: Record<string, number> = {};
  for (const [key, wanted] of Object.entries(COLUMNS)) {
    index[key] = header.findIndex((h) => norm(h) === wanted);
  }
  if (index.type < 0 || index.name < 0 || index.price < 0) {
    throw new Error('The Items sheet needs the columns Item Type, Item Name and Selling Price THB.');
  }

  const cell = (row: unknown[], key: string) => (index[key] >= 0 ? row[index[key]] : undefined);
  const rows: ImportRow[] = [];
  sheet.data.slice(1).forEach((row, i) => {
    if (!row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')) return;
    rows.push({
      line: i + 2,
      type: text(cell(row, 'type')),
      group: text(cell(row, 'group')),
      name: text(cell(row, 'name')),
      detail: text(cell(row, 'detail')),
      price: num(cell(row, 'price')),
      cost: num(cell(row, 'cost')),
      photoName: text(cell(row, 'photoName')),
      show: !/^no$/i.test(text(cell(row, 'show'))),
    });
  });
  return rows;
}
