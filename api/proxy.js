// api/proxy.js
// Serverless function for Vercel
// Proxies requests from Shopify to Printavo (bypasses CORS)

const fetch = require('node-fetch');

// Your Printavo API credentials
const PRINTAVO_CONFIG = {
  apiUrl: 'https://www.printavo.com/api/v2',
  email: 'aurixlab@gmail.com',
  token: 'Dw9WsBffRzogNyfOCEhswA'
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, email, token');
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
      message: 'Proxy is running. Use POST to forward requests.',
      credentials: {
        email: PRINTAVO_CONFIG.email ? '✅ Set' : '❌ Missing',
        token: PRINTAVO_CONFIG.token ? '✅ Set' : '❌ Missing',
        apiUrl: PRINTAVO_CONFIG.apiUrl
      }
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
    
    // Build headers - try both formats for Printavo API
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      // Lowercase headers (Printavo v2 API format)
      'email': PRINTAVO_CONFIG.email,
      'token': PRINTAVO_CONFIG.token,
      // Also try capitalized format
      'Email': PRINTAVO_CONFIG.email,
      'Token': PRINTAVO_CONFIG.token,
      // And X- prefix format
      'X-Email': PRINTAVO_CONFIG.email,
      'X-Token': PRINTAVO_CONFIG.token
    };
    
    console.log('📧 Using credentials:', {
      email: PRINTAVO_CONFIG.email,
      token: PRINTAVO_CONFIG.token.substring(0, 10) + '...',
      url: PRINTAVO_CONFIG.apiUrl
    });
    
    // Forward request to Printavo
    const response = await fetch(PRINTAVO_CONFIG.apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(req.body)
    });
    
    console.log('📨 Printavo response status:', response.status, response.statusText);
    console.log('📨 Response headers:', JSON.stringify([...response.headers.entries()], null, 2));
    
    // Get response text first
    const responseText = await response.text();
    console.log('📨 Raw response:', responseText.substring(0, 500));
    
    // Try to parse as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ Failed to parse response as JSON:', e);
      return res.status(500).json({
        error: 'Invalid JSON response from Printavo',
        response: responseText.substring(0, 1000)
      });
    }
    
    // Log response details
    if (data.errors) {
      console.log('⚠️ Printavo returned errors:', JSON.stringify(data.errors, null, 2));
      
      // Check if it's an auth error
      const isAuthError = data.errors.some(err => 
        err.message && (
          err.message.toLowerCase().includes('unauthorized') ||
          err.message.toLowerCase().includes('authentication') ||
          err.extensions?.code === 403 ||
          err.extensions?.code === 401
        )
      );
      
      if (isAuthError) {
        console.log('🔐 AUTHENTICATION FAILED!');
        console.log('   Email:', PRINTAVO_CONFIG.email);
        console.log('   Token:', PRINTAVO_CONFIG.token.substring(0, 10) + '...');
        console.log('   Please verify these credentials in your Printavo account');
      }
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
