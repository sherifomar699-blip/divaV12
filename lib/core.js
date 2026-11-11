// أدوات مشتركة: قاعدة البيانات (Upstash Redis)، التوكنات، الأسعار
const crypto = require('crypto');
const NAMES = 'Bink sugar|يارا كاندى|يارا الكسير|اروجيت بينك|أميرة العرب|كاتى بيرى|Donn|بربرى هير|Good girl|روز فانيليا|فانيليا بودر|Morgan|Coco channel|فيلفيت مانجو|Scada|برادا برادايم|كيالى سويت بيتش|برسيف|جوتشى راش|Very sexy now|جراس فلاور|فاراواى|Rare gold|عود ابيض|عود بوكيه|عود عمانى|توباكو فانيليا|توباكو فينج|كريد افنتوس|Aqua de jo|بيانكو لاتيه|تراب الدهب|هيرش محور|لاكوست استنشال|لاكوست وايت|كيالى فانيليا|خمرة جولد|مضاوى|مضاوى جولد|سوفاچ|اكسنتو|سلفر سنت|سيمفونى|جوردانى جولد|انچل شير|الثائر دى مارلى|Stronger with you|بكرات روچ|One million|اوليمبيا|BMW|امبريال ڤالى|بلاك ايس|أنا الابيض|ميجامار|امجنيشن|Power of you|انڤكتوس الكسير|Ultra marine|برسيڤ رجالي|فالانتينو|ياقوت'.split('|');
const SPL = new Set('مضاوى|مضاوى جولد|Aqua de jo|ميجامار|انڤكتوس الكسير|برسيڤ رجالي|عود ابيض|خمرة جولد|اكسنتو|Morgan|ياقوت|سيمفونى|سوفاچ|امبريال ڤالى|بكرات روچ|اروجيت بينك'.split('|'));
const TOB = new Set(['توباكو فانيليا', 'توباكو فينج']);
const SIZES = [10, 30, 50];
const TIERS = [[70, 200, 300], [80, 250, 350], [90, 300, 400]];
const STATUSES = ['جديد', 'قيد التجهيز', 'تم الشحن', 'تم التسليم', 'ملغي'];
const PREQ_STATUSES = ['جديد', 'تم التواصل', 'قيد الطباعة', 'جاهز', 'تم التسليم', 'ملغي'];
const defPrice = (name, size) => TIERS[TOB.has(name) ? 2 : SPL.has(name) ? 1 : 0][SIZES.indexOf(size)];
const findCustom = (cat, name) => ((cat && cat.custom) || []).find(p => p.name === name && (!p.section || p.section === 'perfume'));
const imgsOf = p => (p && Array.isArray(p.imgs) && p.imgs.length ? p.imgs : (p && p.img ? [p.id] : []));
const findProd = (cat, id) => ((cat && cat.custom) || []).find(p => p.id === id && p.section && p.section !== 'perfume');
const knownName = (cat, name) => NAMES.includes(name) || !!findCustom(cat, name);
const isHidden = (cat, name) => { const c = findCustom(cat, name); return c ? !!c.hidden : ((cat && cat.hidden) || []).includes(name); };
// ---- الميكس ----
const MIX_RATIOS = [50, 70, 30];
const mixCfg = cat => Object.assign({ enabled: true, mode: 'avg', fixed: [0, 0, 0], fee: 0 }, (cat && cat.mix) || {});
const mixName = (a, b, r) => 'ميكس: ' + a + ' + ' + b + (r !== 50 ? ' (' + r + '/' + (100 - r) + ')' : '');
const priceOf = (cat, name, size) => {
  const k = SIZES.indexOf(size);
  const c = findCustom(cat, name);
  if (c) { const v = c.prices[k]; return v > 0 ? v : 0; }
  const o = cat && cat.prices && cat.prices[name];
  const v = o && o[k];
  return v > 0 ? v : defPrice(name, size);
};
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);

// ---- Redis عبر REST (Upstash) ----
const R_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const R_TOK = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
async function redis(cmds) {
  if (!R_URL() || !R_TOK()) throw new Error('db_not_configured');
  const r = await fetch(R_URL() + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + R_TOK(), 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('db_' + r.status);
  const j = await r.json();
  return j.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}
const rc = async cmd => (await redis([cmd]))[0];

// ---- كلمات السر والتوكنات ----
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const secret = () => { const s = process.env.AUTH_SECRET; if (!s || s.length < 16) throw new Error('no_secret'); return s; };
function sign(p) {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret()).update(body).digest('base64url');
}
function verify(t) {
  try {
    const [b, s] = String(t || '').split('.');
    if (!b || !s) return null;
    if (!safeEq(s, crypto.createHmac('sha256', secret()).update(b).digest('base64url'))) return null;
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}
const authOf = req => verify(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));

// حد المحاولات (حماية من التخمين)
async function limit(req, key, max) {
  try {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
    const k = `rl:${key}:${ip}`;
    const [n] = await redis([['INCR', k], ['EXPIRE', k, 900]]);
    return n <= max;
  } catch (e) { return true; }
}

async function getCatalog() {
  const raw = await rc(['GET', 'catalog']);
  const c = raw ? JSON.parse(raw) : {};
  return { hidden: Array.isArray(c.hidden) ? c.hidden : [], prices: c.prices || {}, custom: Array.isArray(c.custom) ? c.custom : [], meta: c.meta || {}, mix: mixCfg(c) };
}
// ---- أدوات العملاء والبونص ----
const NORM = c => String(c || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
const PHONE_RE = /^01[0-9]{9}$/;
async function scan(match) {
  let cur = '0', keys = [], n = 0;
  do { const r = await rc(['SCAN', cur, 'MATCH', match, 'COUNT', 500]); cur = String(r[0]); keys.push(...r[1]); n++; } while (cur !== '0' && n < 60);
  return [...new Set(keys)];
}
async function getUser(phone) { const raw = await rc(['GET', 'user:' + phone]); return raw ? JSON.parse(raw) : null; }
async function authUser(req) {
  const a = authOf(req);
  if (!a || a.role !== 'user') return null;
  const u = await getUser(a.sub);
  return u && !u.blocked ? u : null;
}
// فحص كود الاسترداد (من غير استهلاك)
async function checkCode(rawCode, phone, subtotal) {
  const code = NORM(rawCode);
  if (!code) return { error: 'bad_code' };
  const raw = await rc(['GET', 'cp:' + code]);
  if (!raw) return { error: 'bad_code' };
  const c = JSON.parse(raw);
  if (c.expires && c.expires < Date.now()) return { error: 'code_expired' };
  if (c.phone && c.phone !== phone) return { error: 'code_not_yours' };
  const uses = +(await rc(['GET', 'cpu:' + code])) || 0;
  if (uses >= c.maxUses) return { error: 'code_used' };
  return { code: c, discount: Math.min(c.value, Math.max(0, subtotal)) };
}
async function addPoints(phone, delta, note) {
  const n = await rc(['INCRBY', 'pts:' + phone, delta]);
  await redis([['LPUSH', 'ptlog:' + phone, JSON.stringify({ ts: Date.now(), delta, note: clip(note, 80) })], ['LTRIM', 'ptlog:' + phone, 0, 49]]);
  return n;
}

function mixPrice(cat, a, b, size, r) {
  const pa = priceOf(cat, a, size), pb = priceOf(cat, b, size);
  if (!(pa > 0 && pb > 0)) return 0;
  const m = mixCfg(cat), k = SIZES.indexOf(size);
  let base;
  if (m.mode === 'fixed' && m.fixed[k] > 0) base = m.fixed[k];
  else if (m.mode === 'max') base = Math.max(pa, pb);
  else base = (pa * r + pb * (100 - r)) / 100;
  return Math.round(base + (Number(m.fee) || 0));
}
const fail = (res, e) => {
  console.error(e);
  const m = e && e.message;
  res.status(500).json({ error: ['db_not_configured', 'no_secret'].includes(m) ? m : 'server' });
};

module.exports = { PREQ_STATUSES, imgsOf, findProd, MIX_RATIOS, mixCfg, mixName, mixPrice: (cat, a, b, size, r) => mixPrice(cat, a, b, size, r), findCustom, knownName, isHidden, NORM, PHONE_RE, scan, getUser, authUser, checkCode, addPoints, crypto, NAMES, SIZES, STATUSES, defPrice, priceOf, clip, redis, rc, hashPw, safeEq, sign, verify, authOf, limit, getCatalog, fail };
