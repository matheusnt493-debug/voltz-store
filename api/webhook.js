// api/webhook.js
// Vercel Serverless Function
// Stripe calls this URL automatically when a payment is completed
// This is the HEART of the automation:
//   Payment confirmed → Create CJ order → Send confirmation email → Done

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const https  = require("https");

// ─────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const sig     = req.headers["stripe-signature"];
  const rawBody = req.body; // must be raw buffer — see vercel.json config

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Only act on successful payments
  if (event.type !== "payment_intent.succeeded") {
    return res.status(200).json({ received: true });
  }

  const paymentIntent = event.data.object;
  const { cartItems: cartItemsRaw, customerEmail } = paymentIntent.metadata;

  let cartItems;
  try {
    cartItems = JSON.parse(cartItemsRaw);
  } catch {
    console.error("Failed to parse cart items");
    return res.status(200).json({ received: true });
  }

  console.log(`✅ Payment confirmed: ${paymentIntent.id}`);
  console.log(`📦 Processing ${cartItems.length} items for ${customerEmail}`);

  try {
    // ── STEP 1: Get CJ access token ──
    const cjToken = await getCJToken();
    console.log("🔑 CJ token obtained");

    // ── STEP 2: Create order on CJDropshipping ──
    const customer = paymentIntent.shipping || {};
    const cjOrder  = await createCJOrder(cjToken, cartItems, customer, customerEmail);
    console.log(`📬 CJ Order created: ${cjOrder.orderId}`);

    // ── STEP 3: Generate confirmation email with Claude AI ──
    const emailBody = await generateEmailWithClaude({
      customerName: customer.name || customerEmail,
      items: cartItems,
      orderId: cjOrder.orderId || paymentIntent.id,
      total: (paymentIntent.amount / 100).toFixed(2),
    });

    // ── STEP 4: Send email via Resend (free email API) ──
    await sendEmail({
      to: customerEmail,
      subject: `Your VOLTZ order is confirmed! 🎉`,
      html: emailBody,
    });
    console.log(`📧 Confirmation email sent to ${customerEmail}`);

  } catch (err) {
    // Log error but still return 200 so Stripe doesn't retry endlessly
    console.error("Automation error:", err.message);
  }

  return res.status(200).json({ received: true });
};

// ─────────────────────────────────────────
// CJ DROPSHIPPING: GET TOKEN
// ─────────────────────────────────────────
async function getCJToken() {
  const data = JSON.stringify({
    email:    process.env.CJ_EMAIL,
    password: process.env.CJ_API_KEY,
  });

  const result = await httpPost(
    "developers.cjdropshipping.com",
    "/api2.0/v1/authentication/getAccessToken",
    data
  );

  if (!result.result) {
    throw new Error("CJ auth failed: " + result.message);
  }
  return result.data.accessToken;
}

// ─────────────────────────────────────────
// CJ DROPSHIPPING: CREATE ORDER
// ─────────────────────────────────────────
async function createCJOrder(token, cartItems, customer, email) {
  const addr    = customer.address || {};
  const orderNo = "VOLTZ-" + Date.now();

  const products = cartItems.map((item) => ({
    vid:          item.variantId || item.spu,  // CJ variant ID
    quantity:     item.qty || 1,
    shippingName: "CJPacket Ordinary",
  }));

  const body = JSON.stringify({
    orderNumber:          orderNo,
    shippingCountry:      addr.country  || "US",
    shippingProvince:     addr.state    || "",
    shippingCity:         addr.city     || "",
    shippingAddress:      addr.line1    || "",
    shippingZip:          addr.postal_code || "",
    shippingCustomerName: customer.name  || email,
    shippingPhone:        customer.phone || "0000000000",
    remark:               `VOLTZ order ${orderNo}`,
    products,
  });

  const result = await httpPost(
    "developers.cjdropshipping.com",
    "/api2.0/v1/shopping/order/createOrder",
    body,
    { "CJ-Access-Token": token }
  );

  if (!result.result) {
    throw new Error("CJ order failed: " + result.message);
  }
  return result.data;
}

// ─────────────────────────────────────────
// CLAUDE AI: GENERATE EMAIL
// ─────────────────────────────────────────
async function generateEmailWithClaude({ customerName, items, orderId, total }) {
  const itemList = items
    .map((i) => `• ${i.name} × ${i.qty} — $${(i.price * i.qty).toFixed(2)}`)
    .join("\n");

  const prompt = `You are the customer service AI for VOLTZ, a premium electronics store.
Write a professional and warm HTML order confirmation email for:
- Customer: ${customerName}
- Order ID: ${orderId}
- Items ordered:\n${itemList}
- Total charged: $${total}
- Estimated delivery: 15–25 business days (shipped via CJPacket)

Requirements:
- Write in English
- Friendly but professional tone
- Include the order ID prominently
- Mention the delivery timeframe
- Include a note that they'll receive tracking info once dispatched
- Use simple HTML with inline styles (dark background #0a0f1e, blue accent #2563C4, white text)
- Do NOT include subject line, just the HTML body content`;

  const body = JSON.stringify({
    model:      "claude-sonnet-4-20250514",
    max_tokens: 800,
    messages:   [{ role: "user", content: prompt }],
  });

  const result = await httpPost(
    "api.anthropic.com",
    "/v1/messages",
    body,
    { "anthropic-version": "2023-06-01" }
  );

  return result.content?.[0]?.text || fallbackEmail(customerName, orderId, total);
}

// Fallback if Claude is unavailable
function fallbackEmail(name, orderId, total) {
  return `
  <div style="background:#0a0f1e;color:#f0f2f7;font-family:Arial,sans-serif;padding:40px;max-width:600px;margin:0 auto;border-radius:12px">
    <div style="text-align:center;margin-bottom:32px">
      <span style="background:#2563C4;color:#fff;font-size:22px;font-weight:bold;padding:10px 24px;border-radius:8px">VOLTZ</span>
    </div>
    <h2 style="color:#fff;text-align:center">Order Confirmed! ✅</h2>
    <p style="color:#d1d8e8">Hi ${name},</p>
    <p style="color:#d1d8e8">Thank you for your order. We've received your payment and your items are being prepared for shipment.</p>
    <div style="background:#111b30;border:1px solid #1c2d4a;border-radius:8px;padding:20px;margin:24px 0;text-align:center">
      <div style="color:#8a96b0;font-size:12px;margin-bottom:4px">ORDER ID</div>
      <div style="color:#fff;font-size:22px;font-weight:bold;letter-spacing:2px">${orderId}</div>
      <div style="color:#8a96b0;font-size:12px;margin-top:8px">Total: $${total}</div>
    </div>
    <p style="color:#d1d8e8">Estimated delivery: <strong style="color:#fff">15–25 business days</strong>. You'll receive a tracking number as soon as your order ships.</p>
    <p style="color:#8a96b0;font-size:13px">Questions? Reply to this email anytime.</p>
    <p style="color:#d1d8e8">— The VOLTZ Team</p>
  </div>`;
}

// ─────────────────────────────────────────
// RESEND: SEND EMAIL
// ─────────────────────────────────────────
async function sendEmail({ to, subject, html }) {
  const body = JSON.stringify({
    from:    "VOLTZ Store <orders@yourdomain.com>",  // ← change to your domain
    to:      [to],
    subject,
    html,
  });

  const result = await httpPost(
    "api.resend.com",
    "/emails",
    body,
    { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
  );

  if (result.error) {
    throw new Error("Email send failed: " + result.error.message);
  }
  return result;
}

// ─────────────────────────────────────────
// HELPER: HTTPS POST
// ─────────────────────────────────────────
function httpPost(hostname, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...extraHeaders,
      },
    };

    const reqHttp = https.request(options, (resHttp) => {
      let data = "";
      resHttp.on("data", (chunk) => (data += chunk));
      resHttp.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });

    reqHttp.on("error", reject);
    reqHttp.write(body);
    reqHttp.end();
  });
}
