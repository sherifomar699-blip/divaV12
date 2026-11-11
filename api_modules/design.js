const C = require('../lib/core');
// عرض صورة الطباعة للأدمن بس
module.exports = async (req, res) => {
  const a = C.authOf(req);
  if (!a || a.role !== 'admin') return res.status(401).end();
  const id = String((req.query || {}).id || '');
  if (!/^u[0-9a-f]{16}$/.test(id)) return res.status(400).end();
  try {
    const d = await C.rc(['GET', 'dsg:' + id]);
    const m = d && d.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return res.status(404).end();
    res.setHeader('Content-Type', m[1]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).send(Buffer.from(m[2], 'base64'));
  } catch (e) { res.status(500).end(); }
};
