const C = require('../lib/core');
// حساب العميل: الرصيد + سجل النقاط + أكواده
module.exports = async (req, res) => {
  try {
    const u = await C.authUser(req);
    if (!u) return res.status(401).json({ error: 'auth' });
    const [pts, log, names] = await C.redis([['GET', 'pts:' + u.phone], ['LRANGE', 'ptlog:' + u.phone, 0, 14], ['LRANGE', 'ucodes:' + u.phone, 0, 49]]);
    let codes = [];
    if (names.length) {
      const [rows, uses] = await C.redis([['MGET', ...names.map(n => 'cp:' + n)], ['MGET', ...names.map(n => 'cpu:' + n)]]);
      codes = rows.map((r, i) => r && { c: JSON.parse(r), used: +uses[i] || 0 }).filter(x => x && x.used < x.c.maxUses && (!x.c.expires || x.c.expires > Date.now()))
        .map(x => ({ code: x.c.code, value: x.c.value, expires: x.c.expires || null, note: x.c.note || '' }));
    }
    res.status(200).json({ user: { name: u.name, phone: u.phone }, points: Math.max(0, +pts || 0), log: log.map(l => JSON.parse(l)), codes });
  } catch (e) { C.fail(res, e); }
};
