import crypto from 'crypto';
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

const PRINTAVO = {
  url:   'https://www.printavo.com/api/v1/orders',
  email: 'aurixlab@gmail.com',
  token: 'Dw9WsBffRzogNyfOCEhswA'
};

function buildCustomerNotes(order) {
  const lines = [`Budget Promotion Shopify Order ${order.name}`];
  lines.push(`Total paid: $${(order.total_price / 100).toFixed(2)}`);

  // Collect _image_details from all line items, deduplicate identical values
  const imageDetailsSeen = new Set();
  const imageLines = [];

  (order.line_items || []).forEach(item => {
    const props = item.properties || [];
    const detailProp = props.find(p => p.name === '_image_details');
    if (!detailProp || !detailProp.value || imageDetailsSeen.has(detailProp.value)) return;
    imageDetailsSeen.add(detailProp.value);

    // Format: "(1) front | 8.50in × 11.00in | 245 DPI, (2) back | 11.50in × 15.00in | 312 DPI"
    const entries = detailProp.value.split(',').map(s => s.trim()).filter(Boolean);
    entries.forEach(entry => {
      const dpiMatch = entry.match(/(\d+)\s*DPI/);
      const dpi = dpiMatch ? parseInt(dpiMatch[1]) : 0;
      const indicator = dpi >= 300 ? '✓' : dpi > 0 ? '⚠' : '';
      imageLines.push(`  ${entry}${indicator ? ' ' + indicator : ''}`);
    });
  });

  if (imageLines.length > 0) {
    lines.push('');
    lines.push('🖼 Image Details:');
    imageLines.forEach(l => lines.push(l));
  }

  return lines.join('\n');
}

export default async (req, res) => {
  /* 1. Verify Shopify webhook signature */
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const sig  = crypto.createHmac('sha256', process.env.SHOPIFY_SECRET)
                     .update(req.body, 'utf8').digest('base64');
  if (hmac !== sig) return res.status(401).send('Unauthorized');

  const order = JSON.parse(req.body);

  /* 2. Pull the cart cached at checkout time */
  const cartKey = `cart:${order.cart_token}`;
  const cached  = await redis.get(cartKey);
  if (!cached) {
    console.warn('⚠️  no cached cart for cart_token', order.cart_token);
    return res.status(200).send('ok'); // still ack Shopify
  }
  const cartData = JSON.parse(cached);
  await redis.del(cartKey); // tidy up

  /* 3. Build Printavo order */
  const due = new Date();
  due.setDate(due.getDate() + 7);
  const dueStr = `${(due.getMonth() + 1).toString().padStart(2, '0')}/${due.getDate().toString().padStart(2, '0')}/${due.getFullYear()}`;

  /* 3a. Line items from cached cart */
  const lineItems = cartData.items.map((it, idx) => {
    const baseItem = {
      name:       it.title,
      style:      it.variant || 'Default',
      quantity:   String(it.qty),
      unit_price: String((it.price / 100).toFixed(2)),
      description: Object.entries(it.properties || {})
                         .filter(([k]) => !k.startsWith('_'))
                         .map(([k, v]) => `${k}: ${v}`)
                         .join('\n') || 'Shopify item'
    };

    const frontUrl = it.properties?._design_front || '';
    const backUrl  = it.properties?._design_back  || '';

    console.log(`📦 Item ${idx + 1}:`, it.title);
    if (frontUrl) { console.log(`   🎨 Front: ${frontUrl}`); baseItem.front_design_url = frontUrl; }
    if (backUrl)  { console.log(`   🎨 Back: ${backUrl}`);   baseItem.back_design_url  = backUrl;  }

    return baseItem;
  });

  console.log(`✅ Line items prepared: ${lineItems.length}`);

  /* 3b. Root order fields */
  const orderData = {
    user_id:                      String(87416),
    customer_id:                  String(10238441),
    formatted_due_date:           dueStr,
    formatted_customer_due_date:  dueStr,
    order_nickname:               `Shopify #${order.name}`,
    visualid:                     `WEB-${order.checkout_token}`,

    first_name: order.customer?.first_name || '',
    last_name:  order.customer?.last_name  || '',
    email:      order.email  || '',
    phone:      order.phone  || '',
    address1:   order.shipping_address?.address1 || order.billing_address?.address1 || '',
    address2:   order.shipping_address?.address2 || order.billing_address?.address2 || '',
    city:       order.shipping_address?.city     || order.billing_address?.city     || '',
    state:      order.shipping_address?.province || order.billing_address?.province || '',
    zip:        order.shipping_address?.zip      || order.billing_address?.zip      || '',
    country:    order.shipping_address?.country  || order.billing_address?.country  || '',

    production_notes: cartData.note || '',
    notes: buildCustomerNotes(order)
  };

  /* 4. Send to Printavo */
  const form = new URLSearchParams();
  Object.entries(orderData).forEach(([k, v]) => form.append(k, v));
  lineItems.forEach((it, i) => {
    Object.entries(it).forEach(([k, v]) => form.append(`lineitems_attributes[${i}][${k}]`, v));
  });

  const pr = await fetch(PRINTAVO.url, {
    method:  'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body:    form
  });

  if (!pr.ok) {
    const txt = await pr.text();
    console.error('❌ Printavo refused order', txt);
    return res.status(500).send('Printavo error');
  }

  const printavoOrder = await pr.json();
  console.log('✅ Printavo order created', printavoOrder.id);
  res.status(200).send('ok');
};
