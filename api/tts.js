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
      return res.status(200).json({ voices });
    }
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      const text = String((body && body.text) || '').trim();
      const voiceId = String((body && body.voiceId) || '');
      if (!text || text.length > 1500) return res.status(400).json({ error: 'texte invalide' });
      if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) return res.status(400).json({ error: 'voix invalide' });
      const r = await fetch(API + '/text-to-speech/' + voiceId + '?output_format=mp3_44100_128', {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
      });
      if (!r.ok) return res.status(r.status).json({ error: 'elevenlabs ' + r.status });
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
