const C = require('../lib/core');
// عام: الأسعار المعدّلة والعطور المخفية (لو الأدمن عدّلها)
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60');
  try { res.status(200).json(await C.getCatalog()); }
  catch (e) { res.status(200).json({ hidden: [], prices: {} }); }
};
