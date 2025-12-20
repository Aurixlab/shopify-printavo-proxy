// api/proxy.js
// Serverless function for Vercel
// Proxies requests from Shopify to Printavo (bypasses CORS)

const fetch = require('node-fetch');

// Your Printavo API credentials
const PRINTAVO_CONFIG = {
  apiUrl: 'https://www.printavo.com/api/v2',
  email: 'aurixlab@gmail.com',
  token: 'Sb3OElnenVelaFw8-xGz5A'
};

// Allowed origins for security
const ALLOWED_ORIGINS = [
  'https://budgetpromotion.myshopify.com',
  'https://www.budgetpromotion.com',
  'http://localhost:3000'
];

module.exports = async (req, res) => {
  const startTime = Date.now();
  
  // ==========================================
  // CORS Configuration
  // ==========================================
  const origin = req.headers.origin || req.headers.referer;
  
  // Set CORS headers
  if (origin) {
    const isAllowed = ALLOWED_ORIGINS.some(allowed => 
      origin.includes(allowed.replace('https://', '').replace('http://', ''))
    );
    
    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all for now
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
  
  // ==========================================
  // Handle Preflight Request
  // ==========================================
  if (req.method === 'OPTIONS') {
    console.log('✓ Preflight request handled');
    return res.status(200).end();
  }
  
  // ==========================================
  // Handle GET (Health Check)
  // ==========================================
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      service: 'Shopify-Printavo Proxy',
      timestamp: new Date().toISOString(),
      message: 'Proxy is running. Use POST to forward requests.'
    });
  }
  
  // ==========================================
  // Only Allow POST Requests for GraphQL
  // ==========================================
  if (req.method !== 'POST') {
    console.log('✗ Invalid method:', req.method);
    return res.status(405).json({ 
      error: 'Method not allowed',
      allowed: ['POST', 'OPTIONS', 'GET']
    });
  }
  
  // ==========================================
  // Process Request
  // ==========================================
  try {
    console.log('==========================================');
    console.log('📥 Incoming request from:', origin || 'unknown');
    console.log('Time:', new Date().toISOString());
    
    // Validate request body
    if (!req.body || !req.body.query) {
      console.log('✗ Missing query in request body');
      console.log('Body received:', JSON.stringify(req.body, null, 2));
      return res.status(400).json({ 
        error: 'Bad request',
        message: 'Request body must include "query" field',
        receivedBody: req.body
      });
    }
    
    console.log('📤 Forwarding to Printavo API...');
    console.log('Query type:', req.body.query.includes('mutation') ? 'Mutation' : 'Query');
    console.log('Query preview:', req.body.query.substring(0, 100) + '...');
    
    // Validate credentials before sending
    if (!PRINTAVO_CONFIG.email || !PRINTAVO_CONFIG.token) {
      console.log('✗ Missing API credentials');
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'API credentials not configured'
      });
    }
    
    // Forward request to Printavo
    const response = await fetch(PRINTAVO_CONFIG.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'email': PRINTAVO_CONFIG.email,
        'token': PRINTAVO_CONFIG.token
      },
      body: JSON.stringify(req.body)
    });
    
    console.log('📨 Printavo response status:', response.status, response.statusText);
    
    // Check if response is OK
    if (!response.ok) {
      const errorText = await response.text();
      console.log('✗ Printavo API error:', errorText);
      return res.status(response.status).json({
        error: 'Printavo API error',
        status: response.status,
        message: errorText
      });
    }
    
    // Parse response
    const data = await response.json();
    
    // Log response details
    if (data.errors) {
      console.log('⚠️ Printavo returned errors:', JSON.stringify(data.errors, null, 2));
    } else if (data.data) {
      console.log('✅ Success! Data received from Printavo');
      
      // Log what was created/retrieved
      if (data.data.quoteCreate) {
        console.log('   Quote created:', data.data.quoteCreate.quote?.visualId);
      } else if (data.data.quotes) {
        console.log('   Quotes retrieved:', data.data.quotes.nodes?.length);
      } else if (data.data.statuses) {
        console.log('   Statuses retrieved:', data.data.statuses.nodes?.length);
      } else if (data.data.customers) {
        console.log('   Customers retrieved:', data.data.customers.nodes?.length);
      } else if (data.data.invoices) {
        console.log('   Invoices retrieved:', data.data.invoices.nodes?.length);
      }
    } else {
      console.log('⚠️ Unexpected response structure:', JSON.stringify(data, null, 2));
    }
    
    const duration = Date.now() - startTime;
    console.log('⏱️ Request completed in', duration, 'ms');
    console.log('==========================================\n');
    
    // Return response to client
    return res.status(200).json(data);
    
  } catch (error) {
    console.error('==========================================');
    console.error('❌ Proxy error:', error.message);
    console.error('Stack:', error.stack);
    console.error('==========================================\n');
    
    return res.status(500).json({ 
      error: 'Proxy server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};
