const C = require('../lib/core');
// رفع صورة الطباعة من العميل (بتتخزن 7 أيام، ولو اتطلب بيها أوردر بتتثبّت)
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    if (!(await C.limit(req, 'upl', 25))) return res.status(429).json({ error: 'too_many' });
    const img = (req.body || {}).image;
    if (typeof img !== 'string' || img.length > 700000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) return res.status(400).json({ error: 'bad_image' });
    const id = 'u' + C.crypto.randomBytes(8).toString('hex');
    await C.rc(['SET', 'dsg:' + id, img, 'EX', 7 * 86400]);
    res.status(200).json({ id });
  } catch (e) { C.fail(res, e); }
};
