// api/hold.js  –  cache cart snapshot
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

const ALLOWED = [
  'https://budgetpromotion.myshopify.com',
  'https://www.budgetpromotion.com',
  'http://localhost:3000'
];

function cors(req, res) {
  const origin = req.headers.origin || '';
  const ok = ALLOWED.some(o => origin.includes(o.replace(/^https?:\/\//,'')));
  res.setHeader('Access-Control-Allow-Origin', ok ? origin : '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async (req, res) => {
  cors(req, res);                 // always first

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({error:'POST only'});

  const { cartToken, ...payload } = req.body;
  if (!cartToken) return res.status(400).json({error:'missing cartToken'});

  await redis.setex(`cart:${cartToken}`, 1800, JSON.stringify(payload));
  res.json({ok:true});
};
