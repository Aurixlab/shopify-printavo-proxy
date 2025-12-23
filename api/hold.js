import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

const ALLOW = [
  'https://budgetpromotion.myshopify.com',
  'https://www.budgetpromotion.com',
  'http://localhost:3000'
];

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const ok = ALLOW.some(o => origin.includes(o.replace(/^https?:\/\//,'')));
  res.setHeader('Access-Control-Allow-Origin', ok ? origin : '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});

  try {
    const body = req.body || {};
    const cartToken = body.cartToken;
    if (!cartToken) throw new Error('cartToken required');
    await redis.setex(`cart:${cartToken}`, 1800, JSON.stringify(body));
    return res.json({ok:true});
  } catch (e) {
    console.error('hold error:', e.message);
    return res.status(400).json({error:e.message});
  }
};
