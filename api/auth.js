const C = require('../lib/core');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const b = req.body || {}, act = b.action;
  try {
    if (!(await C.limit(req, 'auth', 25))) return res.status(429).json({ error: 'too_many' });
    if (act === 'admin') {
      const pw = process.env.ADMIN_PASSWORD;
      if (!pw) return res.status(500).json({ error: 'no_admin_password' });
      if (!C.safeEq(String(b.password || ''), pw)) return res.status(401).json({ error: 'bad_credentials' });
      return res.status(200).json({ token: C.sign({ role: 'admin', exp: Date.now() + 12 * 3600e3 }) });
    }
    const phone = C.clip(b.phone, 20), pass = String(b.password || '');
    if (!/^01[0-9]{9}$/.test(phone)) return res.status(400).json({ error: 'bad_phone' });
    if (pass.length < 6 || pass.length > 100) return res.status(400).json({ error: 'bad_password' });
    const tok = () => C.sign({ role: 'user', sub: phone, exp: Date.now() + 30 * 864e5 });
    if (act === 'register') {
      const name = C.clip(b.name, 80).trim();
      if (name.length < 3) return res.status(400).json({ error: 'bad_name' });
      const salt = C.crypto.randomBytes(16).toString('hex');
      const u = { name, phone, salt, hash: C.hashPw(pass, salt), created: Date.now() };
      if ((await C.rc(['SET', 'user:' + phone, JSON.stringify(u), 'NX'])) !== 'OK') return res.status(409).json({ error: 'exists' });
      return res.status(200).json({ token: tok(), user: { name, phone } });
    }
    if (act === 'login') {
      const raw = await C.rc(['GET', 'user:' + phone]);
      const u = raw && JSON.parse(raw);
      if (!u || !C.safeEq(C.hashPw(pass, u.salt), u.hash)) return res.status(401).json({ error: 'bad_credentials' });
      if (u.blocked) return res.status(403).json({ error: 'blocked' });
      return res.status(200).json({ token: tok(), user: { name: u.name, phone } });
    }
    return res.status(400).json({ error: 'bad_action' });
  } catch (e) { C.fail(res, e); }
};
