const C = require('../lib/core');
// طلبات العميل المسجّل (بتتحدّث لايف من صفحة الحساب)
module.exports = async (req, res) => {
  try {
    const u = await C.authUser(req);
    if (!u) return res.status(401).json({ error: 'auth' });
    const nums = await C.rc(['LRANGE', 'uorders:' + u.phone, 0, 29]);
    if (!nums.length) return res.status(200).json({ orders: [] });
    const rows = await C.rc(['MGET', ...nums.map(n => 'order:' + n)]);
    const orders = rows.filter(Boolean).map(r => { const o = JSON.parse(r); return { num: o.num, items: o.items, total: o.total, discount: (o.discount || 0) + (o.pointsUsed || 0), status: o.status, ts: o.ts }; });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ orders });
  } catch (e) { C.fail(res, e); }
};
