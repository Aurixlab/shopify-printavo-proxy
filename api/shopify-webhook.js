import crypto from 'crypto';
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

const PRINTAVO = {
  url:   'https://www.printavo.com/api/v1/orders',
  email: 'aurixlab@gmail.com',
  token: 'Dw9WsBffRzogNyfOCEhswA'
};

function buildCustomerNotes(order, cartData) {
  const lines = [`Budget Promotion Shopify Order ${order.name}`];
  lines.push(`Total paid: $${(order.total_price / 100).toFixed(2)}`);

  // Collect _image_details from cached cart items (plain object format)
  // and fall back to Shopify order line item properties ({name,value} array format)
  const imageDetailsSeen = new Set();
  const imageLines = [];

  const extractFromValue = (value) => {
    if (!value || imageDetailsSeen.has(value)) return;
    imageDetailsSeen.add(value);
    const entries = value.split(',').map(s => s.trim()).filter(Boolean);
    entries.forEach(entry => {
      const dpiMatch = entry.match(/(\d+)\s*DPI/);
      const dpi = dpiMatch ? parseInt(dpiMatch[1]) : 0;
      const indicator = dpi >= 300 ? '✓' : dpi > 0 ? '⚠' : '';
      imageLines.push(`  ${entry}${indicator ? ' ' + indicator : ''}`);
    });
  };

  // Primary: read from Redis-cached cart (plain object properties)
  (cartData?.items || []).forEach(item => {
    const val = item.properties?._image_details;
    if (val) extractFromValue(val);
  });

  // Fallback: read from Shopify order line items ({name, value} array)
  if (imageLines.length === 0) {
    (order.line_items || []).forEach(item => {
      const props = Array.isArray(item.properties) ? item.properties : [];
      const detailProp = props.find(p => p.name === '_image_details');
      if (detailProp?.value) extractFromValue(detailProp.value);
    });
  }

  if (imageLines.length > 0) {
    lines.push('');
    lines.push('Image Details:');
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

  /* 3a. Line items from cached cart — group by order_group_id so sizes collapse into one row */
  const SIZE_FIELDS = { 'S': 's', 'M': 'm', 'L': 'l', 'XL': 'xl', '2XL': 'xxl', '3XL': 'xxxl' };

  // Build a map of image_details from Shopify order webhook payload (no Redis needed)
  // order.line_items[].properties is [{name, value}] array format
  const orderImageDetails = {};
  (order.line_items || []).forEach(item => {
    const props = Array.isArray(item.properties) ? item.properties : [];
    const detailProp = props.find(p => p.name === '_image_details');
    const groupProp  = props.find(p => p.name === '_order_group_id');
    if (detailProp?.value && groupProp?.value) {
      orderImageDetails[groupProp.value] = detailProp.value;
    }
  });

  const groups = {};
  cartData.items.forEach((it, idx) => {
    const groupId = it.properties?._order_group_id || `single_${idx}`;
    if (!groups[groupId]) {
      groups[groupId] = {
        name:       it.title,
        style:      it.variant || 'Default',
        unit_price: String((it.price / 100).toFixed(2)),
        props:      it.properties || {},
        image_details: it.properties?._image_details || orderImageDetails[groupId] || '',
        front_design_url: it.properties?._design_front || '',
        back_design_url:  it.properties?._design_back  || '',
        sizes: {},
        totalQty: 0
      };
    }
    const size = (it.properties?._size || '').trim().toUpperCase();
    const qty  = parseInt(it.qty) || 0;
    if (size) groups[groupId].sizes[size] = (groups[groupId].sizes[size] || 0) + qty;
    groups[groupId].totalQty += qty;
  });

  const lineItems = Object.values(groups).map((g, idx) => {
    const baseDesc = Object.entries(g.props || {})
                           .filter(([k]) => !k.startsWith('_design_'))
                           .map(([k, v]) => `${k}: ${v}`)
                           .join('\n') || 'Shopify item';
    const description = g.image_details
      ? `${baseDesc}\n---\n${g.image_details}`
      : baseDesc;

    const item = {
      name:       g.name,
      style:      g.style,
      quantity:   String(g.totalQty),
      unit_price: g.unit_price,
      description
    };

    // Map sizes to Printavo columns (S, M, L, XL, 2XL, 3XL)
    Object.entries(SIZE_FIELDS).forEach(([label, field]) => {
      item[field] = String(g.sizes[label] || 0);
    });

    if (g.front_design_url) { console.log(`   🎨 Front: ${g.front_design_url}`); item.front_design_url = g.front_design_url; }
    if (g.back_design_url)  { console.log(`   🎨 Back: ${g.back_design_url}`);   item.back_design_url  = g.back_design_url;  }
    if (g.image_details)    { console.log(`   📐 Image details: ${g.image_details}`); }

    console.log(`📦 Line item ${idx + 1}:`, g.name, '| sizes:', g.sizes, '| total:', g.totalQty);
    return item;
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
    notes: buildCustomerNotes(order, cartData)
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
