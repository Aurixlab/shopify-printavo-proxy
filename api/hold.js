// /api/hold.js
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();            // UPSTASH_REDIS_REST_URL + TOKEN

export default async (req,res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const body = req.body;                  // Vercel parses JSON automatically
  if (!body?.cartToken) return res.status(400).json({error:'missing cartToken'});

  const key = `cart:${body.cartToken}`;
  await redis.setex(key, 1800, JSON.stringify(body)); // 30 min TTL
  res.json({ok:true});
};
