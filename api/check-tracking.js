// api/check-tracking.js
// Vercel Serverless Function
// Can be called manually or via a cron job (Vercel Cron — paid plan)
// Checks CJ for tracking updates and emails customers automatically

const https = require("https");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Simple auth — protect this endpoint
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { orderId, customerEmail, customerName, cjOrderId } = req.body || req.query;

    if (!cjOrderId) {
      return res.status(400).json({ error: "cjOrderId required" });
    }

    // ── Get CJ Token ──
    const token = await getCJToken();

    // ── Fetch order details from CJ ──
    const orderDetail = await getCJOrderDetail(token, cjOrderId);

    if (!orderDetail) {
      return res.status(404).json({ error: "Order not found on CJ" });
    }

    const tracking = {
      status:         orderDetail.orderStatus,
      trackingNumber: orderDetail.trackNumber || null,
      trackingUrl:    orderDetail.trackNumber
        ? `https://t.17track.net/en#nums=${orderDetail.trackNumber}`
        : null,
      carrier:        orderDetail.logisticsName || "CJPacket",
    };

    // ── If shipped and has tracking, email the customer ──
    if (tracking.trackingNumber && customerEmail) {
      await sendTrackingEmail({
        to:           customerEmail,
        customerName: customerName || customerEmail,
        orderId,
        tracking,
      });

      console.log(`📧 Tracking email sent to ${customerEmail}: ${tracking.trackingNumber}`);
    }

    return res.status(200).json({
      success: true,
      tracking,
    });

  } catch (err) {
    console.error("Tracking check error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────
// CJ: GET TOKEN
// ─────────────────────────────────────────
async function getCJToken() {
  const result = await httpPost(
    "developers.cjdropshipping.com",
    "/api2.0/v1/authentication/getAccessToken",
    JSON.stringify({
      email:    process.env.CJ_EMAIL,
      password: process.env.CJ_API_KEY,
    })
  );
  if (!result.result) throw new Error("CJ auth failed: " + result.message);
  return result.data.accessToken;
}

// ─────────────────────────────────────────
// CJ: GET ORDER DETAIL
// ─────────────────────────────────────────
async function getCJOrderDetail(token, cjOrderId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "developers.cjdropshipping.com",
      path:     `/api2.0/v1/shopping/order/getOrderDetail?orderId=${cjOrderId}`,
      method:   "GET",
      headers:  { "CJ-Access-Token": token },
    };

    const req = https.request(options, (r) => {
      let data = "";
      r.on("data", (c) => (data += c));
      r.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.result ? json.data : null);
        } catch { resolve(null); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ─────────────────────────────────────────
// SEND TRACKING EMAIL via Resend
// ─────────────────────────────────────────
async function sendTrackingEmail({ to, customerName, orderId, tracking }) {
  const html = `
  <div style="background:#0a0f1e;color:#f0f2f7;font-family:Arial,sans-serif;padding:40px;max-width:600px;margin:0 auto;border-radius:12px">
    <div style="text-align:center;margin-bottom:32px">
      <span style="background:#2563C4;color:#fff;font-size:22px;font-weight:bold;padding:10px 24px;border-radius:8px">VOLTZ</span>
    </div>
    <h2 style="color:#fff;text-align:center">Your order is on the way! 🚚</h2>
    <p style="color:#d1d8e8">Hi ${customerName},</p>
    <p style="color:#d1d8e8">Great news — your VOLTZ order has been dispatched and is heading your way.</p>

    <div style="background:#111b30;border:1px solid #1c2d4a;border-radius:8px;padding:20px;margin:24px 0">
      <div style="display:flex;justify-content:space-between;margin-bottom:12px">
        <span style="color:#8a96b0;font-size:13px">Order ID</span>
        <span style="color:#fff;font-weight:bold">${orderId}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:12px">
        <span style="color:#8a96b0;font-size:13px">Carrier</span>
        <span style="color:#fff">${tracking.carrier}</span>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span style="color:#8a96b0;font-size:13px">Tracking Number</span>
        <span style="color:#3b82f6;font-weight:bold;font-size:16px;letter-spacing:1px">${tracking.trackingNumber}</span>
      </div>
    </div>

    <div style="text-align:center;margin:28px 0">
      <a href="${tracking.trackingUrl}" 
         style="background:#2563C4;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">
        Track My Package →
      </a>
    </div>

    <p style="color:#d1d8e8">Estimated delivery: <strong style="color:#fff">15–25 business days</strong> from today.</p>
    <p style="color:#8a96b0;font-size:13px">Tracking may take 24–48h to show updates after this email.</p>
    <p style="color:#d1d8e8">— The VOLTZ Team</p>
  </div>`;

  await httpPost(
    "api.resend.com",
    "/emails",
    JSON.stringify({
      from:    "VOLTZ Store <orders@yourdomain.com>",
      to:      [to],
      subject: `Your VOLTZ order is on the way! 🚚 Track: ${tracking.trackingNumber}`,
      html,
    }),
    { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
  );
}

// ─────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────
function httpPost(hostname, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname, path, method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...extraHeaders,
      },
    };
    const req = https.request(options, (r) => {
      let data = "";
      r.on("data", (c) => (data += c));
      r.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
