/*
 * Cache Chromium inside the project so the copy downloaded by `npm install`
 * (puppeteer's postinstall) is the same one prerender.js launches at build
 * time. Netlify runs install and build in one job, so a project-local cache is
 * found reliably; the default ~/.cache location is not guaranteed to persist.
 */
const { join } = require('path');
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
