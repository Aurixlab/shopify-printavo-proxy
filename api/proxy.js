/*  Shopify ➜  Printavo  +  create-invoice endpoint  */
const PRINTAVO = {
  base: 'https://www.printavo.com/api/v1',
  email: 'aurixlab@gmail.com',
  token: 'Dw9WsBffRzogNyfOCEhswA'
};

const ALLOWED_ORIGINS = [
  'https://budgetpromotion.myshopify.com',
  'https://www.budgetpromotion.com',
  'http://localhost:3000'
];

/*  helper: flat form body  */
function buildForm(data) {
  const p = new URLSearchParams();
  Object.entries(data).forEach(([k, v]) => p.append(k, String(v || '').trim()));
  (data.lineItems || []).forEach((it, idx) => {
    ['name', 'style', 'quantity', 'unit_price', 'description'].forEach(key => {
      p.append(`lineitems_attributes[${idx}][${key}]`, String(it[key] || '').trim());
    });
  });
  return p;
}

/*  ----  NEW: create Printavo invoice  ----  */
async function createInvoice(order) {
  const sessionId = order.attributes?._session_id;
  if (!sessionId) throw new Error('No _session_id in order');

  // pull images
  const imgRes = await fetch(`${process.env.VERCEL_URL}/api/retrieve?sessionId=${sessionId}`);
  if (!imgRes.ok) throw new Error('Images not found in Redis');
  const { frontDataUrl, backDataUrl } = await imgRes.json();

  // customer & shipping
  const addr = order.shipping_address || {};
  const due = new Date(); due.setDate(due.getDate() + 7);
  const dueStr = `${due.getMonth() + 1}/${due.getDate()}/${due.getFullYear()}`;

  const root = {
    user_id: '87416',
    customer_id: '10238441',
    order_nickname: `Shopify #${order.name}`,
    visualid: sessionId,
    formatted_due_date: dueStr,
    formatted_customer_due_date: dueStr,
    first_name: order.customer?.first_name || '',
    last_name: order.customer?.last_name || '',
    email: order.email || '',
    phone: order.phone || '',
    address1: addr.address1 || '',
    address2: addr.address2 || '',
    city: addr.city || '',
    state: addr.province || '',
    zip: addr.zip || '',
    country: addr.country || '',
    production_notes: `Front: ${frontDataUrl || 'none'}\nBack: ${backDataUrl || 'none'}`
  };

  // line items
  const lineItems = order.line_items.map(li => ({
    name: li.title,
    style: li.variant_title || 'Default',
    quantity: String(li.quantity),
    unit_price: (li.price / 100).toFixed(2),
    description: li.sku || ''
  }));

  const form = buildForm({ ...root, lineItems });
  const res = await fetch(`${PRINTAVO.base}/orders?email=${PRINTAVO.email}&token=${PRINTAVO.token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form
  });
  if (!res.ok) throw new Error(`Printavo refused: ${await res.text()}`);
  const created = await res.json();
  console.log('✅ Printavo order', created.id);
  return created;
}

/*  ----  main handler  ----  */
module.exports = async (req, res) => {
  // CORS
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.some(o => origin.includes(o.replace(/^https?:\/\//, '')));
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // health
  if (req.method === 'GET') return res.json({ status: 'ok', service: 'Printavo proxy' });

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { endpoint, method = 'GET', data } = body;

    /* ----------  create-invoice route (webhook)  ---------- */
    if (endpoint === 'create-invoice') {
      const created = await createInvoice(data);
      return res.json(created);
    }

    /* ----------  vanilla proxy  ---------- */
    const url = new URL(`${PRINTAVO.base}/${endpoint}`);
    url.searchParams.set('email', PRINTAVO.email);
    url.searchParams.set('token', PRINTAVO.token);

    const opts = { method, headers: { Accept: 'application/json' } };
    if (data && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (!Array.isArray(data.lineItems)) throw new Error('lineItems must be an array');
      opts.body = buildForm(data);
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const resp = await fetch(url, opts);
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { response: text }; }
    if (!resp.ok) return res.status(resp.status).json(json);
    return res.status(200).json(json);
  } catch (err) {
    console.error('❌ Proxy catch:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
