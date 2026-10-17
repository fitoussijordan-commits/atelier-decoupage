const { list, put } = require('@vercel/blob');

function checkPassword(req, res) {
  const pw = process.env.APP_PASSWORD;
  if (pw && req.headers['x-app-password'] !== pw) { res.status(401).json({ error: 'mot de passe' }); return false; }
  return true;
}
const okEp = ep => /^[a-z0-9-]{1,40}$/.test(String(ep || ''));

async function readManifest(ep) {
  const { blobs } = await list({ prefix: `audio/${ep}/manifest.json` });
  const b = blobs.find(x => x.pathname === `audio/${ep}/manifest.json`);
  if (!b) return { items: {} };
  const r = await fetch(b.url + '?t=' + Date.now());
  if (!r.ok) return { items: {} };
  const j = await r.json();
  j.items = j.items || {};
  return j;
}
async function writeManifest(ep, m) {
  await put(`audio/${ep}/manifest.json`, JSON.stringify(m), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0
  });
}
module.exports = { checkPassword, okEp, readManifest, writeManifest, put };
