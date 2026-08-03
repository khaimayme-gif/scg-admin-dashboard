import { useState } from 'react';
import { calculatePrice, saveQuote, type PriceItem, type CalculationResult } from './api';

let nextId = 1;
const newItem = (): PriceItem => ({ id: String(nextId++), name: '', cost: 0 });

export default function PriceCalculator() {
  const [activeTab, setActiveTab] = useState<'thailand' | 'japan'>('thailand');
  const [items, setItems] = useState<PriceItem[]>([newItem(), newItem()]);
  const [deliveryFee, setDeliveryFee] = useState<number>(100);
  const [includeDigitalWebsite, setIncludeDigitalWebsite] = useState(false);
  const [digitalWebsiteTier, setDigitalWebsiteTier] = useState<'standard' | 'premium'>('standard');
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'calculating' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Japan order state - gift cost, a manually-entered Japan admin fee, and an auto-derived Thailand admin fee
  const [giftCostYen, setGiftCostYen] = useState<number>(0);
  const [japanFeeYen, setJapanFeeYen] = useState<number>(0);
  const [thailandFeeYen, setThailandFeeYen] = useState<number>(0);
  const [japanTotal, setJapanTotal] = useState<number | null>(null);
  const [japanStatus, setJapanStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [japanErrorMsg, setJapanErrorMsg] = useState('');

  const ITEM_PRESETS = ['Cake', 'Real bouquet', 'Imitation bouquet', 'Toy bouquet', 'Candle', 'Postcard', 'Pop Mart blind box'];
  const DIGITAL_WEBSITE_PRICES = { standard: 800, premium: 2000 };

  const updateItem = (id: string, field: 'name' | 'cost', value: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, [field]: field === 'cost' ? Number(value) || 0 : value }
          : item
      )
    );
    setResult(null);
  };

  const addItem = () => setItems((prev) => [...prev, newItem()]);

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setResult(null);
  };

  const handleCalculate = async () => {
    setStatus('calculating');
    setErrorMsg('');
    try {
      const baseItems = items.filter((item) => item.name.trim() && item.cost > 0);
      const validItems = includeDigitalWebsite
        ? [...baseItems, { id: 'digital-website', name: `Digital website (${digitalWebsiteTier})`, cost: DIGITAL_WEBSITE_PRICES[digitalWebsiteTier] }]
        : baseItems;
      if (validItems.length === 0) {
        setErrorMsg('Add at least one item with a name and a cost above 0.');
        setStatus('error');
        return;
      }
      const calc = await calculatePrice(validItems, deliveryFee);
      setResult(calc);
      setStatus('idle');
    } catch {
      setErrorMsg('Could not reach the backend. Is it running on localhost:4000?');
      setStatus('error');
    }
  };

  const handleSave = async () => {
    if (!result) return;
    setStatus('saving');
    try {
      const baseItems = items.filter((item) => item.name.trim() && item.cost > 0);
      const validItems = includeDigitalWebsite
        ? [...baseItems, { id: 'digital-website', name: `Digital website (${digitalWebsiteTier})`, cost: DIGITAL_WEBSITE_PRICES[digitalWebsiteTier] }]
        : baseItems;
      await saveQuote(validItems, result);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setErrorMsg('Could not save the quote.');
      setStatus('error');
    }
  };

  const handleJapanCalculate = () => {
    if (giftCostYen <= 0) {
      setJapanErrorMsg('Enter a gift cost above 0.');
      setJapanStatus('error');
      return;
    }
    setJapanErrorMsg('');
    setJapanStatus('idle');
    const derivedThailandFee = japanFeeYen > 500 ? japanFeeYen - 500 : japanFeeYen;
    setThailandFeeYen(derivedThailandFee);
    setJapanTotal(giftCostYen + japanFeeYen + derivedThailandFee);
  };

  const handleJapanSave = async () => {
    if (japanTotal === null) return;
    setJapanStatus('saving');
    try {
      const res = await fetch('/api/japan-quotes/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          giftCost: giftCostYen,
          japanFee: japanFeeYen,
          thailandFee: thailandFeeYen,
          total: japanTotal,
        }),
      });
      if (!res.ok) throw new Error();
      setJapanStatus('saved');
      setTimeout(() => setJapanStatus('idle'), 2000);
    } catch {
      setJapanErrorMsg('Could not save the quote.');
      setJapanStatus('error');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Price Calculator</h1>
        <p className="page-subtitle">Real cost in, quote out. No more guessing what to charge.</p>
      </header>

      <div className="tab-switcher">
        <button
          className={`tab-btn ${activeTab === 'thailand' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('thailand')}
        >
          Thailand (THB)
        </button>
        <button
          className={`tab-btn ${activeTab === 'japan' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('japan')}
        >
          Japan Orders (Yen)
        </button>
      </div>

      {activeTab === 'thailand' && (
      <div className="calc-layout">
        <section className="calc-panel">
          <h2 className="panel-label">Real costs</h2>

          <div className="item-rows">
            {items.map((item) => (
              <div className="item-row" key={item.id}>
                <input
                  type="text"
                  placeholder="Item name (e.g. bouquet)"
                  value={item.name}
                  onChange={(e) => updateItem(item.id, 'name', e.target.value)}
                  className="item-input item-input-name"
                  list="item-options"
                />
                <div className="item-input-cost-wrap">
                  <span className="currency-prefix">THB</span>
                  <input
                    type="number"
                    placeholder="0"
                    value={item.cost || ''}
                    onChange={(e) => updateItem(item.id, 'cost', e.target.value)}
                    className="item-input item-input-cost"
                    min="0"
                  />
                </div>
                <button
                  className="item-remove"
                  onClick={() => removeItem(item.id)}
                  aria-label={`Remove ${item.name || 'item'}`}
                  disabled={items.length <= 1}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <datalist id="item-options">
            {ITEM_PRESETS.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <button className="add-item-btn" onClick={addItem}>
            + Add item
          </button>

          <div className="delivery-row">
            <label>Include digital website?</label>
            <div className="toggle-group">
              <button type="button" className={`toggle-btn ${!includeDigitalWebsite ? 'is-active' : ''}`} onClick={() => { setIncludeDigitalWebsite(false); setResult(null); }}>No</button>
              <button type="button" className={`toggle-btn ${includeDigitalWebsite ? 'is-active' : ''}`} onClick={() => { setIncludeDigitalWebsite(true); setResult(null); }}>Yes</button>
            </div>
          </div>

          {includeDigitalWebsite && (
            <div className="delivery-row">
              <label>Package</label>
              <select
                value={digitalWebsiteTier}
                onChange={(e) => { setDigitalWebsiteTier(e.target.value as 'standard' | 'premium'); setResult(null); }}
                className="item-input"
              >
                <option value="standard">Standard - 800 THB</option>
                <option value="premium">Premium - 2000 THB</option>
              </select>
            </div>
          )}

          <div className="delivery-row">
            <label htmlFor="delivery-fee">Delivery fee (at cost, no markup)</label>
            <div className="item-input-cost-wrap">
              <span className="currency-prefix">THB</span>
              <input
                id="delivery-fee"
                type="number"
                value={deliveryFee || ''}
                onChange={(e) => {
                  setDeliveryFee(Number(e.target.value) || 0);
                  setResult(null);
                }}
                className="item-input item-input-cost"
                min="0"
              />
            </div>
          </div>

          <button
            className="calculate-btn"
            onClick={handleCalculate}
            disabled={status === 'calculating'}
          >
            {status === 'calculating' ? 'Calculating…' : 'Calculate quote'}
          </button>

          {status === 'error' && <p className="error-text">{errorMsg}</p>}
        </section>

        <section className="calc-panel calc-result-panel">
          <h2 className="panel-label">Quote breakdown</h2>

          {!result ? (
            <p className="empty-state">Fill in your costs and calculate to see the quote here.</p>
          ) : (
            <>
              <div className="ledger">
                <div className="ledger-row">
                  <span>Real cost of items</span>
                  <span className="ledger-value">{result.itemsCost.toFixed(2)} THB</span>
                </div>
                <div className="ledger-row">
                  <span>Markup ({result.markupPercent}%)</span>
                  <span className="ledger-value">{(result.markedUpItemsCost - result.itemsCost).toFixed(2)} THB</span>
                </div>
                <div className="ledger-row">
                  <span>Delivery (at cost)</span>
                  <span className="ledger-value">{result.deliveryFee.toFixed(2)} THB</span>
                </div>
                <div className="ledger-divider" />
                <div className="ledger-row ledger-total">
                  <span>Total to quote</span>
                  <span className="ledger-value">{result.total.toFixed(2)} THB</span>
                </div>
              </div>

              <button
                className="save-btn"
                onClick={handleSave}
                disabled={status === 'saving' || status === 'saved'}
              >
                {status === 'saved' ? 'Saved ✓' : status === 'saving' ? 'Saving…' : 'Save this quote'}
              </button>
            </>
          )}
        </section>
      </div>
      )}

      {activeTab === 'japan' && (
      <div className="calc-layout">
        <section className="calc-panel">
          <h2 className="panel-label">Order details</h2>

          <div className="delivery-row">
            <label htmlFor="gift-cost-yen">Gift cost</label>
            <div className="item-input-cost-wrap">
              <span className="currency-prefix">¥</span>
              <input
                id="gift-cost-yen"
                type="number"
                value={giftCostYen || ''}
                onChange={(e) => { setGiftCostYen(Number(e.target.value) || 0); setJapanTotal(null); }}
                className="item-input item-input-cost"
                min="0"
              />
            </div>
          </div>

          <div className="delivery-row">
            <label htmlFor="japan-fee-yen">Japan admin fee</label>
            <div className="item-input-cost-wrap">
              <span className="currency-prefix">¥</span>
              <input
                id="japan-fee-yen"
                type="number"
                value={japanFeeYen || ''}
                onChange={(e) => { setJapanFeeYen(Number(e.target.value) || 0); setJapanTotal(null); }}
                className="item-input item-input-cost"
                min="0"
              />
            </div>
          </div>

          <p className="field-hint">Thailand admin fee is calculated automatically: Japan fee - 500 (or same as Japan fee if 500 or less).</p>

          <button className="calculate-btn" onClick={handleJapanCalculate}>
            Calculate quote
          </button>

          {japanStatus === 'error' && <p className="error-text">{japanErrorMsg}</p>}
        </section>

        <section className="calc-panel calc-result-panel">
          <h2 className="panel-label">Quote breakdown</h2>

          {japanTotal === null ? (
            <p className="empty-state">Fill in the gift cost and Japan admin fee, then calculate.</p>
          ) : (
            <>
              <div className="ledger">
                <div className="ledger-row">
                  <span>Gift cost</span>
                  <span className="ledger-value">¥{giftCostYen.toFixed(0)}</span>
                </div>
                <div className="ledger-row">
                  <span>Japan admin fee</span>
                  <span className="ledger-value">¥{japanFeeYen.toFixed(0)}</span>
                </div>
                <div className="ledger-row">
                  <span>Thailand admin fee</span>
                  <span className="ledger-value">¥{thailandFeeYen.toFixed(0)}</span>
                </div>
                <div className="ledger-divider" />
                <div className="ledger-row ledger-total">
                  <span>Total to quote</span>
                  <span className="ledger-value">¥{japanTotal.toFixed(0)}</span>
                </div>
              </div>

              <button
                className="save-btn"
                onClick={handleJapanSave}
                disabled={japanStatus === 'saving' || japanStatus === 'saved'}
              >
                {japanStatus === 'saved' ? 'Saved ✓' : japanStatus === 'saving' ? 'Saving…' : 'Save this quote'}
              </button>
            </>
          )}
        </section>
      </div>
      )}
    </div>
  );
}
