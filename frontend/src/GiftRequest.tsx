import { useEffect, useState } from 'react';
import logo from './assets/sochic-logo-pink.png';

// The gift-website request form. Public page at /request/<token> (no login), opened from a private link
// the admin makes for one order. The customer says what they want on their gift website; the
// admin turns the answers into a draft website.
//
// The form is in Burmese and English (switch at the top). All the wording is in TEXT below.
type Lang = 'my' | 'en';

const TEXT = {
  my: {
    title: 'သင့်ချစ်သူအတွက် Gift Website',
    intro: 'အောက်ပါအချက်အလက်များကို ဖြည့်ပေးပါ။ သင့်အတွက် အထူး Gift Website လေး ဖန်တီးပေးပြီး QR code ကို ပြန်ပို့ပေးပါမယ် ♡',
    occasion: 'Website လေးကဘာအတွက်လဲ?',
    birthday: 'မွေးနေ့',
    anniversary: 'Anniversary',
    eventDate: 'Website ကို ဘယ်နေ့မှာ ဖွင့်ကြည့်စေချင်ပါသလဲ',
    receiverName: "သူ့ကိုခေါ်တဲ့ နာမည် (recipient's nickname)",
    senderName: "သင့်နာမည် (sender's nickname)",
    relationStart: 'ချစ်သူဖြစ်ခဲ့တဲ့ နေ့စွဲ',
    relationHint: 'အတူရှိခဲ့တဲ့ ရက်အရေအတွက် ရေတွက်ပေးမယ့် စာမျက်နှာအတွက် သုံးပါမယ်',
    loveMessage: 'သူ့ကို ပြောချင်တဲ့ စာ / မက်ဆေ့ချ်',
    messagePlaceholder: 'ရင်ထဲက စကားတွေကို ရေးပါ…',
    writeForMe: 'မင်မင်တို့ကို ရေးပေးစေချင်ပါတယ်',
    photos: 'ဓာတ်ပုံများ',
    photosHint: 'ဓာတ်ပုံများကို chat ထဲမှာ ပို့ပေးပါ။',
    memory: 'အမှတ်တရ',
    memDate: 'ရက်စွဲ',
    memCaption: 'ပုံနဲ့လိုက်ဖတ်တဲ့စာလေး (ဥပမာ - ပထမဆုံး ခရီးသွားခဲ့တဲ့နေ့)',
    extras: 'ကိုယ်တိုင် ရေးချင်ပါသလား (မရေးလည်းရပါတယ်)',
    extrasNote: 'မရေးရင် မင်မင်တို့က ချစ်စရာကောင်းတဲ့ စာတွေ ရေးပေးပါမယ်',
    cakeWishes: 'ကိတ်မုန့်ပေါ်က ဆုတောင်းစာများ (၅ ခုအထိ)',
    reasons: 'သူ့ကို ချစ်ရတဲ့ အကြောင်းရင်းများ (၁၂ ခုအထိ)',
    password: 'QR ကတ်အတွက် လျှို့ဝှက်စကားလုံး (မရွေးလည်းရပါတယ်)',
    passwordHint: 'အင်္ဂလိပ်စာလုံး သို့မဟုတ် ဂဏန်း ၆ လုံးအထက်၊ နေရာလပ်မပါရ',
    submit: 'ပို့မည်',
    sending: 'ပို့နေပါသည်…',
    again: 'ဒီလင့်ခ်ကို အရင်က ဖြည့်ပြီးသားပါ။ ထပ်ပို့ရင် အသစ်ဖြင့် အစားထိုးပါမယ်။',
    errors: {
      occasion: 'အခါသမယကို ရွေးပေးပါ။',
      eventDate: 'ဖွင့်ကြည့်စေချင်တဲ့ နေ့စွဲကို ရွေးပေးပါ။',
      receiverName: 'သူ့နာမည် ရေးပေးပါ။',
      senderName: 'သင့်နာမည် ရေးပေးပါ။',
      relationStart: 'ချစ်သူဖြစ်ခဲ့တဲ့ နေ့စွဲကို ရွေးပေးပါ။',
      loveMessage: 'စာ ရေးပေးပါ၊ သို့မဟုတ် "ရေးပေးစေချင်ပါတယ်" ကို ရွေးပါ။',
      password: 'လျှို့ဝှက်စကားလုံးမှာ အင်္ဂလိပ်စာလုံး/ဂဏန်း ၆ လုံးအထက် ဖြစ်ရပါမယ်။',
      failed: 'ပို့၍ မရပါ။ နောက်မှ ထပ်ကြိုးစားပါ။',
      tooMany: 'ခဏစောင့်ပြီး ပြန်ကြိုးစားပါ။',
    },
    thanksTitle: 'ကျေးဇူးတင်ပါတယ်!',
    thanksBody: 'အချက်အလက်များ လက်ခံရရှိပါပြီ။ Website လေး ပြီးသွားရင် QR code ကို ပြန်ပို့ပေးပါမယ် ♡',
    notFound: 'ဒီလင့်ခ် မမှန်ပါ။ So Chic Gifts ကို ဆက်သွယ်ပါ။',
    closed: 'ဒီလင့်ခ်ကို အသုံးပြုပြီး ဖြစ်ပါပြီ။ ပြောင်းလဲလိုရင် So Chic Gifts ကို ဆက်သွယ်ပါ။',
    loading: 'ခဏစောင့်ပါ…',
  },
  en: {
    title: 'A gift website for your love',
    intro: "Fill in the details below. We'll make a special gift website for you and send the QR code back to you ♡",
    occasion: 'What is the website for?',
    birthday: 'Birthday',
    anniversary: 'Anniversary',
    eventDate: 'On which date should the website open?',
    receiverName: 'His name (what you call him)',
    senderName: 'Your name',
    relationStart: 'The date you got together',
    relationHint: 'Used for the page that counts the days you have been together',
    loveMessage: 'Your message or love letter to him',
    messagePlaceholder: 'Write what is in your heart…',
    writeForMe: 'Please write it for me',
    photos: 'Photos',
    photosHint: 'Please send photos in the chat.',
    memory: 'Memory',
    memDate: 'Date',
    memCaption: 'A short caption (e.g. Our first trip together)',
    extras: 'Want to write your own? (optional)',
    extrasNote: "If you leave these empty, we'll write sweet ones for you",
    cakeWishes: 'Wishes on the birthday cake (up to 5)',
    reasons: 'Reasons you love him (up to 12)',
    password: 'A secret password for the QR card (optional)',
    passwordHint: 'At least 6 letters or numbers, no spaces',
    submit: 'Send',
    sending: 'Sending…',
    again: 'You already filled this in. Sending again replaces your earlier answers.',
    errors: {
      occasion: 'Please choose the occasion.',
      eventDate: 'Please choose the date the website should open.',
      receiverName: 'Please enter his name.',
      senderName: 'Please enter your name.',
      relationStart: 'Please choose the date you got together.',
      loveMessage: 'Please write a message, or tick "Please write it for me".',
      password: 'The password needs at least 6 letters or numbers.',
      failed: 'Could not send. Please try again later.',
      tooMany: 'Please wait a little and try again.',
    },
    thanksTitle: 'Thank you!',
    thanksBody: "We've received your details. We'll send you the QR code once your website is ready ♡",
    notFound: 'This link is not valid. Please contact So Chic Gifts.',
    closed: 'This link has already been used. To change anything, please contact So Chic Gifts.',
    loading: 'One moment…',
  },
} as const;

interface Memory {
  photo: string;
  date: string;
  caption: string;
}

const emptyMemory = (): Memory => ({ photo: '', date: '', caption: '' });

export default function GiftRequest() {
  const token = window.location.pathname.replace(/\/+$/, '').split('/').pop() || '';
  const [lang, setLang] = useState<Lang>('my');
  const t = TEXT[lang];
  const [state, setState] = useState<'loading' | 'ready' | 'notFound' | 'closed'>('loading');
  const [already, setAlready] = useState(false);

  const [occasion, setOccasion] = useState<'birthday' | 'anniversary' | ''>('');
  const [eventDate, setEventDate] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [senderName, setSenderName] = useState('');
  const [relationStart, setRelationStart] = useState('');
  const [loveMessage, setLoveMessage] = useState('');
  const [writeForMe, setWriteForMe] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([emptyMemory(), emptyMemory(), emptyMemory()]);
  const [cakeWishes, setCakeWishes] = useState<string[]>(['', '', '', '', '']);
  const [reasons, setReasons] = useState<string[]>(Array(12).fill(''));
  const [password, setPassword] = useState('');
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

  useEffect(() => {
    fetch(`/api/public/request/${token}`)
      .then(async (res) => {
        if (res.status === 404) return setState('notFound');
        const data = await res.json().catch(() => ({}));
        if (data.status === 'closed') return setState('closed');
        setAlready(data.status === 'submitted');
        setState('ready');
      })
      .catch(() => setState('notFound'));
  }, [token]);

  const setMemory = (i: number, patch: Partial<Memory>) => setMemories((prev) => prev.map((m, k) => (k === i ? { ...m, ...patch } : m)));
  const setAt = (setter: React.Dispatch<React.SetStateAction<string[]>>, i: number, v: string) => setter((prev) => prev.map((x, k) => (k === i ? v : x)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const E = t.errors;
    if (!occasion) return setError(E.occasion);
    if (!eventDate) return setError(E.eventDate);
    if (!receiverName.trim()) return setError(E.receiverName);
    if (!senderName.trim()) return setError(E.senderName);
    if (!relationStart) return setError(E.relationStart);
    if (!loveMessage.trim() && !writeForMe) return setError(E.loveMessage);
    if (password.trim() && !/^[A-Za-z0-9._-]{6,40}$/.test(password.trim())) return setError(E.password);
    setError('');
    setSending(true);
    try {
      const res = await fetch(`/api/public/request/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          occasion, eventDate, receiverName, senderName, relationStart, loveMessage, writeForMe,
          memories, cakeWishes, reasons, password, website,
        }),
      });
      if (res.status === 429) setError(E.tooMany);
      else if (!res.ok) setError(E.failed);
      else setDone(true);
    } catch {
      setError(E.failed);
    } finally {
      setSending(false);
    }
  };

  const langToggle = (
    <div className="req-lang" role="group" aria-label="Language">
      <button type="button" className={lang === 'my' ? 'is-on' : ''} onClick={() => setLang('my')}>မြန်မာ</button>
      <button type="button" className={lang === 'en' ? 'is-on' : ''} onClick={() => setLang('en')}>English</button>
    </div>
  );

  return (
    <div className="survey-page">
      <div className="survey-card req-card">
        {langToggle}
        <img className="survey-logo" src={logo} alt="So Chic Gifts" />

        {state === 'loading' && <p className="survey-intro">{t.loading}</p>}
        {state === 'notFound' && <p className="survey-intro">{t.notFound}</p>}
        {state === 'closed' && <p className="survey-intro">{t.closed}</p>}

        {state === 'ready' && done && (
          <div className="survey-thanks">
            <h1>{t.thanksTitle}</h1>
            <p>{t.thanksBody}</p>
          </div>
        )}

        {state === 'ready' && !done && (
          <form onSubmit={submit} noValidate>
            <h1>{t.title}</h1>
            <p className="survey-intro">{t.intro}</p>
            {already && <p className="req-note">{t.again}</p>}

            <fieldset className="survey-block">
              <legend className="survey-label">{t.occasion}</legend>
              {(['birthday', 'anniversary'] as const).map((o) => (
                <label key={o} className={`survey-choice ${occasion === o ? 'is-picked' : ''}`}>
                  <input type="radio" name="occasion" checked={occasion === o} onChange={() => setOccasion(o)} />
                  <span>{t[o]}</span>
                </label>
              ))}
            </fieldset>

            <label className="survey-label req-gap" htmlFor="req-event">{t.eventDate}</label>
            <input id="req-event" type="date" className="survey-input" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />

            <label className="survey-label req-gap" htmlFor="req-to">{t.receiverName}</label>
            <input id="req-to" className="survey-input" value={receiverName} maxLength={40} onChange={(e) => setReceiverName(e.target.value)} />

            <label className="survey-label req-gap" htmlFor="req-from">{t.senderName}</label>
            <input id="req-from" className="survey-input" value={senderName} maxLength={40} onChange={(e) => setSenderName(e.target.value)} />

            <label className="survey-label req-gap" htmlFor="req-start">{t.relationStart}</label>
            <input id="req-start" type="date" className="survey-input" value={relationStart} onChange={(e) => setRelationStart(e.target.value)} />
            <p className="req-hint">{t.relationHint}</p>

            <label className="survey-label req-gap" htmlFor="req-msg">{t.loveMessage}</label>
            <textarea id="req-msg" className="survey-input" rows={6} maxLength={2000} placeholder={t.messagePlaceholder} value={loveMessage} onChange={(e) => setLoveMessage(e.target.value)} />
            <label className="req-check">
              <input type="checkbox" checked={writeForMe} onChange={(e) => setWriteForMe(e.target.checked)} />
              <span>{t.writeForMe}</span>
            </label>

            <fieldset className="survey-block">
              <legend className="survey-label">{t.photos}</legend>
              <p className="req-hint">{t.photosHint}</p>
              {memories.map((m, i) => (
                <div className="req-memory" key={i}>
                  <span className="req-memory-title">{t.memory} {i + 1}</span>
                  <input type="date" className="survey-input" aria-label={t.memDate} value={m.date} onChange={(e) => setMemory(i, { date: e.target.value })} />
                  <input className="survey-input" placeholder={t.memCaption} maxLength={60} value={m.caption} onChange={(e) => setMemory(i, { caption: e.target.value })} />
                </div>
              ))}
            </fieldset>

            <fieldset className="survey-block">
              <legend className="survey-label">{t.extras}</legend>
              <p className="req-hint">{t.extrasNote}</p>
              <span className="req-memory-title">{t.cakeWishes}</span>
              {cakeWishes.map((w, i) => (
                <input key={i} className="survey-input req-line" maxLength={80} value={w} onChange={(e) => setAt(setCakeWishes, i, e.target.value)} aria-label={`${t.cakeWishes} ${i + 1}`} />
              ))}
              <span className="req-memory-title">{t.reasons}</span>
              {reasons.map((w, i) => (
                <input key={i} className="survey-input req-line" maxLength={100} value={w} onChange={(e) => setAt(setReasons, i, e.target.value)} aria-label={`${t.reasons} ${i + 1}`} />
              ))}
            </fieldset>

            <label className="survey-label req-gap" htmlFor="req-pw">{t.password}</label>
            <input id="req-pw" className="survey-input" value={password} maxLength={40} autoCapitalize="none" onChange={(e) => setPassword(e.target.value)} />
            <p className="req-hint">{t.passwordHint}</p>

            <input className="survey-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} />

            {error && <p className="req-error">{error}</p>}
            <button type="submit" className="req-submit" disabled={sending}>{sending ? t.sending : t.submit}</button>
          </form>
        )}
      </div>
    </div>
  );
}
