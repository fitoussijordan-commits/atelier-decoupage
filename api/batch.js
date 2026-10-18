// Route Vercel réservée à Claude : génère en lot les voix et bruitages d'un épisode.
//   GET /api/batch?token=GEN_TOKEN&op=voices            -> liste détaillée des voix du compte
//   GET /api/batch?token=GEN_TOKEN&ep=nuit&op=status    -> ce qui reste à générer
//   GET /api/batch?token=GEN_TOKEN&ep=nuit&op=run&limit=5 -> génère jusqu'à 5 sons manquants
const { okEp, readManifest, writeManifest, put } = require('../lib/common');
const EPISODES = { nuit: require('../episodes/nuit.json'), cerf: require('../episodes/cerf.json'), lib: require('../episodes/lib.json') };
const API = 'https://api.elevenlabs.io/v1';

module.exports = async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY, gen = process.env.GEN_TOKEN;
  if (!key || !gen) return res.status(500).json({ error: 'configuration manquante' });
  if (req.query.token !== gen) return res.status(200).json({ error: 'token', gotLen: String(req.query.token || '').length, queryKeys: Object.keys(req.query || {}) });
  try {
    const op = req.query.op;
    if (op === 'voices') {
      const r = await fetch(API + '/voices', { headers: { 'xi-api-key': key } });
      if (!r.ok) return res.status(200).json({ error: 'elevenlabs ' + r.status, keyLen: String(key||'').length, body: (await r.text()).slice(0, 400) });
      const j = await r.json();
      return res.status(200).json({ voices: (j.voices || []).map(v => ({ id: v.voice_id, name: v.name, category: v.category, labels: v.labels, description: v.description })) });
    }
    if (op === 'ttstest') {
      const model = req.query.model || 'eleven_v3';
      const body = { text: req.query.text || '[excited] Coucou ! Tu viens jouer avec moi ?', model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.8 } };
      if (model !== 'eleven_multilingual_v2') body.language_code = 'fr';
      const r = await fetch(`${API}/text-to-speech/${req.query.voice || 'Xgb3SR8idOHy8scGICeJ'}?output_format=mp3_44100_128`, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const buf = Buffer.from(await r.arrayBuffer());
      return res.status(200).json({ status: r.status, bytes: buf.length, err: r.ok ? null : buf.toString().slice(0, 300) });
    }
    if (op === 'models') {
      const r = await fetch(API + '/models', { headers: { 'xi-api-key': key } });
      const j = await r.json().catch(() => []);
      return res.status(200).json((Array.isArray(j) ? j : []).filter(m => m.can_do_text_to_speech).map(m => ({ id: m.model_id, name: m.name, fr: (m.languages || []).some(l => l.language_id === 'fr'), cost: m.token_cost_factor, maxChars: m.maximum_text_length_per_request })));
    }
    if (op === 'credits') {
      const r = await fetch(API + '/user/subscription', { headers: { 'xi-api-key': key } });
      const j = await r.json().catch(() => ({}));
      return res.status(200).json({ status: r.status, tier: j.tier, used: j.character_count, limit: j.character_limit, reset: j.next_character_count_reset_unix, err: j.detail });
    }
    if (op === 'library') {
      const q = new URLSearchParams({ page_size: '30', language: 'fr', sort: 'trending' });
      for (const k of ['search', 'age', 'gender', 'category', 'use_cases', 'descriptives']) if (req.query[k]) q.set(k, req.query[k]);
      const r = await fetch(API + '/shared-voices?' + q, { headers: { 'xi-api-key': key } });
      if (!r.ok) return res.status(200).json({ error: 'elevenlabs ' + r.status, body: (await r.text()).slice(0, 300) });
      const j = await r.json();
      return res.status(200).json({ voices: (j.voices || []).map(v => ({ id: v.voice_id, owner: v.public_owner_id, name: v.name, age: v.age, gender: v.gender, use: v.use_case, desc: (v.description || '').slice(0, 120), lang: v.language, accent: v.accent })) });
    }
    if (op === 'add') {
      const r = await fetch(`${API}/voices/add/${encodeURIComponent(req.query.owner)}/${encodeURIComponent(req.query.voice)}`, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ new_name: req.query.name || 'voix' }) });
      return res.status(200).json({ status: r.status, body: (await r.text()).slice(0, 300) });
    }
    const ep = req.query.ep, E = EPISODES[ep];
    if (!okEp(ep) || !E) return res.status(400).json({ error: 'épisode inconnu' });
    const m = await readManifest(ep);
    m.voices = E.voices || {};
    const todo = [];
    for (const l of E.lines || []) { const it = m.items[l.key]; if (!it || it.text !== l.text || it.voice !== (E.voices || {})[l.who]) todo.push({ ...l, kind: 'voice' }); }
    for (const x of E.sfx || []) { const it = m.items[x.key]; if (!it || it.text !== x.text || it.dur !== (x.dur || 0) || !!it.loop !== !!x.loop) todo.push({ ...x, kind: 'sfx' }); }
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
          if (t.loop) payload.loop = true;
          r = await fetch(`${API}/sound-generation?output_format=mp3_44100_128`, {
            method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            body: JSON.stringify(payload)
          });
        }
        if (!r.ok) throw new Error('elevenlabs ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        const b = await put(`audio/${ep}/${t.key}.mp3`, buf, { access: 'public', contentType: 'audio/mpeg', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
        m.items[t.key] = { url: b.url, text: t.text, kind: t.kind, voice: t.kind === 'voice' ? (E.voices || {})[t.who] : undefined, dur: t.kind === 'sfx' ? (t.dur || 0) : undefined, loop: t.kind === 'sfx' ? !!t.loop : undefined };
        done.push(t.key);
      } catch (e) { errors.push(t.key + ': ' + e.message); }
    }
    await writeManifest(ep, m);
    return res.status(200).json({ done, errors, remaining: todo.length - done.length });
  } catch (e) {
    return res.status(500).json({ error: 'erreur serveur', detail: String(e.message || e).slice(0, 200) });
  }
};
