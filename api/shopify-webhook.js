import crypto from 'crypto';
import { Redis } from '@upstash/redis';
const redis = Redis.fromEnv();

const PRINTAVO = {
  url:'https://www.printavo.com/api/v1/orders',   // ← remove the trailing space
  email:'aurixlab@gmail.com',
  token:'Dw9WsBffRzogNyfOCEhswA'
};

export default async (req,res) => {
  /* 1. verify Shopify webhook – your code already ok */
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const sig  = crypto.createHmac('sha256', process.env.SHOPIFY_SECRET)
                     .update(req.body,'utf8').digest('base64');
  if (hmac !== sig) return res.status(401).send('Unauthorized');

  const order = JSON.parse(req.body);

  /* 2. pull the cart we cached 30 min ago */
  const cartKey = `cart:${order.cart_token}`;
  const cached  = await redis.get(cartKey);
  if (!cached) {
    console.warn('⚠️  no cached cart for cart_token', order.cart_token);
    return res.status(200).send('ok');          // still ack Shopify
  }
  const cartData = JSON.parse(cached);
  await redis.del(cartKey);                     // tidy up

  /* 3. build Printavo order data – now we have BOTH line-items + customer */
  const due = new Date();  due.setDate(due.getDate()+7);
  const dueStr = `${(due.getMonth()+1).toString().padStart(2,'0')}/${due.getDate().toString().padStart(2,'0')}/${due.getFullYear()}`;

  /* 3a. line-items from cached cart */
  const lineItems = cartData.items.map((it,idx) => ({
    name:        it.title,
    style:       it.variant || 'Default',
    quantity:    String(it.qty),
    unit_price:  String((it.price/100).toFixed(2)),
    description: Object.entries(it.properties||{})
                       .map(([k,v])=>`${k}: ${v}`).join('\n') || 'Shopify item'
  }));

  /* 3b. root order fields – now we can fill customer/shipping */
  const orderData = {
    user_id: String(87416),
    customer_id: String(10238441),
    formatted_due_date: dueStr,
    formatted_customer_due_date: dueStr,
    order_nickname: `Shopify #${order.name}`,
    visualid: `WEB-${order.checkout_token}`,

    /* === NEW: customer + shipping === */
    first_name: order.customer?.first_name || '',
    last_name:  order.customer?.last_name  || '',
    email:      order.email   || '',
    phone:      order.phone   || '',
    address1:   order.shipping_address?.address1 || order.billing_address?.address1 || '',
    address2:   order.shipping_address?.address2 || order.billing_address?.address2 || '',
    city:       order.shipping_address?.city     || order.billing_address?.city     || '',
    state:      order.shipping_address?.province || order.billing_address?.province || '',
    zip:        order.shipping_address?.zip      || order.billing_address?.zip      || '',
    country:    order.shipping_address?.country  || order.billing_address?.country  || '',

    production_notes: cartData.note || '',
    notes: `Total paid: $${(order.total_price/100).toFixed(2)}`
  };

  /* 4. send to Printavo (same code you already have) */
  const form = new URLSearchParams();
  Object.entries(orderData).forEach(([k,v])=>form.append(k,v));
  lineItems.forEach((it,i)=>{
    Object.entries(it).forEach(([k,v])=>form.append(`lineitems_attributes[${i}][${k}]`,v));
  });

  const pr = await fetch(PRINTAVO.url,{
    method:'POST',
    headers:{ 'content-type':'application/x-www-form-urlencoded' },
    body: form
  });

  if (!pr.ok) {
    const txt = await pr.text();
    console.error('❌ Printavo refused order',txt);
    return res.status(500).send('Printavo error');
  }

  const printavoOrder = await pr.json();
  console.log('✅ Printavo order created',printavoOrder.id);
  res.status(200).send('ok');
};
