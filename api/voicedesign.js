// Voix sur mesure (ElevenLabs Voice Design) : propose des voix à partir d'une description, puis enregistre celle choisie.
//   POST {op:'design', description, text, model}  -> { previews:[{id, audio(base64 mp3)}] }
//   POST {op:'create', name, description, id}      -> { voice_id }
const API = 'https://api.elevenlabs.io/v1';
module.exports = async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(500).json({ error: 'ELEVENLABS_API_KEY manquante' });
  const pw = process.env.APP_PASSWORD;
  if (pw && req.headers['x-app-password'] !== pw) return res.status(401).json({ error: 'mot de passe' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'méthode' });
  try {
    let b = req.body; if (typeof b === 'string') b = JSON.parse(b); b = b || {};
    const H = { 'xi-api-key': key, 'Content-Type': 'application/json' };
    if (b.op === 'design') {
      const description = String(b.description || '').slice(0, 1000);
      let text = String(b.text || '').slice(0, 1000);
      if (description.length < 20) return res.status(400).json({ error: 'description trop courte' });
      while (text && text.length < 100) text = text + ' ' + text;
      const payload = { voice_description: description, model_id: b.model === 'eleven_ttv_v3' ? 'eleven_ttv_v3' : 'eleven_multilingual_ttv_v2', guidance_scale: 5 };
      if (text) payload.text = text.slice(0, 1000); else payload.auto_generate_text = true;
      const r = await fetch(API + '/text-to-voice/design?output_format=mp3_44100_128', { method: 'POST', headers: H, body: JSON.stringify(payload) });
      if (!r.ok) return res.status(r.status).json({ error: 'elevenlabs ' + r.status, detail: (await r.text()).slice(0, 300) });
      const j = await r.json();
      return res.status(200).json({ previews: (j.previews || []).map(p => ({ id: p.generated_voice_id, audio: p.audio_base_64 })) });
    }
    if (b.op === 'create') {
      const r = await fetch(API + '/text-to-voice', { method: 'POST', headers: H, body: JSON.stringify({ voice_name: String(b.name || 'Voix').slice(0, 60), voice_description: String(b.description || '').slice(0, 1000), generated_voice_id: String(b.id || '') }) });
      if (!r.ok) return res.status(r.status).json({ error: 'elevenlabs ' + r.status, detail: (await r.text()).slice(0, 300) });
      const j = await r.json();
      return res.status(200).json({ voice_id: j.voice_id });
    }
    return res.status(400).json({ error: 'op inconnue' });
  } catch (e) { return res.status(500).json({ error: 'erreur serveur', detail: String(e.message || e).slice(0, 200) }); }
};
