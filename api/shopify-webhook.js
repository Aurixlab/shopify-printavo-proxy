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
/* 3a. line-items from cached cart WITH IMAGE URLS */
const lineItems = cartData.items.map((it,idx) => {
  const baseItem = {
    name:        it.title,
    style:       it.variant || 'Default',
    quantity:    String(it.qty),
    unit_price:  String((it.price/100).toFixed(2)),
    description: Object.entries(it.properties||{})
                       .filter(([k,v]) => !k.startsWith('_design_'))  // Don't show URLs in description
                       .map(([k,v])=>`${k}: ${v}`).join('\n') || 'Shopify item'
  };
  
  // ✅ Extract image URLs from properties
  const frontUrl = it.properties?._design_front || '';
  const backUrl = it.properties?._design_back || '';
  
  console.log(`📦 Item ${idx + 1}:`, it.title);
  if (frontUrl) {
    console.log(`   🎨 Front design: ${frontUrl}`);
    baseItem.front_design_url = frontUrl;  // ✅ Add to Printavo payload
  }
  if (backUrl) {
    console.log(`   🎨 Back design: ${backUrl}`);
    baseItem.back_design_url = backUrl;   // ✅ Add to Printavo payload
  }
  
  return baseItem;
});

console.log(`✅ Line items prepared: ${lineItems.length} items`);
```

**Note:** You may need to check Printavo API docs for the correct field names. Common options:
- `artwork_url`
- `front_artwork_url` / `back_artwork_url`
- `design_url`
- `mockup_url`

---

## 🧪 TESTING

### **Test 1: Upload to ImgBB**

1. Open product page
2. Customize design
3. Click "Save Design"
4. Watch console:
```
📤 Uploading image to ImgBB: front-design
   Image size: 52341 chars
✅ Image uploaded successfully!
   URL: https://i.ibb.co/ABC123/front-design.png
   Size: 15234 bytes

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
