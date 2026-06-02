// api/create-payment.js
// Vercel Serverless Function
// Called when customer clicks "Place Order" on checkout page
// Creates a Stripe PaymentIntent and returns the client_secret to the frontend

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // Allow CORS from your own domain
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { amount, currency = "usd", customerEmail, cartItems } = req.body;

    if (!amount || amount < 50) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Create PaymentIntent on Stripe
    // amount must be in cents (e.g. $19.99 = 1999)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency,
      receipt_email: customerEmail,
      metadata: {
        // Store cart as JSON so we can read it in the webhook
        cartItems: JSON.stringify(cartItems),
        customerEmail,
      },
    });

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });

  } catch (err) {
    console.error("Stripe error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
