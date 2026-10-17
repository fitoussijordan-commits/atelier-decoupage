// Route Vercel réservée à Claude : génère en lot les voix et bruitages d'un épisode.
//   GET /api/batch?token=GEN_TOKEN&op=voices            -> liste détaillée des voix du compte
//   GET /api/batch?token=GEN_TOKEN&ep=nuit&op=status    -> ce qui reste à générer
//   GET /api/batch?token=GEN_TOKEN&ep=nuit&op=run&limit=5 -> génère jusqu'à 5 sons manquants
const { okEp, readManifest, writeManifest, put } = require('../lib/common');
const EPISODES = { nuit: require('../episodes/nuit.json') };
const API = 'https://api.elevenlabs.io/v1';

module.exports = async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY, gen = process.env.GEN_TOKEN;
  if (!key || !gen) return res.status(500).json({ error: 'configuration manquante' });
  if (req.query.token !== gen) return res.status(200).json({ error: 'token', gotLen: String(req.query.token || '').length, queryKeys: Object.keys(req.query || {}) });
  try {
    const op = req.query.op;
    if (op === 'voices') {
      const r = await fetch(API + '/voices', { headers: { 'xi-api-key': key } });
      if (!r.ok) return res.status(200).json({ error: 'elevenlabs ' + r.status });
      const j = await r.json();
      return res.status(200).json({ voices: (j.voices || []).map(v => ({ id: v.voice_id, name: v.name, category: v.category, labels: v.labels, description: v.description })) });
    }
    const ep = req.query.ep, E = EPISODES[ep];
    if (!okEp(ep) || !E) return res.status(400).json({ error: 'épisode inconnu' });
    const m = await readManifest(ep);
    m.voices = E.voices || {};
    const todo = [];
    for (const l of E.lines || []) { const it = m.items[l.key]; if (!it || it.text !== l.text || it.voice !== (E.voices || {})[l.who]) todo.push({ ...l, kind: 'voice' }); }
    for (const x of E.sfx || []) { const it = m.items[x.key]; if (!it || it.text !== x.text || it.dur !== (x.dur || 0)) todo.push({ ...x, kind: 'sfx' }); }
    if (op === 'status') return res.status(200).json({ total: (E.lines || []).length + (E.sfx || []).length, remaining: todo.map(t => t.key) });
    if (op !== 'run') return res.status(400).json({ error: 'op inconnue' });
    const limit = Math.min(8, Math.max(1, Number(req.query.limit) || 4));
    const done = [], errors = [];
    for (const t of todo.slice(0, limit)) {
      try {
        let r;
        if (t.kind === 'voice') {
          const vid = (E.voices || {})[t.who];
          if (!vid) throw new Error('pas de voix pour ' + t.who);
          r = await fetch(`${API}/text-to-speech/${vid}?output_format=mp3_44100_128`, {
            method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            body: JSON.stringify({ text: t.text, model_id: 'eleven_multilingual_v2' })
          });
        } else {
          const payload = { text: t.text };
          if (t.dur > 0) payload.duration_seconds = Math.min(30, Math.max(0.5, t.dur));
          r = await fetch(`${API}/sound-generation?output_format=mp3_44100_128`, {
            method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            body: JSON.stringify(payload)
          });
        }
        if (!r.ok) throw new Error('elevenlabs ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        const b = await put(`audio/${ep}/${t.key}.mp3`, buf, { access: 'public', contentType: 'audio/mpeg', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
        m.items[t.key] = { url: b.url, text: t.text, kind: t.kind, voice: t.kind === 'voice' ? (E.voices || {})[t.who] : undefined, dur: t.kind === 'sfx' ? (t.dur || 0) : undefined };
        done.push(t.key);
      } catch (e) { errors.push(t.key + ': ' + e.message); }
    }
    await writeManifest(ep, m);
    return res.status(200).json({ done, errors, remaining: todo.length - done.length });
  } catch (e) {
    return res.status(500).json({ error: 'erreur serveur', detail: String(e.message || e).slice(0, 200) });
  }
};
