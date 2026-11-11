const C = require('../lib/core');
const clip = C.clip;
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const b = req.body || {};
  const phone = clip(b.phone, 20);
  if (!/^01[0-9]{9}$/.test(phone) || clip(b.name, 80).length < 3 || clip(b.address, 300).length < 8)
    return res.status(400).json({ error: 'invalid_customer' });
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 40)
    return res.status(400).json({ error: 'invalid_items' });

  let cat = { hidden: [], prices: {} };
  try { cat = await C.getCatalog(); } catch (e) {}
  let subtotal = 0;
  const items = [];
  for (const it of b.items) {
    const name = clip(it.name, 60), size = Number(it.size), qty = Math.min(99, Math.max(1, Math.floor(Number(it.qty) || 1)));
    if (it.prod) {
      const p = C.findProd(cat, String(it.prod.id)), v = Number(it.prod.v), vr = p && p.variants && p.variants[v];
      if (!p || p.hidden || !vr || !(vr.price > 0)) return res.status(400).json({ error: 'invalid_item' });
      let price = vr.price, label = p.name + (vr.label ? ' - ' + vr.label : ''), print = null;
      if (it.print) {
        // الطباعة: المنتج لازم يقبلها وصورة التصميم لازم تكون مرفوعة
        const pid = String(it.print.id || '');
        if (!p.printable || !/^u[0-9a-f]{16}$/.test(pid)) return res.status(400).json({ error: 'invalid_item' });
        let got = null;
        try { got = await C.rc(['GET', 'dsg:' + pid]); } catch (e) { return C.fail(res, e); }
        if (!got) return res.status(400).json({ error: 'print_image_missing' });
        const fee = Math.max(0, Number(p.printFee) || 0);
        price += fee; label += ' (مع طباعة)'; print = { id: pid, fee };
      }
      subtotal += price * qty;
      items.push({ name: label, size: null, qty, price, prod: { id: p.id, v }, ...(print ? { print } : {}) });
      continue;
    }
    if (it.mix) {
      const ma = clip(it.mix.a, 60), mb = clip(it.mix.b, 60), r = Number(it.mix.r);
      if (!C.mixCfg(cat).enabled || ma === mb || !C.MIX_RATIOS.includes(r) || !C.SIZES.includes(size) || ![ma, mb].every(n => C.knownName(cat, n) && !C.isHidden(cat, n))) return res.status(400).json({ error: 'invalid_item' });
      const mp = C.mixPrice(cat, ma, mb, size, r);
      if (!(mp > 0)) return res.status(400).json({ error: 'invalid_item' });
      subtotal += mp * qty;
      items.push({ name: C.mixName(ma, mb, r), size, qty, price: mp, mix: { a: ma, b: mb, r } });
      continue;
    }
    if (!C.knownName(cat, name) || !C.SIZES.includes(size) || C.isHidden(cat, name)) return res.status(400).json({ error: 'invalid_item' });
    const price = C.priceOf(cat, name, size);
    if (!(price > 0)) return res.status(400).json({ error: 'invalid_item' });
    subtotal += price * qty;
    items.push({ name, size, qty, price });
  }

  // العميل المسجّل (لو موجود وغير محظور)
  let user = null;
  const auth = C.authOf(req);
  if (auth && auth.role === 'user') {
    try { user = await C.getUser(auth.sub); } catch (e) {}
    if (user && user.blocked) return res.status(403).json({ error: 'blocked' });
  }
  const userPhone = user ? user.phone : null;

  // كود الاسترداد
  let discount = 0, codeUsed = null, codeObj = null;
  const wantCode = C.NORM(b.code);
  try {
    if (wantCode) {
      const r = await C.checkCode(wantCode, userPhone, subtotal);
      if (r.error) return res.status(400).json({ error: r.error });
      discount = r.discount; codeUsed = wantCode; codeObj = r.code;
    }
    if (b.usePoints && !userPhone) return res.status(400).json({ error: 'login_required' });
  } catch (e) { return C.fail(res, e); }

  // استهلاك الكود والنقاط (بعمليات ذرّية)
  let pointsUsed = 0, codeConsumed = false;
  const rollback = async () => {
    try {
      if (codeConsumed) await C.rc(['DECR', 'cpu:' + codeUsed]);
      if (pointsUsed) await C.addPoints(userPhone, pointsUsed, 'استرجاع (فشل تسجيل الطلب)');
    } catch (e) {}
  };
  try {
    if (codeUsed) {
      const n = await C.rc(['INCR', 'cpu:' + codeUsed]);
      if (n > codeObj.maxUses) { await C.rc(['DECR', 'cpu:' + codeUsed]); return res.status(400).json({ error: 'code_used' }); }
      codeConsumed = true;
    }
    if (b.usePoints && userPhone) {
      const bal = Math.max(0, +(await C.rc(['GET', 'pts:' + userPhone])) || 0);
      const use = Math.min(bal, subtotal - discount);
      if (use > 0) {
        const n = await C.rc(['DECRBY', 'pts:' + userPhone, use]);
        if (n < 0) { await C.rc(['INCRBY', 'pts:' + userPhone, use]); await rollback(); return res.status(400).json({ error: 'points_changed' }); }
        pointsUsed = use;
        await C.redis([['LPUSH', 'ptlog:' + userPhone, JSON.stringify({ ts: Date.now(), delta: -use, note: 'استخدام في طلب' })], ['LTRIM', 'ptlog:' + userPhone, 0, 49]]);
      }
    }
  } catch (e) { await rollback(); return C.fail(res, e); }
  const total = subtotal - discount - pointsUsed;

  const rnd = () => 'DS-' + Math.floor(100000 + Math.random() * 900000);
  let num = /^DS-\d{5,6}$/.test(String(b.num)) ? b.num : rnd();
  const order = { num, name: clip(b.name, 80), phone, address: clip(b.address, 300), notes: clip(b.notes, 200), pay: clip(b.pay, 80), items, subtotal, discount, code: codeUsed, pointsUsed, total, status: 'جديد', user: userPhone, ts: Date.now() };

  let dbOk = false;
  try {
    let saved = await C.rc(['SET', 'order:' + num, JSON.stringify(order), 'NX']);
    if (saved !== 'OK') { num = rnd(); order.num = num; saved = await C.rc(['SET', 'order:' + num, JSON.stringify(order), 'NX']); }
    if (saved === 'OK') {
      const cmds = [['LPUSH', 'orders', num], ['LTRIM', 'orders', 0, 999]];
      if (userPhone) cmds.push(['LPUSH', 'uorders:' + userPhone, num], ['LTRIM', 'uorders:' + userPhone, 0, 99]);
      items.forEach(i => { if (i.print) cmds.push(['PERSIST', 'dsg:' + i.print.id]); });
      await C.redis(cmds);
      dbOk = true;
    }
  } catch (e) { console.error('db', e.message); }
  if (!dbOk && (codeConsumed || pointsUsed)) { await rollback(); return res.status(500).json({ error: 'server' }); }

  const text = [
    `🛍 طلب جديد ${num}`,
    `الاسم: ${order.name}`, `الهاتف: ${phone}`, `العنوان: ${order.address}`,
    order.notes ? `ملاحظات: ${order.notes}` : null,
    `الدفع: ${order.pay}`,
    userPhone ? `(عميل مسجّل)` : null,
    '', ...items.map(i => `• ${i.name}${i.size ? ' ' + i.size + ' مل' : ''} × ${i.qty} = ${i.price * i.qty} ج.م`), '',
    discount ? `خصم الكود ${codeUsed}: -${discount} ج.م` : null,
    pointsUsed ? `نقاط مستخدمة: -${pointsUsed} ج.م` : null,
    `الإجمالي: ${total} ج.م`,
  ].filter(x => x !== null).join('\n');

  const jobs = [];
  const { TELEGRAM_BOT_TOKEN: tg, TELEGRAM_CHAT_ID: chat, RESEND_API_KEY: rk, OWNER_EMAIL: to } = process.env;
  if (tg && chat) jobs.push(fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }),
  }).then(r => { if (!r.ok) throw new Error('telegram ' + r.status); }));
  if (rk && to) jobs.push(fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rk}` },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Diva Store <onboarding@resend.dev>', to: [to], subject: `طلب جديد ${num} - ${total} ج.م`, text }),
  }).then(r => { if (!r.ok) throw new Error('email ' + r.status); }));

  // صور الطباعة بتتبعت للتليجرام كمان
  if (tg && chat) {
    for (const i of items.filter(x => x.print)) {
      jobs.push((async () => {
        const d = await C.rc(['GET', 'dsg:' + i.print.id]);
        const m = d && d.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
        if (!m) return;
        const fd = new FormData();
        fd.append('chat_id', String(chat)); fd.append('caption', `تصميم الطباعة: ${i.name} (طلب ${num})`);
        fd.append('photo', new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }), 'design.' + m[1].split('/')[1]);
        const r = await fetch(`https://api.telegram.org/bot${tg}/sendPhoto`, { method: 'POST', body: fd });
        if (!r.ok) throw new Error('telegram photo ' + r.status);
      })());
    }
  }
  const out = await Promise.allSettled(jobs);
  out.filter(o => o.status === 'rejected').forEach(o => console.error(o.reason));
  if (dbOk || out.some(o => o.status === 'fulfilled')) return res.status(200).json({ ok: true, num, subtotal, discount, pointsUsed, total });
  return res.status(jobs.length ? 502 : 500).json({ error: jobs.length ? 'delivery_failed' : 'no_channel_configured' });
};
