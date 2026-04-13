const crypto = require('crypto');

let razorpay = null;

const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  if (!razorpay) {
    const Razorpay = require('razorpay');
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpay;
};

/**
 * Create a Razorpay order
 * amount is in rupees (will be converted to paise)
 */
const createOrder = async ({ amount, currency = 'INR', receipt, notes = {} }) => {
  const rz = getRazorpay();
  if (!rz) throw new Error('Razorpay not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env');

  const order = await rz.orders.create({
    amount: Math.round(parseFloat(amount) * 100), // paise
    currency,
    receipt: receipt || `rcpt_${Date.now()}`,
    notes,
  });
  return order;
};

/**
 * Verify Razorpay payment signature
 * Returns true if valid
 */
const verifyPayment = (orderId, paymentId, signature) => {
  if (!process.env.RAZORPAY_KEY_SECRET) throw new Error('Razorpay not configured');
  const body = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');
  return expected === signature;
};

module.exports = { createOrder, verifyPayment };
