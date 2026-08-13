const API_BASE = '/api';

export interface PriceItem {
  id: string;
  name: string;
  cost: number;
}

export interface CalculationResult {
  itemsCost: number;
  markupPercent: number;
  markedUpItemsCost: number;
  deliveryFee: number;
  total: number;
}

export async function calculatePrice(items: PriceItem[], deliveryFee: number): Promise<CalculationResult> {
  const res = await fetch(`${API_BASE}/price-calculator/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: items.map(({ name, cost }) => ({ name, cost })),
      deliveryFee,
    }),
  });
  if (!res.ok) throw new Error('Failed to calculate price');
  return res.json();
}

export async function saveQuote(items: PriceItem[], result: CalculationResult): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/price-calculator/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: items.map(({ name, cost }) => ({ name, cost })),
      markupPercent: result.markupPercent,
      deliveryFee: result.deliveryFee,
      total: result.total,
    }),
  });
  if (!res.ok) throw new Error('Failed to save quote');
  return res.json();
}
