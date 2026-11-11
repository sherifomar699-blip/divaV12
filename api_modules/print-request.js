const C = require('../lib/core');
// طلب طباعة مخصوص: العميل يبعت صورة التصميم والمنتج، والطلب بيوصل للأدمن وتليجرام
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    if (!(await C.limit(req, 'preq', 12))) return res.status(429).json({ error: 'too_many' });
    const b = req.body || {};
    const name = C.clip(b.name, 80).trim(), phone = C.clip(b.phone, 20).trim();
    const product = C.clip(b.product, 80).trim(), productText = C.clip(b.productText, 80).trim();
    const qty = b.qty === undefined || b.qty === '' ? 1 : Math.floor(Number(b.qty)), notes = C.clip(b.notes, 400).trim();
    const images = Array.isArray(b.images) ? [...new Set(b.images.map(String))].slice(0, 3) : [];
    if (name.length < 3 || !C.PHONE_RE.test(phone)) return res.status(400).json({ error: 'invalid_customer' });
    if (!(qty >= 1 && qty <= 999) || (!product && productText.length < 2)) return res.status(400).json({ error: 'invalid_request' });
    if (!images.length || images.some(id => !/^u[0-9a-f]{16}$/.test(id))) return res.status(400).json({ error: 'print_image_missing' });
    const data = [];
    for (const id of images) {
      const d = await C.rc(['GET', 'dsg:' + id]);
      if (!d) return res.status(400).json({ error: 'print_image_missing' });
      data.push(d);
    }
    let num = 'PR-' + Math.floor(100000 + Math.random() * 900000);
    const rec = { num, name, phone, product, productText, qty, notes, images, status: 'جديد', ts: Date.now() };
    let saved = await C.rc(['SET', 'preq:' + num, JSON.stringify(rec), 'NX']);
    if (saved !== 'OK') { num = 'PR-' + Math.floor(100000 + Math.random() * 900000); rec.num = num; saved = await C.rc(['SET', 'preq:' + num, JSON.stringify(rec), 'NX']); }
    if (saved !== 'OK') return res.status(500).json({ error: 'server' });
    const cmds = [['LPUSH', 'preqs', num], ['LTRIM', 'preqs', 0, 499]];
    images.forEach(id => cmds.push(['PERSIST', 'dsg:' + id]));
    await C.redis(cmds);

    const text = ['🖨 طلب طباعة جديد ' + num, 'الاسم: ' + name, 'الهاتف: ' + phone, 'المنتج: ' + (product || productText), 'الكمية: ' + qty, notes ? 'ملاحظات: ' + notes : null, 'عدد الصور: ' + images.length, 'الصور مرفقة بعد الرسالة وفي لوحة الأدمن.']
      .filter(x => x !== null).join('\n');
    const jobs = [];
    const { TELEGRAM_BOT_TOKEN: tg, TELEGRAM_CHAT_ID: chat, RESEND_API_KEY: rk, OWNER_EMAIL: to } = process.env;
    if (tg && chat) {
      jobs.push((async () => {
        const r = await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) });
        if (!r.ok) throw new Error('telegram ' + r.status);
        for (let i = 0; i < data.length; i++) {
          const m = data[i].match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
          if (!m) continue;
          const fd = new FormData();
          fd.append('chat_id', String(chat)); fd.append('caption', `تصميم طلب ${num} (${i + 1} من ${data.length})`);
          fd.append('photo', new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }), 'design.' + m[1].split('/')[1]);
          const p = await fetch(`https://api.telegram.org/bot${tg}/sendPhoto`, { method: 'POST', body: fd });
          if (!p.ok) throw new Error('telegram photo ' + p.status);
        }
      })());
    }
    if (rk && to) jobs.push(fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rk}` },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Diva Store <onboarding@resend.dev>', to: [to], subject: 'طلب طباعة ' + num, text }),
    }).then(r => { if (!r.ok) throw new Error('email ' + r.status); }));
    const out = await Promise.allSettled(jobs);
    out.filter(o => o.status === 'rejected').forEach(o => console.error(o.reason));
    res.status(200).json({ ok: true, num });
  } catch (e) { C.fail(res, e); }
};
