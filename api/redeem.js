const C = require('../lib/core');
// معاينة كود الخصم قبل تأكيد الطلب (من غير استهلاك)
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    if (!(await C.limit(req, 'redeem', 40))) return res.status(429).json({ error: 'too_many' });
    const a = C.authOf(req);
    const phone = a && a.role === 'user' ? a.sub : null;
    const sub = Math.max(0, Math.floor(Number((req.body || {}).subtotal) || 0));
    const r = await C.checkCode((req.body || {}).code, phone, sub);
    if (r.error) return res.status(400).json({ error: r.error });
    res.status(200).json({ ok: true, discount: r.discount, value: r.code.value });
  } catch (e) { C.fail(res, e); }
};
