const axios = require('axios');
const nodemailer = require('nodemailer');

// ── Email transporter ────────────────────────────────────────────────────────
const getMailer = () => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
};

// ── MSG91 SMS ────────────────────────────────────────────────────────────────
const sendSMS = async (phone, message) => {
  if (!process.env.MSG91_AUTH_KEY) return { skipped: true };
  try {
    // Normalize phone to 91XXXXXXXXXX format
    const mobile = phone.replace(/\D/g, '');
    const normalized = mobile.startsWith('91') ? mobile : `91${mobile}`;

    const res = await axios.post('https://api.msg91.com/api/v2/sendsms', {
      sender: process.env.MSG91_SENDER_ID || 'COACHG',
      route: '4',
      country: '91',
      sms: [{ message, to: [normalized] }],
    }, {
      headers: {
        authkey: process.env.MSG91_AUTH_KEY,
        'Content-Type': 'application/json',
      },
    });
    return { success: true, data: res.data };
  } catch (err) {
    console.error('SMS error:', err.message);
    return { success: false, error: err.message };
  }
};

// ── MSG91 WhatsApp ───────────────────────────────────────────────────────────
const sendWhatsApp = async (phone, templateId, params = []) => {
  if (!process.env.MSG91_AUTH_KEY || !process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER) return { skipped: true };
  try {
    const mobile = phone.replace(/\D/g, '');
    const normalized = mobile.startsWith('91') ? mobile : `91${mobile}`;

    const res = await axios.post('https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
      integrated_number: process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER,
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: templateId,
          language: { code: 'en' },
          components: params.length ? [{
            type: 'body',
            parameters: params.map(p => ({ type: 'text', text: String(p) })),
          }] : [],
        },
        to: normalized,
      },
    }, {
      headers: {
        authkey: process.env.MSG91_AUTH_KEY,
        'Content-Type': 'application/json',
      },
    });
    return { success: true, data: res.data };
  } catch (err) {
    console.error('WhatsApp error:', err.message);
    return { success: false, error: err.message };
  }
};

// ── Email sender ─────────────────────────────────────────────────────────────
const sendEmail = async (to, subject, html) => {
  const mailer = getMailer();
  if (!mailer || !to) return { skipped: true };
  try {
    await mailer.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      html,
    });
    return { success: true };
  } catch (err) {
    console.error('Email error:', err.message);
    return { success: false, error: err.message };
  }
};

// ── High-level notification helpers ─────────────────────────────────────────

/**
 * Notify student/parent about fee receipt
 */
const notifyFeeReceived = async ({ studentName, amount, paymentMode, receiptNo, phone, email, coachingName }) => {
  const msg = `Dear ${studentName}, your payment of Rs.${amount} (Receipt #${receiptNo}) has been received at ${coachingName}. Mode: ${paymentMode}. Thank you!`;
  const results = await Promise.allSettled([
    phone ? sendSMS(phone, msg) : Promise.resolve({ skipped: true }),
    phone && process.env.MSG91_WHATSAPP_TEMPLATE_FEE
      ? sendWhatsApp(phone, process.env.MSG91_WHATSAPP_TEMPLATE_FEE, [studentName, String(amount), receiptNo, coachingName])
      : Promise.resolve({ skipped: true }),
    email ? sendEmail(email, `Fee Receipt #${receiptNo} - ${coachingName}`, `<p>${msg}</p>`) : Promise.resolve({ skipped: true }),
  ]);
  return results;
};

/**
 * Notify parent about low attendance
 */
const notifyLowAttendance = async ({ studentName, percentage, batchName, phone, email, coachingName }) => {
  const msg = `Dear Parent, ${studentName}'s attendance in ${batchName} is ${percentage}% which is below the required threshold at ${coachingName}. Please ensure regular attendance.`;
  const results = await Promise.allSettled([
    phone ? sendSMS(phone, msg) : Promise.resolve({ skipped: true }),
    phone && process.env.MSG91_WHATSAPP_TEMPLATE_ATTENDANCE
      ? sendWhatsApp(phone, process.env.MSG91_WHATSAPP_TEMPLATE_ATTENDANCE, [studentName, String(percentage), batchName, coachingName])
      : Promise.resolve({ skipped: true }),
    email ? sendEmail(email, `Attendance Alert - ${studentName} - ${coachingName}`, `<p>${msg}</p>`) : Promise.resolve({ skipped: true }),
  ]);
  return results;
};

/**
 * Bulk notify all students in a batch about a notice
 */
const notifyNotice = async ({ title, content, recipients, coachingName }) => {
  const msg = `${coachingName}: ${title} - ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`;
  const promises = recipients.map(r =>
    r.phone ? sendSMS(r.phone, msg) : Promise.resolve({ skipped: true })
  );
  return Promise.allSettled(promises);
};

/**
 * Notify student about upcoming exam
 */
const notifyExam = async ({ studentName, examTitle, examDate, batchName, phone, email, coachingName }) => {
  const msg = `Reminder: ${examTitle} is scheduled on ${examDate} for ${batchName} at ${coachingName}. All the best, ${studentName}!`;
  return Promise.allSettled([
    phone ? sendSMS(phone, msg) : Promise.resolve({ skipped: true }),
    email ? sendEmail(email, `Exam Reminder: ${examTitle} - ${coachingName}`, `<p>${msg}</p>`) : Promise.resolve({ skipped: true }),
  ]);
};

module.exports = {
  sendSMS, sendWhatsApp, sendEmail,
  notifyFeeReceived, notifyLowAttendance, notifyNotice, notifyExam,
};
