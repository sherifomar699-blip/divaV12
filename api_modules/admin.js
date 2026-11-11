const C = require('../lib/core');
const bad = (res, e, code = 400) => res.status(code).json({ error: e });
const int = v => (Number.isFinite(+v) ? Math.trunc(+v) : NaN);

module.exports = async (req, res) => {
  const a = C.authOf(req);
  if (!a || a.role !== 'admin') return bad(res, 'auth', 401);
  try {
    if (req.method === 'GET') {
      const act = (req.query || {}).action;
      if (act === 'orders') {
        const lim = Math.min(1000, Math.max(1, int((req.query || {}).limit) || 300));
        const nums = await C.rc(['LRANGE', 'orders', 0, lim - 1]);
        const rows = nums.length ? await C.rc(['MGET', ...nums.map(n => 'order:' + n)]) : [];
        return res.status(200).json({ orders: rows.filter(Boolean).map(r => JSON.parse(r)) });
      }
      if (act === 'catalog') {
        const cat = await C.getCatalog();
        return res.status(200).json({ products: C.NAMES.map(n => ({ name: n, def: C.SIZES.map(s => C.defPrice(n, s)), over: cat.prices[n] || null, hidden: cat.hidden.includes(n) })), custom: cat.custom, meta: cat.meta, mix: cat.mix });
      }
      if (act === 'users') {
        const keys = await C.scan('user:*');
        if (!keys.length) return res.status(200).json({ users: [] });
        const [rows, pts] = await C.redis([['MGET', ...keys], ['MGET', ...keys.map(k => 'pts:' + k.slice(5))]]);
        const users = rows.map((r, i) => { if (!r) return null; const u = JSON.parse(r); return { name: u.name, phone: u.phone, created: u.created, blocked: !!u.blocked, points: Math.max(0, +pts[i] || 0) }; }).filter(Boolean);
        return res.status(200).json({ users });
      }
      if (act === 'preqs') {
        const nums = await C.rc(['LRANGE', 'preqs', 0, 199]);
        const rows = nums.length ? await C.rc(['MGET', ...nums.map(n => 'preq:' + n)]) : [];
        return res.status(200).json({ requests: rows.filter(Boolean).map(r => JSON.parse(r)) });
      }
      if (act === 'codes') {
        const keys = await C.scan('cp:*');
        if (!keys.length) return res.status(200).json({ codes: [] });
        const [rows, uses] = await C.redis([['MGET', ...keys], ['MGET', ...keys.map(k => 'cpu:' + k.slice(3))]]);
        const codes = rows.map((r, i) => r && { ...JSON.parse(r), used: +uses[i] || 0 }).filter(Boolean).sort((x, y) => y.created - x.created);
        return res.status(200).json({ codes });
      }
      return bad(res, 'bad_action');
    }
    if (req.method !== 'POST') return bad(res, 'method', 405);
    const b = req.body || {};

    if (b.action === 'status') {
      const num = C.clip(b.num, 20);
      if (!C.STATUSES.includes(b.status)) return bad(res, 'bad_status');
      const raw = await C.rc(['GET', 'order:' + num]);
      if (!raw) return bad(res, 'not_found', 404);
      const o = JSON.parse(raw);
      if (o.refunded && b.status !== 'ملغي') return bad(res, 'refunded_cannot_reopen');
      // لو اتلغى الطلب، النقاط المستخدمة فيه بترجع للعميل
      if (b.status === 'ملغي' && o.pointsUsed > 0 && o.user && !o.refunded) { await C.addPoints(o.user, o.pointsUsed, 'استرجاع نقاط طلب ملغي ' + o.num); o.refunded = true; }
      o.status = b.status;
      await C.rc(['SET', 'order:' + num, JSON.stringify(o)]);
      return res.status(200).json({ ok: true, refunded: !!o.refunded });
    }
    if (b.action === 'preq_status') {
      const num = C.clip(b.num, 20);
      if (!C.PREQ_STATUSES.includes(b.status)) return bad(res, 'bad_status');
      const raw = await C.rc(['GET', 'preq:' + num]);
      if (!raw) return bad(res, 'not_found', 404);
      const o = JSON.parse(raw); o.status = b.status;
      await C.rc(['SET', 'preq:' + num, JSON.stringify(o)]);
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'preq_delete') {
      const num = C.clip(b.num, 20);
      const raw = await C.rc(['GET', 'preq:' + num]);
      if (!raw) return bad(res, 'not_found', 404);
      const o = JSON.parse(raw);
      const cmds = [['DEL', 'preq:' + num], ['LREM', 'preqs', 0, num]];
      (o.images || []).forEach(id => cmds.push(['DEL', 'dsg:' + id]));
      await C.redis(cmds);
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'delete_order') {
      const num = C.clip(b.num, 20);
      const raw = await C.rc(['GET', 'order:' + num]);
      if (!raw) return bad(res, 'not_found', 404);
      const o = JSON.parse(raw);
      const cmds = [['DEL', 'order:' + num], ['LREM', 'orders', 0, num]];
      (o.items || []).forEach(i => { if (i.print && i.print.id) cmds.push(['DEL', 'dsg:' + i.print.id]); });
      if (o.user) cmds.push(['LREM', 'uorders:' + o.user, 0, num]);
      await C.redis(cmds);
      return res.status(200).json({ ok: true });
    }
    if (['user_block', 'user_delete', 'user_password', 'bonus_points'].includes(b.action)) {
      const phone = C.clip(b.phone, 20);
      if (!C.PHONE_RE.test(phone)) return bad(res, 'bad_phone');
      const u = await C.getUser(phone);
      if (!u) return bad(res, 'no_user', 404);
      if (b.action === 'user_block') { u.blocked = !!b.blocked; await C.rc(['SET', 'user:' + phone, JSON.stringify(u)]); return res.status(200).json({ ok: true, blocked: u.blocked }); }
      if (b.action === 'user_delete') { await C.redis([['DEL', 'user:' + phone], ['DEL', 'pts:' + phone], ['DEL', 'ptlog:' + phone]]); return res.status(200).json({ ok: true }); }
      if (b.action === 'user_password') {
        const pw = String(b.password || '');
        if (pw.length < 6 || pw.length > 100) return bad(res, 'bad_password');
        u.salt = C.crypto.randomBytes(16).toString('hex'); u.hash = C.hashPw(pw, u.salt);
        await C.rc(['SET', 'user:' + phone, JSON.stringify(u)]);
        return res.status(200).json({ ok: true });
      }
      const pts = int(b.points);
      if (!pts || Math.abs(pts) > 100000) return bad(res, 'bad_points');
      const bal = Math.max(0, +(await C.rc(['GET', 'pts:' + phone])) || 0);
      if (bal + pts < 0) return bad(res, 'insufficient');
      const n = await C.addPoints(phone, pts, b.note || (pts > 0 ? 'بونص من الإدارة' : 'خصم من الإدارة'));
      return res.status(200).json({ ok: true, balance: n });
    }
    if (b.action === 'code_create') {
      const value = int(b.value), maxUses = int(b.maxUses || 1), days = int(b.days || 0);
      if (!(value > 0 && value <= 100000)) return bad(res, 'bad_value');
      if (!(maxUses >= 1 && maxUses <= 10000)) return bad(res, 'bad_uses');
      let phone = b.phone ? C.clip(b.phone, 20) : null;
      if (phone) { if (!C.PHONE_RE.test(phone)) return bad(res, 'bad_phone'); if (!(await C.getUser(phone))) return bad(res, 'no_user', 404); }
      let code = C.NORM(b.code);
      const gen = () => 'DIVA-' + C.crypto.randomBytes(4).toString('hex').toUpperCase();
      for (let t = 0; t < 5; t++) {
        const c = code || gen();
        const obj = { code: c, value, maxUses, phone, note: C.clip(b.note, 80), expires: days > 0 ? Date.now() + days * 864e5 : null, created: Date.now() };
        if ((await C.rc(['SET', 'cp:' + c, JSON.stringify(obj), 'NX'])) === 'OK') {
          if (phone) await C.redis([['LPUSH', 'ucodes:' + phone, c], ['LTRIM', 'ucodes:' + phone, 0, 99]]);
          return res.status(200).json({ ok: true, code: c });
        }
        if (code) return bad(res, 'code_exists', 409);
      }
      return bad(res, 'server', 500);
    }
    if (b.action === 'code_delete') {
      const code = C.NORM(b.code);
      const raw = await C.rc(['GET', 'cp:' + code]);
      if (!raw) return bad(res, 'not_found', 404);
      const c = JSON.parse(raw);
      const cmds = [['DEL', 'cp:' + code], ['DEL', 'cpu:' + code]];
      if (c.phone) cmds.push(['LREM', 'ucodes:' + c.phone, 0, code]);
      await C.redis(cmds);
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'product_save' || b.action === 'meta_save' || b.action === 'product_delete') {
      const cat = await C.getCatalog();
      const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
      if (b.action === 'product_delete') {
        const id = String(b.id || '');
        if (!cat.custom.some(p => p.id === id)) return bad(res, 'not_found', 404);
        const gone = cat.custom.find(p => p.id === id);
        cat.custom = cat.custom.filter(p => p.id !== id);
        await C.rc(['SET', 'catalog', JSON.stringify(cat)]);
        for (const k of C.imgsOf(gone)) await C.rc(['DEL', 'pimg:' + k]);
        return res.status(200).json({ ok: true });
      }
      if (b.image && !(typeof b.image === 'string' && b.image.length <= 700000 && IMG_RE.test(b.image))) return bad(res, 'bad_image');
      if (b.action === 'meta_save') {
        const name = C.clip(b.name, 60), idx = C.NAMES.indexOf(name);
        if (idx < 0) return bad(res, 'not_found', 404);
        const m = cat.meta[name] || {};
        m.desc = C.clip(b.desc, 400);
        if (b.image) { await C.rc(['SET', 'pimg:n' + (idx + 1), b.image]); m.img = Date.now(); }
        else if (b.removeImage) { await C.rc(['DEL', 'pimg:n' + (idx + 1)]); m.img = 0; }
        cat.meta[name] = m;
        await C.rc(['SET', 'catalog', JSON.stringify(cat)]);
        return res.status(200).json({ ok: true });
      }
      const name = C.clip(b.name, 60).trim();
      if (name.length < 2) return bad(res, 'bad_name');
      let p = b.id ? cat.custom.find(x => x.id === String(b.id)) : null;
      if (b.id && !p) return bad(res, 'not_found', 404);
      // القسم بيتحدد وقت الإضافة بس: عطور، أعمال خشبية، طباعة وإكسسوار
      const section = p ? (p.section || 'perfume') : (['perfume', 'wood', 'print'].includes(b.section) ? b.section : 'perfume');
      let fields;
      if (section === 'perfume') {
        const prices = (Array.isArray(b.prices) ? b.prices : []).slice(0, 3).map(v => (v === '' || v == null ? 0 : int(v)));
        while (prices.length < 3) prices.push(0);
        if (!prices.every(v => Number.isInteger(v) && v >= 0 && v <= 100000) || !prices.some(v => v > 0)) return bad(res, 'bad_prices');
        fields = { prices };
      } else {
        const variants = (Array.isArray(b.variants) ? b.variants : []).slice(0, 8)
          .map(v => ({ label: C.clip(v && v.label, 30).trim(), price: int(v && v.price) })).filter(v => v.price > 0);
        if (!variants.length || variants.some(v => !(v.price <= 100000))) return bad(res, 'bad_prices');
        if (variants.length > 1 && variants.some(v => !v.label)) return bad(res, 'bad_variants');
        fields = { variants, printable: !!b.printable, printFee: Math.max(0, Math.min(100000, int(b.printFee || 0) || 0)), printNote: C.clip(b.printNote, 120) };
      }
      if (C.NAMES.includes(name) || cat.custom.some(x => x.name === name && x !== p)) return bad(res, 'name_exists', 409);
      if (!p) { p = { id: 'c' + Date.now().toString(36) + C.crypto.randomBytes(2).toString('hex'), img: 0, created: Date.now(), section }; cat.custom.push(p); }
      Object.assign(p, { name, desc: C.clip(b.desc, 400), cat: C.clip(b.cat, 20), hidden: !!b.hidden }, fields);
      if (Array.isArray(b.images)) {
        // لحد 4 صور: 'keep:<مفتاح>' تفضل زي ما هي، أو صورة جديدة. الباقي بيتمسح.
        const list = b.images.slice(0, 4);
        if (list.some(v => typeof v !== 'string' || (!v.startsWith('keep:') && !(v.length <= 700000 && IMG_RE.test(v))))) return bad(res, 'bad_image');
        const prev = C.imgsOf(p), out = [];
        for (const v of list) {
          if (v.startsWith('keep:')) { const k = v.slice(5); if (prev.includes(k) && !out.includes(k)) out.push(k); }
          else { const k = p.id + 'i' + Date.now().toString(36) + C.crypto.randomBytes(2).toString('hex'); await C.rc(['SET', 'pimg:' + k, v]); out.push(k); }
        }
        for (const k of prev) if (!out.includes(k)) await C.rc(['DEL', 'pimg:' + k]);
        p.imgs = out; p.img = out.length ? Date.now() : 0;
      } else if (b.image) { await C.rc(['SET', 'pimg:' + p.id, b.image]); p.img = Date.now(); p.imgs = [p.id]; }
      else if (b.removeImage) { await C.rc(['DEL', 'pimg:' + p.id]); p.img = 0; p.imgs = []; }
      await C.rc(['SET', 'catalog', JSON.stringify(cat)]);
      return res.status(200).json({ ok: true, id: p.id });
    }
    if (b.action === 'mix_save') {
      const cat = await C.getCatalog();
      const fixed = (Array.isArray(b.fixed) ? b.fixed : []).slice(0, 3).map(v => (v === '' || v == null ? 0 : int(v)));
      while (fixed.length < 3) fixed.push(0);
      const fee = int(b.fee || 0);
      if (!['avg', 'max', 'fixed'].includes(b.mode)) return bad(res, 'bad_mode');
      if (!fixed.every(v => Number.isInteger(v) && v >= 0 && v <= 100000) || !(fee >= 0 && fee <= 10000)) return bad(res, 'bad_prices');
      if (b.mode === 'fixed' && !fixed.some(v => v > 0)) return bad(res, 'bad_prices');
      cat.mix = { enabled: !!b.enabled, mode: b.mode, fixed, fee };
      await C.rc(['SET', 'catalog', JSON.stringify(cat)]);
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'catalog') {
      const hidden = (Array.isArray(b.hidden) ? b.hidden : []).filter(n => C.NAMES.includes(n));
      const prices = {};
      for (const n of C.NAMES) {
        const p = b.prices && b.prices[n];
        if (Array.isArray(p) && p.length === 3 && p.every(v => Number.isInteger(v) && v > 0 && v <= 100000)) prices[n] = p;
      }
      const cur = await C.getCatalog();
      await C.rc(['SET', 'catalog', JSON.stringify({ ...cur, hidden, prices })]);
      return res.status(200).json({ ok: true });
    }
    return bad(res, 'bad_action');
  } catch (e) { C.fail(res, e); }
};
