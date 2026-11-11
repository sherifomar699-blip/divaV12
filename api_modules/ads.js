const C = require('../lib/core');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    try {
      const raw = await C.rc(['GET', 'ads']);
      const ads = raw ? JSON.parse(raw) : [];
      res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=60');
      return res.status(200).json(ads);
    } catch (e) {
      return res.status(200).json([]);
    }
  }
  return res.status(405).json({ error: 'method' });
};
