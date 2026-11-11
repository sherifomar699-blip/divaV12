const C = require('../lib/core');
const authHandler = require('../api_modules/auth');
const catalogHandler = require('../api_modules/catalog');
const orderHandler = require('../api_modules/order');
const ordersHandler = require('../api_modules/orders');
const trackHandler = require('../api_modules/track');
const meHandler = require('../api_modules/me');
const redeemHandler = require('../api_modules/redeem');
const uploadHandler = require('../api_modules/upload');
const designHandler = require('../api_modules/design');
const printReqHandler = require('../api_modules/print-request');
const adminHandler = require('../api_modules/admin');
const adsHandler = require('../api_modules/ads');
const imgHandler = require('../api_modules/img');

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
