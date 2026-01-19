/* fetch images by sessionId */
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

export default async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const sessionId = req.query.sessionId;
    if (!sessionId) throw new Error('sessionId required');

    const raw = await redis.get(`session:${sessionId}`);
    if (!raw) return res.status(404).json({ error: 'not found' });

    const { frontDataUrl, backDataUrl } = JSON.parse(raw);
    return res.json({ frontDataUrl, backDataUrl });
  } catch (e) {
    console.error('[retrieve]', e.message);
    return res.status(400).json({ error: e.message });
  }
};
