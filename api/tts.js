// Route Vercel : GET = liste des voix, POST = génère une réplique en MP3.
// Variables d'environnement : ELEVENLABS_API_KEY (obligatoire), APP_PASSWORD (facultatif).
const API = 'https://api.elevenlabs.io/v1';

module.exports = async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(500).json({ error: 'ELEVENLABS_API_KEY manquante' });
  const pw = process.env.APP_PASSWORD;
  if (pw && req.headers['x-app-password'] !== pw) return res.status(401).json({ error: 'mot de passe' });

  try {
    if (req.method === 'GET') {
      const r = await fetch(API + '/voices', { headers: { 'xi-api-key': key } });
      if (!r.ok) return res.status(r.status).json({ error: 'elevenlabs ' + r.status });
      const j = await r.json();
      const voices = (j.voices || []).map(v => ({ id: v.voice_id, name: v.name }));
      let models = [];
      try { const m = await fetch(API + '/models', { headers: { 'xi-api-key': key } }); const mj = await m.json(); models = (Array.isArray(mj) ? mj : []).filter(x => x.can_do_text_to_speech && (x.languages || []).some(l => l.language_id === 'fr')).map(x => ({ id: x.model_id, name: x.name })); } catch (e) {}
      return res.status(200).json({ voices, models });
    }
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      const text = String((body && body.text) || '').trim();
      const voiceId = String((body && body.voiceId) || '');
      const model = /^[a-z0-9_]{3,40}$/.test(String(body && body.model || '')) ? body.model : 'eleven_multilingual_v2';
      const payload = { text, model_id: model };
      if (body && body.settings && typeof body.settings === 'object') {
        const s = body.settings, vs = {};
        for (const k of ['stability', 'similarity_boost', 'style', 'speed']) if (typeof s[k] === 'number') vs[k] = s[k];
        if (typeof s.use_speaker_boost === 'boolean') vs.use_speaker_boost = s.use_speaker_boost;
        payload.voice_settings = vs;
      }
      if (model !== 'eleven_multilingual_v2') payload.language_code = 'fr';
      if (!text || text.length > 1500) return res.status(400).json({ error: 'texte invalide' });
      if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) return res.status(400).json({ error: 'voix invalide' });
      const r = await fetch(API + '/text-to-speech/' + voiceId + '?output_format=mp3_44100_128', {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) { const d = (await r.text()).slice(0, 300); return res.status(r.status).json({ error: 'elevenlabs ' + r.status, detail: d }); }
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(buf);
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'méthode' });
  } catch (e) {
    return res.status(500).json({ error: 'erreur serveur' });
  }
};
