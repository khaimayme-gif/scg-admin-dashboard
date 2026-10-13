// Turns a gift-website template (one HTML file) into a list of editable fields, and turns edited
// values back into a finished HTML page. Nothing here touches the database or the network, so it
// can be tested against the real template files.
//
// Two kinds of template are handled:
//
//   "config" templates keep everything customisable in one settings block at the top of the page:
//       const C = { receiverName: "Baby", pin: "1111", cards: [...], relationStart: new Date(...) };
//     The block is read, every value in it becomes a field, and an override that sets the edited
//     values is added right after it.
//
//   "content" templates have their text written straight into the page. Every visible piece of
//     text, image / song / video / link address and the small constants in the script (a PIN, a
//     letter text...) becomes a field, and edits replace exactly those pieces of the original file.
//     The same text used in several places (a name, say) is one field that changes everywhere.
//
// Both give the same shape: { mode, title, fields: [{ id, group, label, type, value, hint }] }
// and render(html, values) takes a { fieldId: value } map of the fields that were changed.
const vm = require('vm');
const crypto = require('crypto');
const parse5 = require('parse5');

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|svg|avif)(\?.*)?$/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|aac)(\?.*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)(\?.*)?$/i;
const COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const MAX_FIELDS = 400;

// ---------------------------------------------------------------- small helpers

const words = (key) =>
  String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

const singular = (w) =>
  /ies$/i.test(w) ? w.replace(/ies$/i, 'y')
  : /(ch|sh|x|ss)es$/i.test(w) ? w.replace(/es$/i, '')
  : /s$/i.test(w) && !/ss$/i.test(w) ? w.replace(/s$/i, '')
  : w;

const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

// A string safe to put inside an inline <script>.
const jsString = (s) =>
  JSON.stringify(String(s)).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';
const pad = (n) => String(n).padStart(2, '0');

// Dates in templates are written without a time zone, so they mean "that moment where the visitor
// is". The server runs in UTC, so reading the UTC fields gives back exactly what was written.
function dateToFields(d) {
  if (Number.isNaN(d.getTime())) return null;
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
  return { type: hasTime ? 'datetime' : 'date', value: hasTime ? `${day}T${time}` : day };
}

function stringType(s, keyHint = '') {
  if (COLOR.test(s)) return 'color';
  if (AUDIO_EXT.test(s)) return 'audio';
  if (VIDEO_EXT.test(s)) return 'video';
  if (IMAGE_EXT.test(s)) return 'image';
  if (/^https?:\/\//i.test(s) && /image|photo|picture|pic|img/i.test(keyHint)) return 'image';
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(s)) return 'youtube';
  if (/^https?:\/\//i.test(s) || /^mailto:|^tel:/i.test(s)) return 'url';
  if (s.length > 80 || s.includes('\n')) return 'textarea';
  return 'text';
}

// ---------------------------------------------------------------- reading the config block

// Finds the "}" that closes the "{" at `open`, skipping strings, template literals, comments and
// regular expressions. Returns -1 if it never closes.
function matchBrace(src, open) {
  const openCh = src[open];
  const closeCh = openCh === '[' ? ']' : '}';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i = src.indexOf('*/', i + 2);
      if (i === -1) return -1;
      i += 1;
    } else if (c === '"' || c === "'") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    } else if (c === '`') {
      const skipTemplate = (start) => {
        let j = start + 1;
        while (j < src.length && src[j] !== '`') {
          if (src[j] === '\\') j += 2;
          else if (src[j] === '$' && src[j + 1] === '{') {
            const end = matchBrace(src, j + 1); // a ${...} inside a template literal
            if (end === -1) return -1;
            j = end + 1;
          } else j++;
        }
        return j;
      };
      i = skipTemplate(i);
      if (i >= src.length) return -1;
    } else if (c === '/') {
      // A "/" after one of these starts a regular expression, not a division.
      let k = i - 1;
      while (k >= 0 && /\s/.test(src[k])) k--;
      if (k < 0 || '(,=:[!&|?{};'.includes(src[k])) {
        for (i++; i < src.length && src[i] !== '/'; i++) {
          if (src[i] === '\\') i++;
          else if (src[i] === '[') for (i++; i < src.length && src[i] !== ']'; i++) if (src[i] === '\\') i++;
        }
      }
    } else if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Every top-level list or object a script defines on its own (the settings block, a photo list, a
// list of memories...), read as data. `primary` marks the C / CONFIG settings block.
function findBlocks(html) {
  const blocks = [];
  const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let sm;
  while ((sm = scriptRe.exec(html))) {
    const bodyStart = sm.index + sm[0].indexOf('>') + 1;
    const body = sm[1];
    const re = /^[ \t]{0,2}(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*([\[{])/gm;
    let m;
    let skipUntil = 0;
    while ((m = re.exec(body))) {
      if (m.index < skipUntil) continue;
      const open = m.index + m[0].length - 1;
      const close = matchBrace(body, open);
      if (close === -1) continue;
      const literal = body.slice(open, close + 1);
      let value;
      try {
        value = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 250 });
      } catch {
        continue; // refers to something defined elsewhere: not data we can read on its own
      }
      if (!value || typeof value !== 'object') continue;
      let end = close + 1;
      if (body[end] === ';') end += 1;
      skipUntil = end;
      blocks.push({
        name: m[1],
        isArray: Array.isArray(value),
        primary: (m[1] === 'C' || m[1] === 'CONFIG') && !Array.isArray(value),
        literal,
        value,
        end: bodyStart + end,
      });
    }
  }
  return blocks;
}

// Comments written after a value, e.g.   pin: "1111",  // 4-digit PIN   become hints.
function commentHints(literal) {
  const hints = {};
  for (const line of literal.split('\n')) {
    const m = /^\s*["']?([A-Za-z_$][\w$]*)["']?\s*:\s*.*?,?\s*\/\/\s*(.+?)\s*$/.exec(line);
    if (m && !(m[1] in hints)) hints[m[1]] = m[2];
  }
  return hints;
}

function containsFunction(v) {
  if (typeof v === 'function') return true;
  if (v && typeof v === 'object' && !isDate(v)) return Object.values(v).some(containsFunction);
  return false;
}

function configFields(block) {
  const hints = commentHints(block.literal);
  const fields = [];
  // Settings-block fields are named by their path; fields of other lists are prefixed with the list name.
  const prefix = block.primary ? '' : `@${block.name}.`;
  const groupFor = (topKey) => (block.primary ? words(topKey) : words(block.name));

  const walk = (value, path, topKey) => {
    if (fields.length >= MAX_FIELDS) return;
    const id = prefix + path.join('.');
    const last = path[path.length - 1];
    const lastIsIndex = /^\d+$/.test(last);
    // The label names the thing and its position: "Card 3 · Message".
    const nameParts = [];
    for (const seg of path) {
      if (/^\d+$/.test(seg)) nameParts.push(`${singular(nameParts.pop() ?? '')} ${Number(seg) + 1}`.trim());
      else nameParts.push(words(seg));
    }
    const label = nameParts.join(' · ') || words(last);
    const group = groupFor(topKey);

    if (typeof value === 'string') {
      const keyHint = lastIsIndex ? path[path.length - 2] || '' : last;
      fields.push({ id, group, label, type: stringType(value, keyHint), value, hint: hints[last] || hints[topKey] || '' });
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      fields.push({ id, group, label, type: 'number', value, hint: hints[last] || '' });
    } else if (typeof value === 'boolean') {
      fields.push({ id, group, label, type: 'boolean', value, hint: hints[last] || '' });
    } else if (isDate(value)) {
      const d = dateToFields(value);
      if (d) fields.push({ id, group, label, type: d.type, value: d.value, hint: hints[last] || '' });
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, [...path, String(i)], topKey));
    } else if (value && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]') {
      for (const [k, v] of Object.entries(value)) walk(v, [...path, k], topKey);
    }
  };

  if (block.isArray) {
    if (!containsFunction(block.value)) block.value.forEach((item, i) => walk(item, [String(i)], block.name));
  } else {
    for (const [key, value] of Object.entries(block.value)) {
      if (containsFunction(value)) continue; // can't be rewritten safely, so it isn't offered
      walk(value, [key], key);
    }
  }
  return fields;
}

// JavaScript source for `value`, using `original` to know which values are dates.
function toJs(value, original) {
  if (isDate(original)) {
    // An untouched date is still a Date; an edited one is the text from the form.
    const text = isDate(value) ? value.toISOString() : String(value);
    const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(text);
    if (!m) throw new Error(`Not a date: ${value}`);
    return `new Date(${JSON.stringify(`${m[1]}T${m[2] || '00:00'}:00`)})`;
  }
  if (Array.isArray(original)) return `[${original.map((o, i) => toJs(value[i], o)).join(', ')}]`;
  if (original && typeof original === 'object') {
    return `{${Object.keys(original).map((k) => `${JSON.stringify(k)}: ${toJs(value[k], original[k])}`).join(', ')}}`;
  }
  if (typeof original === 'string') return jsString(value);
  if (typeof original === 'number') return String(Number(value));
  if (typeof original === 'boolean') return value ? 'true' : 'false';
  return 'undefined';
}

const cloneConfig = (c) => {
  if (isDate(c)) return new Date(c.getTime());
  if (Array.isArray(c)) return c.map(cloneConfig);
  if (c && typeof c === 'object') return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, cloneConfig(v)]));
  return c;
};

// An edit to the page: replace html[start, end) with `text` (start === end inserts).
// For a data block this adds a line right after it that sets the edited values.
function blockEdit(block, values, fields) {
  const edited = cloneConfig(block.value);
  const prefix = block.primary ? '' : `@${block.name}.`;
  const topKeys = new Set();
  for (const f of fields) {
    if (!(f.id in values)) continue;
    const next = values[f.id];
    if (String(next) === String(f.value)) continue;
    const path = f.id.slice(prefix.length).split('.');
    let node = edited;
    for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
    const key = path[path.length - 1];
    if (f.type === 'number') node[key] = Number(next);
    else if (f.type === 'boolean') node[key] = Boolean(next);
    else node[key] = String(next); // dates stay as the form's text; toJs turns them back into dates
    topKeys.add(path[0]);
  }
  if (topKeys.size === 0) return null;

  let line;
  if (block.isArray) {
    // The list is a const, so it is changed in place.
    line = `${block.name}.splice(0, ${block.name}.length, ...${toJs(edited, block.value)});`;
  } else {
    const parts = [...topKeys].map((k) => `${JSON.stringify(k)}: ${toJs(edited[k], block.value[k])}`);
    line = `Object.assign(${block.name}, {${parts.join(', ')}});`;
  }
  return { start: block.end, end: block.end, text: `\n/* gift: edited values */ ${line}` };
}

// ---------------------------------------------------------------- content templates (text in the page)

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head']);
const hasLetterOrDigit = (s) => /[\p{L}\p{N}]/u.test(s);

function sectionLabel(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const attrs = stack[i].attrs || [];
    const id = (attrs.find((a) => a.name === 'id') || {}).value;
    const cls = (attrs.find((a) => a.name === 'class') || {}).value || '';
    if (id && /screen|page|scene|section|hero|letter|card|note|gift|wish|memor/i.test(id)) return words(id.replace(/^(screen|page|scene)[-_]/, ''));
    const m = /\b((?:screen|page|scene|section)[-_][\w-]+)/i.exec(cls);
    if (m) return words(m[1].replace(/^(screen|page|scene|section)[-_]/i, ''));
    if (id) return words(id);
  }
  return 'Page';
}

function contentSlots(html) {
  const doc = parse5.parse(html, { sourceCodeLocationInfo: true });
  const slots = new Map(); // id -> { id, group, label, type, value, ranges: [{start,end,kind,...}] }
  const add = (id, base, range) => {
    const existing = slots.get(id);
    if (existing) existing.ranges.push(range);
    else slots.set(id, { ...base, id, ranges: [range] });
  };

  let title = null;
  const walk = (node, stack) => {
    const tag = node.tagName;
    if (tag === 'head') {
      // Nothing in <head> is page content, except the title shown on the browser tab.
      for (const child of node.childNodes || []) if (child.tagName === 'title') walk(child, stack);
      return;
    }
    if (tag === 'title') {
      const t = (node.childNodes || []).find((c) => c.nodeName === '#text');
      if (t && t.sourceCodeLocation) {
        title = { start: t.sourceCodeLocation.startOffset, end: t.sourceCodeLocation.endOffset, value: t.value.trim() };
      }
      return;
    }
    if (tag && SKIP_TAGS.has(tag)) return;

    if (tag) {
      const attrsLoc = (node.sourceCodeLocation && node.sourceCodeLocation.attrs) || {};
      const group = sectionLabel(stack.concat(node));
      const attr = (n) => (node.attrs.find((a) => a.name === n) || {}).value;
      const addAttr = (name, type, label) => {
        const v = attr(name);
        const loc = attrsLoc[name];
        if (!v || !loc) return;
        const file = decodeURIComponent(v.split('?')[0].split('/').pop() || '');
        add(`a:${hash(`${type}|${v}`)}`, { group, label: file && file.length < 40 ? `${label} · ${file}` : label, type, value: v },
          { start: loc.startOffset, end: loc.endOffset, kind: 'attr', name });
      };
      if (tag === 'img') {
        const src = attr('src');
        if (src && !src.startsWith('data:')) addAttr('src', 'image', 'Image');
      } else if (tag === 'audio' || tag === 'source') {
        const src = attr('src');
        const type = AUDIO_EXT.test(src || '') ? 'audio' : VIDEO_EXT.test(src || '') ? 'video' : null;
        if (src && type) addAttr('src', type, type === 'audio' ? 'Song' : 'Video');
      } else if (tag === 'video') {
        if (attr('src')) addAttr('src', 'video', 'Video');
      } else if (tag === 'iframe') {
        const src = attr('src') || '';
        if (/youtube\.com|youtu\.be/i.test(src)) addAttr('src', 'youtube', 'YouTube video');
      } else if (tag === 'a') {
        const href = attr('href') || '';
        if (/^(https?:|mailto:|tel:)/i.test(href)) addAttr('href', 'url', 'Link');
      }
    }

    for (const child of node.childNodes || []) {
      if (child.nodeName === '#text') {
        const raw = html.slice(child.sourceCodeLocation.startOffset, child.sourceCodeLocation.endOffset);
        const value = child.value.replace(/\s+/g, ' ').trim();
        if (value.length >= 2 && hasLetterOrDigit(value)) {
          const group = sectionLabel(stack.concat(node));
          const type = value.length > 80 ? 'textarea' : 'text';
          add(`t:${hash(value)}`, { group, label: value.length > 40 ? `${value.slice(0, 38)}…` : value, type, value },
            { start: child.sourceCodeLocation.startOffset, end: child.sourceCodeLocation.endOffset, kind: 'text', raw });
        }
      } else if (child.childNodes || child.tagName) {
        walk(child, stack.concat(node));
      }
    }
  };
  walk(doc, []);

  // Small constants in the script: a PIN, a letter text, a name...
  const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let sm;
  const constRe = /(?:^|\n)[ \t]*(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\$]|\\.)*`)[ \t]*;?/g;
  while ((sm = scriptRe.exec(html))) {
    const bodyStart = sm.index + sm[0].indexOf('>') + 1;
    let cm;
    constRe.lastIndex = 0;
    while ((cm = constRe.exec(sm[1]))) {
      const name = cm[1];
      if (!/^[A-Z][A-Z0-9_]+$/.test(name) && !/pin|code|password|letter|message|name|song|title|date|wish/i.test(name)) continue;
      const quote = cm[2][0];
      let value;
      try {
        value = quote === '`' ? cm[2].slice(1, -1) : JSON.parse(quote === '"' ? cm[2] : `"${cm[2].slice(1, -1).replace(/"/g, '\\"')}"`);
      } catch {
        continue;
      }
      if (typeof value !== 'string' || value === '' || /^#?[0-9a-f]{3,8}$/i.test(value) && /color|bg/i.test(name)) continue;
      const litStart = bodyStart + cm.index + cm[0].indexOf(cm[2]);
      add(`s:${name}:${hash(value)}`, { group: 'Settings', label: words(name), type: stringType(value, name) === 'text' && value.length > 80 ? 'textarea' : stringType(value, name), value },
        { start: litStart, end: litStart + cm[2].length, kind: 'const', quote });
    }
  }
  return { slots: [...slots.values()].slice(0, MAX_FIELDS), title };
}

function contentEdits(slots, values) {
  const edits = [];
  for (const slot of slots) {
    if (!(slot.id in values) || String(values[slot.id]) === String(slot.value)) continue;
    const next = String(values[slot.id]);
    for (const r of slot.ranges) {
      if (r.kind === 'text') {
        const lead = /^\s*/.exec(r.raw)[0];
        const trail = /\s*$/.exec(r.raw)[0];
        edits.push({ start: r.start, end: r.end, text: lead + escapeHtml(next) + trail });
      } else if (r.kind === 'attr') {
        edits.push({ start: r.start, end: r.end, text: `${r.name}="${escapeAttr(next)}"` });
      } else if (r.kind === 'const') {
        edits.push({ start: r.start, end: r.end, text: r.quote === '`' ? `\`${next.replace(/[`\\$]/g, '\\$&').replace(/<\//g, '<\\/')}\`` : jsString(next) });
      }
    }
  }
  return edits;
}

// ---------------------------------------------------------------- public API

const normText = (v) => String(v).replace(/\s+/g, ' ').trim();

// Everything editable in a template, from three places:
//   - the settings block and other lists/objects in the script (names, dates, photo lists...)
//   - small text constants in the script (the letter, the PIN...)
//   - the page's own text, images, songs and links (shown as advanced "Page text")
// Text that a data block already controls is not offered twice.
function analyse(html) {
  const blocks = findBlocks(html);
  const { slots, title } = contentSlots(html);

  const fields = [];
  const blockFields = [];
  for (const block of blocks) {
    const f = configFields(block);
    if (block.isArray && !f.some((x) => ['text', 'textarea', 'image', 'audio'].includes(x.type) && !COLOR.test(String(x.value)))) continue; // numbers, colours: decoration, not content
    if (block.isArray && f.every((x) => x.type === 'color' || x.type === 'number')) continue;
    // Lists of short words (month or day names) are decoration, not something a customer writes.
    if (block.isArray && f.length >= 7 && f.every((x) => typeof x.value === 'string' && x.value.length <= 12 && x.type === 'text')) continue;
    blockFields.push({ block, fields: f });
    fields.push(...f);
  }
  const handled = new Set(fields.filter((f) => typeof f.value === 'string').map((f) => normText(f.value)));

  const constSlots = slots.filter((x) => x.id.startsWith('s:') && !handled.has(normText(x.value)));
  constSlots.forEach((x) => { x.group = 'Letter and texts'; handled.add(normText(x.value)); });
  const pageSlots = slots
    .filter((x) => !x.id.startsWith('s:') && !handled.has(normText(x.value)))
    .map((x) => ({ ...x, group: `Page text · ${x.group}`, advanced: true }));

  const titleField = title
    ? [{ id: '__title', group: 'Page', label: 'Browser tab title', type: 'text', value: title.value, hint: 'The title shown on the browser tab.' }]
    : [];
  const all = [...titleField, ...fields, ...constSlots, ...pageSlots].slice(0, MAX_FIELDS * 2);
  return { blockFields, constSlots, pageSlots, all, title, hasData: blockFields.length > 0 };
}

// What can be edited in this template.
function extract(html) {
  const a = analyse(html);
  const rows = a.all.map(({ ranges, ...f }) => f);
  return { mode: a.hasData ? 'config' : 'content', title: a.title ? a.title.value : '', fields: rows, warnings: [] };
}

// Adds <base> so the template's relative images/fonts/songs load from the website, plus noindex.
function addHead(html, baseUrl) {
  const tags = `<base href="${escapeAttr(baseUrl)}"><meta name="robots" content="noindex">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${tags}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${tags}</head>`);
  return `${tags}${html}`;
}

// The finished page. `values` only needs the fields that were changed.
function render(html, values = {}, { baseUrl } = {}) {
  const a = analyse(html);
  const edits = [];
  for (const { block, fields } of a.blockFields) {
    const e = blockEdit(block, values, fields);
    if (e) edits.push(e);
  }
  edits.push(...contentEdits([...a.constSlots, ...a.pageSlots], values));
  if ('__title' in values && a.title && String(values.__title) !== a.title.value) {
    edits.push({ start: a.title.start, end: a.title.end, text: escapeHtml(String(values.__title)) });
  }
  edits.sort((x, y) => y.start - x.start || y.end - x.end);
  let out = html;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (!baseUrl) return out;
  // Files renamed on the website since the templates were written (what new-gift.sh used to patch by hand).
  out = out.split('images/main/sochic-logo.png').join('images/main/main-logo.png');
  return addHead(out, baseUrl);
}

module.exports = { extract, render, matchBrace, findBlocks };
