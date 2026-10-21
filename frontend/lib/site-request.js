// The gift-website request form. A customer opens a private link (one per order), fills in a form
// and uploads their photos; the admin then turns the answers into a draft website in one click.
// This file holds what both sides share: which template is used, how the answers are checked, and
// how they become the website's field values.

const TEMPLATE = 'especially-for-him';
const OCCASIONS = ['birthday', 'anniversary'];
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const BUCKET = process.env.SUPABASE_TEMPLATE_BUCKET || 'template-videos';
// Photos can only come from our own storage, under requests/, never from an address the customer typed.
const PHOTO_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/requests/`;

const text = (v, max) => String(v === null || v === undefined ? '' : v).trim().slice(0, max);
const isoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
const photoUrl = (v) => (typeof v === 'string' && SUPABASE_URL && v.startsWith(PHOTO_PREFIX) && v.length < 400 ? v : '');
const list = (v, n, max) => (Array.isArray(v) ? v : []).slice(0, n).map((x) => text(x, max));

// Checks what the form sent. Returns { error: '<field>' } naming the first thing that is wrong,
// or { answers } with everything trimmed and limited.
function cleanAnswers(body) {
  const b = body || {};
  const occasion = OCCASIONS.includes(b.occasion) ? b.occasion : null;
  if (!occasion) return { error: 'occasion' };
  const receiverName = text(b.receiverName, 40);
  if (!receiverName) return { error: 'receiverName' };
  const senderName = text(b.senderName, 40);
  if (!senderName) return { error: 'senderName' };
  const contact = text(b.contact, 120);
  if (!contact) return { error: 'contact' };
  if (!isoDate(b.eventDate)) return { error: 'eventDate' };
  if (!isoDate(b.relationStart)) return { error: 'relationStart' };

  const writeForMe = Boolean(b.writeForMe);
  const loveMessage = text(b.loveMessage, 2000);
  if (!loveMessage && !writeForMe) return { error: 'loveMessage' };

  const memories = (Array.isArray(b.memories) ? b.memories : []).slice(0, 3).map((m) => ({
    photo: photoUrl(m && m.photo),
    date: isoDate(m && m.date) ? m.date : '',
    caption: text(m && m.caption, 60),
  }));
  if (memories.length < 3 || memories.some((m) => !m.photo)) return { error: 'photos' };

  const password = text(b.password, 40).toLowerCase();
  if (password && !/^[a-z0-9._-]{6,40}$/.test(password)) return { error: 'password' };

  return {
    answers: {
      occasion,
      eventDate: b.eventDate,
      receiverName,
      senderName,
      relationStart: b.relationStart,
      loveMessage,
      writeForMe,
      cakeWishes: list(b.cakeWishes, 5, 80),
      reasons: list(b.reasons, 12, 100),
      memories,
      letterPhotos: (Array.isArray(b.letterPhotos) ? b.letterPhotos : []).slice(0, 2).map(photoUrl),
      couplePhoto: photoUrl(b.couplePhoto),
      password,
      contact,
    },
  };
}

const prettyDate = (iso) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }) : '';

// The website's field values for a request. `fields` are the template's fields (site-engine extract),
// used to find the letter-photo and "Happy Birthday" fields, whose ids come from the page itself.
// Only what the customer filled in is set; the rest keeps the template's own (boyfriend) wording.
function buildSiteValues(a, fields) {
  const v = {
    __title: a.occasion === 'anniversary' ? `Happy Anniversary ${a.receiverName} 💙` : `Happy Birthday ${a.receiverName} 🎂`,
    __skipPin: true,
    receiverName: a.receiverName,
    senderName: a.senderName,
    relationStart: `${a.relationStart}T00:00`,
  };
  if (a.loveMessage) v.loveMessage = a.loveMessage;
  else if (a.occasion === 'anniversary') {
    // "Write it for me": the template's own message ends with "Happy Birthday", so it says anniversary instead.
    const f = fields.find((x) => x.id === 'loveMessage');
    if (f) v.loveMessage = String(f.value).replace('Happy Birthday', 'Happy Anniversary');
  }
  a.cakeWishes.forEach((t, i) => { if (t) v[`cakeWishes.${i}`] = t; });
  a.reasons.forEach((t, i) => { if (t) v[`cards.${i}.msg`] = t; });
  a.memories.forEach((m, i) => {
    v[`memCards.${i}.photo`] = m.photo;
    v[`memCards.${i}.date`] = prettyDate(m.date);
    v[`memCards.${i}.caption`] = m.caption || 'Our memory 💙';
  });
  if (a.couplePhoto) v.couplePhoto = a.couplePhoto;

  // The two small round photos on the letter: the customer's own picks, else the first two memories.
  const letter = fields.filter((f) => f.type === 'image' && /Ll s2/.test(f.group));
  letter.slice(0, 2).forEach((f, i) => { v[f.id] = a.letterPhotos[i] || a.memories[i].photo; });

  // The opening screen and the music player say "Happy Birthday"; an anniversary says so instead.
  if (a.occasion === 'anniversary') {
    for (const f of fields) if (f.value === 'Happy Birthday') v[f.id] = 'Happy Anniversary';
  }
  return v;
}

module.exports = { TEMPLATE, OCCASIONS, PHOTO_PREFIX, cleanAnswers, buildSiteValues };
