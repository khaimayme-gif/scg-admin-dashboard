const { requireAuth } = require('../../lib/auth');

const MARKUP_PERCENT = 40;

module.exports = (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;

  const { items, deliveryFee } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }

  const itemsCost = items.reduce((sum, item) => sum + Number(item.cost || 0), 0);
  const markedUpItemsCost = itemsCost * (1 + MARKUP_PERCENT / 100);
  const delivery = Number(deliveryFee || 0);
  const total = markedUpItemsCost + delivery;

  res.status(200).json({
    itemsCost,
    markupPercent: MARKUP_PERCENT,
    markedUpItemsCost: Math.round(markedUpItemsCost * 100) / 100,
    deliveryFee: delivery,
    total: Math.round(total * 100) / 100,
  });
};