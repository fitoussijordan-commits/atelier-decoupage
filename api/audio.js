// Route Vercel : l'outil y récupère les sons générés pour un épisode.
//   GET /api/audio?ep=nuit            -> manifeste { voices, items:{clé:{text,kind}} }
//   GET /api/audio?ep=nuit&key=s1l1   -> le MP3
const { checkPassword, okEp, readManifest } = require('../lib/common');

module.exports = async (req, res) => {
  try {
    const ep = req.query.ep, key = req.query.key;
    if (!okEp(ep)) return res.status(400).json({ error: 'épisode invalide' });
    const m = await readManifest(ep);
    if (!key) {
      const items = {};
      for (const k in m.items) items[k] = { text: m.items[k].text, kind: m.items[k].kind, v: m.items[k].voice || '' };
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ voices: m.voices || {}, items });
    }
    const it = m.items[String(key)];
    if (!it) return res.status(404).json({ error: 'absent' });
    const r = await fetch(it.url);
    if (!r.ok) return res.status(502).json({ error: 'stockage' });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ error: 'erreur serveur' });
  }
};
