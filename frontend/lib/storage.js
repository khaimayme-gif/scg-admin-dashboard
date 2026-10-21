// Signed uploads to Supabase Storage, so a browser can send a photo straight to the bucket without
// the file passing through the API. Used by the public website-request form.
const crypto = require('crypto');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.SUPABASE_TEMPLATE_BUCKET || 'template-videos';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Returns { uploadUrl, publicUrl } for a new file under `folder`, or null if Supabase refused.
async function signUpload(folder, fileName, contentType) {
  const base = String(fileName || 'photo').replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'photo';
  const path = `${folder}/${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${base}.${EXT[contentType]}`;
  const signed = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
  });
  if (!signed.ok) {
    console.error('Supabase signed upload failed', signed.status, await signed.text().catch(() => ''));
    return null;
  }
  const { url } = await signed.json();
  return { uploadUrl: `${SUPABASE_URL}/storage/v1${url}`, publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}` };
}

module.exports = { SUPABASE_URL, BUCKET, signUpload };
