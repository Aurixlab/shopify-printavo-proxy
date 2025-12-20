// api/proxy.js
// FIXED V1 REST API - Proper line items handling

const PRINTAVO_CONFIG = {
  apiUrlV1: 'https://www.printavo.com/api/v1',
  email: 'aurixlab@gmail.com',
  token: 'Dw9WsBffRzogNyfOCEhswA'
};

const ALLOWED_ORIGINS = [
  'https://budgetpromotion.myshopify.com',
  'https://www.budgetpromotion.com',
  'http://localhost:3000'
];

module.exports = async (req, res) => {
  // CORS headers
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    const isAllowed = ALLOWED_ORIGINS.some(allowed => 
      origin.includes(allowed.replace('https://', '').replace('http://localhost', 'localhost'))
    );
    res.setHeader('Access-Control-Allow-Origin', isAllowed ? origin : '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      api: 'v1',
      service: 'Printavo V1 REST Proxy - FIXED LINE ITEMS',
      timestamp: new Date().toISOString(),
      credentials: {
        email: PRINTAVO_CONFIG.email ? '✅ Set' : '❌ Missing',
        token: PRINTAVO_CONFIG.token ? '✅ Set' : '❌ Missing'
      }
    });
  }
  
  // Process POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    console.log('==========================================');
    console.log('📥 V1 API Request from:', origin || 'unknown');
    console.log('Time:', new Date().toISOString());
    
    if (!req.body || !req.body.endpoint) {
      return res.status(400).json({ 
        error: 'Bad request',
        message: 'Body must include "endpoint" field'
      });
    }
    
    const { endpoint, method = 'GET', data = null } = req.body;
    
    console.log('📦 Request:', { endpoint, method });
    console.log('📋 Data received:', JSON.stringify(data, null, 2));
    
    // Build base URL with auth
    const url = new URL(`${PRINTAVO_CONFIG.apiUrlV1}/${endpoint}`);
    url.searchParams.append('email', PRINTAVO_CONFIG.email);
    url.searchParams.append('token', PRINTAVO_CONFIG.token);
    
    console.log('🌐 URL:', url.toString());
    
    const options = {
      method: method,
      headers: {
        'Accept': 'application/json'
      }
    };
    
    // For POST/PUT/PATCH, convert to form-urlencoded
    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      const formParams = new URLSearchParams();
      
      // Add order data (flat parameters, not nested)
      if (data.orderData) {
        console.log('📋 Processing orderData...');
        for (const [key, value] of Object.entries(data.orderData)) {
          formParams.append(key, value);
          console.log(`  ${key}: ${value}`);
        }
      }
      
      // Add line items if present - CRITICAL FIX HERE
      if (data.lineItems && Array.isArray(data.lineItems)) {
        console.log('📦 Processing line items...');
        
        data.lineItems.forEach((item, index) => {
          console.log(`  Item ${index}:`, item);
          
          // Only add fields that have values
          if (item.name) {
            formParams.append(`lineitems_attributes[${index}][name]`, item.name);
          }
          if (item.style) {
            formParams.append(`lineitems_attributes[${index}][style]`, item.style);
          }
          if (item.quantity) {
            formParams.append(`lineitems_attributes[${index}][quantity]`, item.quantity);
          }
          if (item.unit_price) {
            formParams.append(`lineitems_attributes[${index}][unit_price]`, item.unit_price);
          }
          if (item.description) {
            formParams.append(`lineitems_attributes[${index}][description]`, item.description);
          }
        });
      } else if (data.lineItems) {
        console.log('⚠️ WARNING: lineItems is not an array!', typeof data.lineItems);
      }
      
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.body = formParams.toString();
      
      console.log('📤 Form body being sent:');
      console.log(options.body);
      console.log('📊 Total params:', formParams.toString().split('&').length);
    }
    
    console.log('🚀 Sending request to Printavo...');
    const response = await fetch(url.toString(), options);
    const responseText = await response.text();
    
    console.log('📨 Response status:', response.status);
    console.log('📨 Response headers:', Object.fromEntries(response.headers.entries()));
    console.log('📨 Response body:', responseText.substring(0, 1000));
    
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ Invalid JSON response');
      console.error('Raw response:', responseText);
      return res.status(500).json({
        error: 'Invalid response from Printavo',
        response: responseText.substring(0, 500)
      });
    }
    
    if (!response.ok) {
      console.error('❌ Error response from Printavo:', result);
      return res.status(response.status).json(result);
    }
    
    console.log('✅ Success! Order ID:', result.id || 'N/A');
    console.log('✅ Visual ID:', result.visualid || 'N/A');
    console.log('==========================================\n');
    
    return res.status(200).json(result);
    
  } catch (error) {
    console.error('==========================================');
    console.error('❌ Proxy error:', error.message);
    console.error('❌ Stack:', error.stack);
    console.error('==========================================\n');
    
    return res.status(500).json({ 
      error: 'Proxy server error',
      message: error.message,
      stack: error.stack
    });
  }
};
