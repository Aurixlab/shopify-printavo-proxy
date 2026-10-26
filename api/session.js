/* store base-64 images for 30 min */
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { sessionId, frontDataUrl, backDataUrl } = req.body;
    if (!sessionId) throw new Error('sessionId required');
    if (typeof sessionId !== 'string' || !/^[\w.\-]{1,128}$/.test(sessionId)) throw new Error('invalid sessionId');
    for (const v of [frontDataUrl, backDataUrl]) {
      if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > 4 * 1024 * 1024)) throw new Error('invalid image data');
    }

    await redis.setex(`session:${sessionId}`, 1800, JSON.stringify({ frontDataUrl, backDataUrl }));
    return res.json({ ok: true });
  } catch (e) {
    console.error('[session]', e.message);
    return res.status(400).json({ error: e.message });
  }
};
