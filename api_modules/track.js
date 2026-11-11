const C = require('../lib/core');
// تتبّع طلب برقم الطلب + رقم الهاتف (من غير حساب)
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    if (!(await C.limit(req, 'track', 40))) return res.status(429).json({ error: 'too_many' });
    const b = req.body || {};
    const num = C.clip(b.num, 20).trim().toUpperCase(), phone = C.clip(b.phone, 20).trim();
    if (!/^DS-\d{5,6}$/.test(num) || !C.PHONE_RE.test(phone)) return res.status(400).json({ error: 'bad_input' });
    const raw = await C.rc(['GET', 'order:' + num]);
    const o = raw && JSON.parse(raw);
    if (!o || o.phone !== phone) return res.status(404).json({ error: 'not_found' });
    res.status(200).json({ order: { num: o.num, items: o.items, total: o.total, discount: (o.discount || 0) + (o.pointsUsed || 0), status: o.status, ts: o.ts } });
  } catch (e) { C.fail(res, e); }
};
