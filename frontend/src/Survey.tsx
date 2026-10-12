import { useState, useEffect } from 'react';
import logo from './assets/sochic-logo-pink.png';

// The customer survey. Public page at /survey (no login), opened from a link or QR code that the
// admin shares after an order has been delivered. ?c=thailand or ?c=japan says which country the
// link was made for, so the answers can be shown to the right admin.
//
// The form is in Burmese only. All the wording is in TEXT below so it is easy to adjust.
const TEXT = {
  title: 'သင့်အတွေ့အကြုံကို ပြောပြပါ',
  intro: 'သင့်အော်ဒါကို လက်ခံရရှိပြီးပါပြီ။ မေးခွန်း ၃ ခုသာ ဖြေပေးပါ။ စက္ကန့်ပိုင်းသာ ကြာပါမည်။',
  nameLabel: 'သင့်အမည်',
  namePlaceholder: 'အမည် ရေးပါ',
  q1: '၁။ သင့်အော်ဒါကို အချိန်မီနှင့် ကောင်းမွန်သော အခြေအနေဖြင့် ရရှိခဲ့ပါသလား။',
  delivery: {
    perfect: 'ဟုတ်ကဲ့၊ အားလုံး ပြည့်စုံကောင်းမွန်ပါတယ်',
    minor: 'အနည်းငယ် ပြဿနာရှိပါတယ်',
    problem: 'ပြဿနာရှိပါတယ်',
  },
  q2: '၂။ ယေဘုယျအားဖြင့် ဘယ်လောက် ကျေနပ်ပါသလဲ။',
  low: 'မကျေနပ်ပါ',
  high: 'အလွန်ကျေနပ်ပါတယ်',
  q3: '၃။ ကျွန်ုပ်တို့ကို ပြောချင်တာ ရှိရင် ရေးပေးပါ။ (မဖြစ်မနေ မလိုပါ)',
  feedbackPlaceholder: 'သင့်အကြံပြုချက်…',
  submit: 'ပို့မည်',
  sending: 'ပို့နေပါသည်…',
  needName: 'အမည် ရေးပေးပါ။',
  needDelivery: 'ပထမမေးခွန်းကို ရွေးပေးပါ။',
  needRating: 'ကျေနပ်မှု အဆင့်ကို ရွေးပေးပါ။',
  failed: 'ပို့၍ မရပါ။ နောက်မှ ထပ်ကြိုးစားပါ။',
  tooMany: 'ခဏစောင့်ပြီး ပြန်ကြိုးစားပါ။',
  thanksTitle: 'ကျေးဇူးတင်ပါတယ်!',
  thanksBody: 'သင့်ထင်မြင်ချက်ကို လက်ခံရရှိပါပြီ။ So Chic Gifts ကို ရွေးချယ်ပေးသည့်အတွက် ကျေးဇူးအများကြီး တင်ပါတယ် ♡',
};

type Delivery = 'perfect' | 'minor' | 'problem';
const DELIVERY_OPTIONS: Delivery[] = ['perfect', 'minor', 'problem'];

export default function Survey() {
  const [name, setName] = useState('');
  const [delivery, setDelivery] = useState<Delivery | ''>('');
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [website, setWebsite] = useState(''); // hidden field, only bots fill it in
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  // Myanmar text needs a font that has it; phones usually do, but this makes it look the same everywhere.
  useEffect(() => {
    document.title = 'So Chic Gifts';
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Myanmar:wght@400;600&display=swap';
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(TEXT.needName);
    if (!delivery) return setError(TEXT.needDelivery);
    if (!rating) return setError(TEXT.needRating);
    setError('');
    setSending(true);
    try {
      const country = new URLSearchParams(window.location.search).get('c');
      const res = await fetch('/api/public/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, delivery, rating, feedback, country, website }),
      });
      if (res.status === 429) setError(TEXT.tooMany);
      else if (!res.ok) setError(TEXT.failed);
      else setDone(true);
    } catch {
      setError(TEXT.failed);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="survey-page">
      <div className="survey-card">
        <img className="survey-logo" src={logo} alt="So Chic Gifts" />

        {done ? (
          <div className="survey-thanks">
            <h1>{TEXT.thanksTitle}</h1>
            <p>{TEXT.thanksBody}</p>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <h1>{TEXT.title}</h1>
            <p className="survey-intro">{TEXT.intro}</p>

            <label className="survey-label" htmlFor="survey-name">{TEXT.nameLabel}</label>
            <input
              id="survey-name"
              className="survey-input"
              value={name}
              maxLength={80}
              placeholder={TEXT.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />

            <fieldset className="survey-block">
              <legend className="survey-label">{TEXT.q1}</legend>
              {DELIVERY_OPTIONS.map((d) => (
                <label key={d} className={`survey-choice ${delivery === d ? 'is-picked' : ''}`}>
                  <input type="radio" name="delivery" value={d} checked={delivery === d} onChange={() => setDelivery(d)} />
                  <span>{TEXT.delivery[d]}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="survey-block">
              <legend className="survey-label">{TEXT.q2}</legend>
              <div className="survey-stars" role="radiogroup" aria-label={TEXT.q2}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={rating === n}
                    aria-label={`${n} / 5`}
                    className={`survey-star ${n <= rating ? 'is-on' : ''}`}
                    onClick={() => setRating(n)}
                  >
                    ★
                  </button>
                ))}
              </div>
              <div className="survey-scale"><span>{TEXT.low}</span><span>{TEXT.high}</span></div>
            </fieldset>

            <label className="survey-label" htmlFor="survey-feedback">{TEXT.q3}</label>
            <textarea
              id="survey-feedback"
              className="survey-input"
              rows={4}
              value={feedback}
              maxLength={1000}
              placeholder={TEXT.feedbackPlaceholder}
              onChange={(e) => setFeedback(e.target.value)}
            />

            {/* Bots fill every field; people never see this one. */}
            <input
              className="survey-trap"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />

            {error && <p className="survey-error" role="alert">{error}</p>}
            <button className="survey-submit" type="submit" disabled={sending}>
              {sending ? TEXT.sending : TEXT.submit}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
