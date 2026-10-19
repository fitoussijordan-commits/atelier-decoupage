// Synchronisation des épisodes entre appareils (stockage Vercel Blob).
//   GET  ?op=index                    -> { episodes:{id:{name,updated,url,deleted}}, settings }
//   GET  ?op=get&id=ID                -> épisode complet (JSON)
//   POST {op:'audio', h, data}        -> { url }   (data = mp3 en base64)
//   POST {op:'put', ep}               -> { ok, updated }
//   POST {op:'del', id, updated}      -> { ok }
//   POST {op:'settings', settings}    -> { ok }
const { list, put, del } = require('@vercel/blob');
const okId = id => /^[A-Za-z0-9_-]{1,60}$/.test(String(id || ''));
async function readJson(path) {
  const { blobs } = await list({ prefix: path });
  const b = blobs.find(x => x.pathname === path);
  if (!b) return null;
  const r = await fetch(b.url + '?t=' + Date.now(), { cache: 'no-store' });
  return r.ok ? r.json() : null;
}
const writeJson = (path, obj) => put(path, JSON.stringify(obj), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
/* index sans fichier partagé (évite les écrasements) : un marqueur vide par épisode, sync/m/<id>/<date>.<supprimé> */
async function readIndex() {
  const episodes = {};let cursor;
  do {
    const r = await list({ prefix: 'sync/m/', limit: 1000, cursor });
    for (const b of r.blobs) {
      const m = b.pathname.match(/^sync\/m\/([A-Za-z0-9_-]+)\/(\d+)\.([01])$/);if (!m) continue;
      const u = Number(m[2]);if (!episodes[m[1]] || episodes[m[1]].updated < u) episodes[m[1]] = { updated: u, deleted: m[3] === '1' };
    }
    cursor = r.hasMore ? r.cursor : null;
  } while (cursor);
  const settings = await readJson('sync/settings.json');
  return { episodes, settings };
}
async function mark(id, updated, deleted) {
  await put(`sync/m/${id}/${updated}.${deleted ? 1 : 0}`, '1', { access: 'public', contentType: 'text/plain', addRandomSuffix: false, allowOverwrite: true });
  const r = await list({ prefix: `sync/m/${id}/` });
  const old = r.blobs.filter(b => b.pathname !== `sync/m/${id}/${updated}.${deleted ? 1 : 0}` && Number((b.pathname.split('/').pop() || '').split('.')[0]) < updated).map(b => b.url);
  if (old.length) await del(old).catch(() => {});
}

module.exports = async (req, res) => {
  const pw = process.env.APP_PASSWORD;
  const tok = process.env.GEN_TOKEN && req.query && req.query.token === process.env.GEN_TOKEN;
  if (pw && !tok && req.headers['x-app-password'] !== pw) return res.status(401).json({ error: 'mot de passe' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const op = req.query.op;
      if (op === 'index') return res.status(200).json(await readIndex());
      if (op === 'selftest' && tok) {
        const t1 = Date.now();await writeJson('sync/ep/zz-test.json', { id: 'zz-test', name: 'test', scenes: [] });await mark('zz-test', t1, false);
        await mark('zz-test', t1 + 5, false);const a = await readIndex();const g = await readJson('sync/ep/zz-test.json');
        await mark('zz-test', t1 + 10, true);const b2 = await readIndex();
        return res.status(200).json({ afterPut: a.episodes['zz-test'], got: !!g, afterDel: b2.episodes['zz-test'] });
      }
      if (op === 'get') {
        if (!okId(req.query.id)) return res.status(400).json({ error: 'id' });
        const ep = await readJson(`sync/ep/${req.query.id}.json`);
        return ep ? res.status(200).json(ep) : res.status(404).json({ error: 'introuvable' });
      }
      if (op === 'file') { // relais pour lire un son si le navigateur bloque l'accès direct
        const u = String(req.query.u || '');
        if (!/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\/sync\/audio\/[a-f0-9]{16,64}\.mp3$/.test(u)) return res.status(400).json({ error: 'url' });
        const r = await fetch(u); if (!r.ok) return res.status(404).end();
        res.setHeader('Content-Type', 'audio/mpeg'); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.status(200).send(Buffer.from(await r.arrayBuffer()));
      }
      return res.status(400).json({ error: 'op' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'méthode' });
    let b = req.body; if (typeof b === 'string') b = JSON.parse(b); b = b || {};
    if (b.op === 'audio') {
      const h = String(b.h || '');
      if (!/^[a-f0-9]{16,64}$/.test(h)) return res.status(400).json({ error: 'hash' });
      const buf = Buffer.from(String(b.data || ''), 'base64');
      if (!buf.length || buf.length > 4e6) return res.status(400).json({ error: 'taille' });
      const r = await put(`sync/audio/${h}.mp3`, buf, { access: 'public', contentType: 'audio/mpeg', addRandomSuffix: false, allowOverwrite: true });
      return res.status(200).json({ url: r.url });
    }
    if (b.op === 'put') {
      const ep = b.ep || {};
      if (!okId(ep.id) || !Array.isArray(ep.scenes)) return res.status(400).json({ error: 'épisode' });
      const updated = Number(ep.updated) || Date.now();
      await writeJson(`sync/ep/${ep.id}.json`, ep);
      await mark(ep.id, updated, false);
      return res.status(200).json({ ok: true, updated });
    }
    if (b.op === 'del') {
      if (!okId(b.id)) return res.status(400).json({ error: 'id' });
      await mark(b.id, Number(b.updated) || Date.now(), true);
      return res.status(200).json({ ok: true });
    }
    if (b.op === 'settings') {
      await writeJson('sync/settings.json', Object.assign({}, b.settings || {}, { updated: Date.now() }));
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'op' });
  } catch (e) { return res.status(500).json({ error: 'erreur serveur', detail: String(e.message || e).slice(0, 200) }); }
};
