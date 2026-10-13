// The gift-website templates live on the public website (sochicgifts repo, templates/*.html) and are
// only ever READ from here, so a customer's copy can never change the original.
// templates/manifest.json on the website lists them: { templates: [{ file, name, occasion }] }.
const LANDING_URL = (process.env.LANDING_URL || 'https://sochicgifts.vercel.app').replace(/\/+$/, '');
const TTL_MS = 5 * 60 * 1000;

const cache = new Map(); // key -> { at, value }

async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const fetchText = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'sochicgifts-admin' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
};

const getManifest = () =>
  cached('manifest', async () => {
    const data = JSON.parse(await fetchText(`${LANDING_URL}/templates/manifest.json`));
    return (Array.isArray(data.templates) ? data.templates : []).filter((t) => /^[A-Za-z0-9_-]+$/.test(t.file));
  });

// Only files named in the manifest can be fetched, so this can't be pointed at any other address.
async function getTemplateHtml(file) {
  const manifest = await getManifest();
  if (!manifest.some((t) => t.file === file)) return null;
  return cached(`html:${file}`, () => fetchText(`${LANDING_URL}/templates/${encodeURIComponent(file)}.html`));
}

function clearCache() {
  cache.clear();
}

module.exports = { LANDING_URL, getManifest, getTemplateHtml, clearCache };
