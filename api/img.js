const C = require('../lib/core');
// صور العطور اللي الأدمن رفعها (متخزنة في القاعدة)
module.exports = async (req, res) => {
  const k = String((req.query || {}).k || '');
  if (!/^[a-zA-Z0-9]{1,40}$/.test(k)) return res.status(400).end();
  try {
    const d = await C.rc(['GET', 'pimg:' + k]);
    const m = d && d.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return res.status(404).end();
    res.setHeader('Content-Type', m[1]);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(Buffer.from(m[2], 'base64'));
  } catch (e) { res.status(500).end(); }
};
