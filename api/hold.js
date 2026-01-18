import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

// ============================================================================
// IMPORTANT: Add ALL your Shopify domains here
// ============================================================================
const ALLOW = [
  'https://budgetpromotion.myshopify.com',
  'https://www.budgetpromotion.com',
  'budgetpromotion.myshopify.com',        // Without https://
  'www.budgetpromotion.com',              // Without https://
  'http://localhost:3000',
  'localhost:3000'                        // For local testing
];

function setCors(req, res) {
  const origin = req.headers.origin || req.headers.referer || '';
  
  console.log('[CORS] Request from:', origin);
  console.log('[CORS] Referer:', req.headers.referer);
  
  // Check if origin is allowed (more permissive matching)
  const isAllowed = ALLOW.some(allowed => {
    const normalizedOrigin = origin.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const normalizedAllowed = allowed.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    return normalizedOrigin.includes(normalizedAllowed) || normalizedAllowed.includes(normalizedOrigin);
  });
  
  console.log('[CORS] Is allowed?', isAllowed);
  
  // Set CORS headers
  if (isAllowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    console.log('[CORS] ✅ Allowed:', origin);
  } else {
    // Fallback: allow all (you can restrict this later)
    res.setHeader('Access-Control-Allow-Origin', '*');
    console.log('[CORS] ⚠️ Using wildcard CORS');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async (req, res) => {
  // Always set CORS headers first
  setCors(req, res);
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    console.log('[CORS] Preflight request handled');
    return res.status(200).end();
  }
  
  // Health check endpoint
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      service: 'Shopify cart hold API',
      timestamp: new Date().toISOString(),
      redis: !!redis,
      allowedOrigins: ALLOW
    });
  }
  
  // Only allow POST for cart data
  if (req.method !== 'POST') {
    return res.status(405).json({error:'POST only'});
  }

  try {
    const body = req.body || {};
    
    console.log('[HOLD] Received request:', {
      cartToken: body.cartToken,
      itemCount: body.items?.length || 0
    });
    
    const cartToken = body.cartToken;
    if (!cartToken) {
      throw new Error('cartToken required');
    }
    
    // Store cart data for 30 minutes (1800 seconds)
    await redis.setex(`cart:${cartToken}`, 1800, JSON.stringify(body));
    
    console.log('[HOLD] ✅ Cart cached successfully:', cartToken);
    
    return res.status(200).json({
      ok: true,
      cartToken: cartToken,
      expiresIn: 1800
    });
    
  } catch (e) {
    console.error('[HOLD] ❌ Error:', e.message);
    return res.status(400).json({error: e.message});
  }
};
