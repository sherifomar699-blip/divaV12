const C = require('../lib/core');
const authHandler = require('./auth');
const catalogHandler = require('./catalog');
const orderHandler = require('./order');
const ordersHandler = require('./orders');
const trackHandler = require('./track');
const meHandler = require('./me');
const redeemHandler = require('./redeem');
const uploadHandler = require('./upload');
const designHandler = require('./design');
const printReqHandler = require('./print-request');
const adminHandler = require('./admin');
const adsHandler = require('./ads');
const imgHandler = require('./img');

module.exports = async (req, res) => {
  const url = req.url || '';
  
  if (url.startsWith('/api/auth')) return authHandler(req, res);
  if (url.startsWith('/api/catalog')) return catalogHandler(req, res);
  if (url.startsWith('/api/order') && !url.startsWith('/api/orders')) return orderHandler(req, res);
  if (url.startsWith('/api/orders')) return ordersHandler(req, res);
  if (url.startsWith('/api/track')) return trackHandler(req, res);
  if (url.startsWith('/api/me')) return meHandler(req, res);
  if (url.startsWith('/api/redeem')) return redeemHandler(req, res);
  if (url.startsWith('/api/upload')) return uploadHandler(req, res);
  if (url.startsWith('/api/design')) return designHandler(req, res);
  if (url.startsWith('/api/print-request')) return printReqHandler(req, res);
  if (url.startsWith('/api/admin')) return adminHandler(req, res);
  if (url.startsWith('/api/ads')) return adsHandler(req, res);
  if (url.startsWith('/api/img')) return imgHandler(req, res);

  res.status(404).json({ error: 'not_found' });
};
