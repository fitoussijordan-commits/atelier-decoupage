// Route Vercel : POST {text, duration} -> bruitage MP3 généré par ElevenLabs.
// Variables d'environnement : ELEVENLABS_API_KEY (obligatoire), APP_PASSWORD (facultatif).
module.exports = async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(500).json({ error: 'ELEVENLABS_API_KEY manquante' });
  const pw = process.env.APP_PASSWORD;
  if (pw && req.headers['x-app-password'] !== pw) return res.status(401).json({ error: 'mot de passe' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'méthode' }); }
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const text = String((body && body.text) || '').trim();
    let duration = Number(body && body.duration) || 0;
    if (!text || text.length > 450) return res.status(400).json({ error: 'texte invalide' });
    const payload = { text };
    if (duration > 0) payload.duration_seconds = Math.min(30, Math.max(0.5, duration));
    if (body && body.loop) payload.loop = true;
    const r = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) return res.status(r.status).json({ error: 'elevenlabs ' + r.status });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ error: 'erreur serveur' });
  }
};
