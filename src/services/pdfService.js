const PDFDocument = require('pdfkit');

/**
 * Generate a fee receipt PDF and return it as a Buffer
 */
const generateFeeReceipt = (data) => {
  return new Promise((resolve, reject) => {
    const {
      receiptNo, coachingName, coachingAddress, coachingPhone, coachingEmail, logoPath,
      studentName, enrollmentNo, fatherName, phone, batchName,
      amount, discount, finalAmount, paymentMode, paymentDate,
      feeType, monthYear, transactionRef, receivedBy, currencySymbol = '₹',
    } = data;

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 595 - 100; // usable width
    const blue = '#1a56db';
    const gray = '#6b7280';
    const light = '#f3f4f6';

    // ── Header ─────────────────────────────────────────────────────────────
    doc.rect(50, 40, W, 80).fill(blue);
    doc.fillColor('white').fontSize(20).font('Helvetica-Bold').text(coachingName || 'Coaching Center', 70, 60, { width: W - 20 });
    if (coachingAddress) doc.fillColor('#d1d5ff').fontSize(9).font('Helvetica').text(coachingAddress, 70, 84, { width: W - 20 });
    const contactLine = [coachingPhone, coachingEmail].filter(Boolean).join('  |  ');
    if (contactLine) doc.fillColor('#d1d5ff').fontSize(9).text(contactLine, 70, 96, { width: W - 20 });

    // ── Receipt title strip ─────────────────────────────────────────────────
    doc.rect(50, 130, W, 30).fill(light);
    doc.fillColor('#111827').fontSize(13).font('Helvetica-Bold').text('FEE RECEIPT', 70, 139);
    doc.fillColor(blue).fontSize(11).text(`Receipt #: ${receiptNo}`, 70, 139, { align: 'right', width: W - 40 });

    // ── Date & Payment mode pills ────────────────────────────────────────────
    doc.fillColor(gray).fontSize(9).font('Helvetica');
    doc.text(`Date: ${new Date(paymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 70, 170);
    doc.text(`Mode: ${paymentMode?.toUpperCase() || 'CASH'}`, 300, 170);
    if (transactionRef) doc.text(`Ref: ${transactionRef}`, 400, 170);

    // ── Student info box ────────────────────────────────────────────────────
    const studentBox = { x: 50, y: 190, w: W, h: 100 };
    doc.rect(studentBox.x, studentBox.y, studentBox.w, studentBox.h).lineWidth(0.5).strokeColor('#e5e7eb').stroke();

    doc.fillColor(blue).fontSize(9).font('Helvetica-Bold').text('STUDENT DETAILS', 65, 200);
    doc.moveTo(65, 211).lineTo(175, 211).lineWidth(1).strokeColor(blue).stroke();

    const leftCol = (label, value, y) => {
      doc.fillColor(gray).fontSize(9).font('Helvetica').text(label, 65, y);
      doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold').text(value || '-', 160, y);
    };
    const rightCol = (label, value, y) => {
      doc.fillColor(gray).fontSize(9).font('Helvetica').text(label, 320, y);
      doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold').text(value || '-', 415, y);
    };

    leftCol('Student Name:', studentName, 222);
    leftCol('Enrollment No:', enrollmentNo, 237);
    leftCol('Father Name:', fatherName, 252);
    leftCol('Phone:', phone, 267);
    rightCol('Batch:', batchName, 222);
    rightCol('Fee Type:', feeType ? feeType.charAt(0).toUpperCase() + feeType.slice(1) : 'Tuition', 237);
    if (monthYear) rightCol('Month/Year:', monthYear, 252);

    // ── Amount table ─────────────────────────────────────────────────────────
    const tY = 305;
    doc.rect(50, tY, W, 24).fill(blue);
    doc.fillColor('white').fontSize(10).font('Helvetica-Bold');
    doc.text('Description', 65, tY + 8);
    doc.text('Amount', 370, tY + 8, { width: 120, align: 'right' });

    const row = (label, value, y, bg) => {
      if (bg) doc.rect(50, y, W, 22).fill(light);
      doc.fillColor('#374151').fontSize(10).font('Helvetica').text(label, 65, y + 6);
      doc.text(`${currencySymbol} ${parseFloat(value || 0).toFixed(2)}`, 370, y + 6, { width: 120, align: 'right' });
    };

    row('Fee Amount', amount, tY + 24, false);
    if (discount && parseFloat(discount) > 0) {
      row('Discount', discount, tY + 46, true);
    }

    // Total row
    const totalY = tY + 46 + (discount && parseFloat(discount) > 0 ? 22 : 0);
    doc.rect(50, totalY, W, 26).fill('#1e3a8a');
    doc.fillColor('white').fontSize(11).font('Helvetica-Bold').text('Total Paid', 65, totalY + 7);
    doc.text(`${currencySymbol} ${parseFloat(finalAmount || amount).toFixed(2)}`, 370, totalY + 7, { width: 120, align: 'right' });

    // Amount in words
    const inWords = amountToWords(Math.round(parseFloat(finalAmount || amount)));
    doc.fillColor(gray).fontSize(9).font('Helvetica-Oblique').text(`Rupees ${inWords} Only`, 65, totalY + 36);

    // ── Received by / signature ──────────────────────────────────────────────
    const sigY = totalY + 80;
    doc.moveTo(65, sigY + 30).lineTo(200, sigY + 30).lineWidth(0.5).strokeColor('#9ca3af').stroke();
    doc.fillColor(gray).fontSize(9).font('Helvetica').text('Received By', 65, sigY + 35);
    if (receivedBy) doc.fillColor('#111827').fontSize(10).font('Helvetica-Bold').text(receivedBy, 65, sigY + 14);

    doc.moveTo(350, sigY + 30).lineTo(490, sigY + 30).lineWidth(0.5).strokeColor('#9ca3af').stroke();
    doc.fillColor(gray).fontSize(9).font('Helvetica').text('Authorised Signature', 350, sigY + 35);

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.rect(50, 760, W, 28).fill(light);
    doc.fillColor(gray).fontSize(8).font('Helvetica').text('This is a computer-generated receipt and does not require a physical signature.', 65, 771, { width: W - 30, align: 'center' });

    doc.end();
  });
};

/**
 * Generate a student report card PDF
 */
const generateReportCard = (data) => {
  return new Promise((resolve, reject) => {
    const {
      coachingName, studentName, enrollmentNo, batchName,
      academicYear, examResults, attendanceSummary, currencySymbol = '₹',
    } = data;

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 595 - 100;
    const blue = '#1a56db';
    const gray = '#6b7280';
    const light = '#f3f4f6';

    // Header
    doc.rect(50, 40, W, 70).fill(blue);
    doc.fillColor('white').fontSize(18).font('Helvetica-Bold').text(coachingName || 'Coaching Center', 70, 52, { width: W - 20 });
    doc.fillColor('#d1d5ff').fontSize(10).text(`Academic Year: ${academicYear || ''}`, 70, 78);
    doc.fillColor('white').fontSize(14).font('Helvetica-Bold').text('STUDENT REPORT CARD', 70, 78, { align: 'right', width: W - 40 });

    // Student info
    doc.rect(50, 122, W, 55).lineWidth(0.5).strokeColor('#e5e7eb').stroke();
    doc.fillColor('#111827').fontSize(11).font('Helvetica-Bold').text(studentName, 65, 132);
    doc.fillColor(gray).fontSize(9).font('Helvetica').text(`Enrollment: ${enrollmentNo || '-'}`, 65, 148);
    doc.fillColor(gray).text(`Batch: ${batchName || '-'}`, 65, 161);
    const grade = calculateOverallGrade(examResults);
    doc.fillColor(blue).fontSize(22).font('Helvetica-Bold').text(grade, 430, 135);
    doc.fillColor(gray).fontSize(9).font('Helvetica').text('Overall Grade', 418, 162);

    // Attendance summary
    let cy = 192;
    doc.fillColor(blue).fontSize(11).font('Helvetica-Bold').text('Attendance Summary', 65, cy);
    cy += 16;
    if (attendanceSummary) {
      const attItems = [
        { label: 'Total Days', value: attendanceSummary.total_days || 0 },
        { label: 'Present', value: attendanceSummary.present_days || 0 },
        { label: 'Absent', value: attendanceSummary.absent_days || 0 },
        { label: 'Percentage', value: `${attendanceSummary.attendance_pct || 0}%` },
      ];
      attItems.forEach((item, i) => {
        const bx = 50 + i * (W / 4);
        doc.rect(bx + 4, cy, W / 4 - 8, 44).fill(i % 2 === 0 ? light : 'white');
        doc.fillColor(gray).fontSize(8).font('Helvetica').text(item.label, bx + 10, cy + 8);
        doc.fillColor('#111827').fontSize(16).font('Helvetica-Bold').text(String(item.value), bx + 10, cy + 20);
      });
      cy += 58;
    }

    // Exam results table
    doc.fillColor(blue).fontSize(11).font('Helvetica-Bold').text('Exam Results', 65, cy);
    cy += 14;

    // Table header
    doc.rect(50, cy, W, 22).fill(blue);
    doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
    doc.text('Exam', 60, cy + 7);
    doc.text('Subject', 180, cy + 7);
    doc.text('Date', 300, cy + 7);
    doc.text('Marks', 370, cy + 7, { width: 50, align: 'right' });
    doc.text('Out of', 425, cy + 7, { width: 50, align: 'right' });
    doc.text('Grade', 480, cy + 7, { width: 55, align: 'center' });
    cy += 22;

    (examResults || []).forEach((r, i) => {
      if (i % 2 === 0) doc.rect(50, cy, W, 20).fill(light);
      doc.fillColor('#374151').fontSize(9).font('Helvetica');
      doc.text(r.exam_title || '-', 60, cy + 6, { width: 115 });
      doc.text(r.subject_name || '-', 180, cy + 6, { width: 115 });
      doc.text(r.exam_date ? new Date(r.exam_date).toLocaleDateString('en-IN') : '-', 300, cy + 6);
      doc.text(r.is_absent ? 'AB' : String(r.marks_obtained ?? '-'), 370, cy + 6, { width: 50, align: 'right' });
      doc.text(String(r.total_marks ?? '-'), 425, cy + 6, { width: 50, align: 'right' });
      const g = r.grade || (r.marks_obtained != null ? calcGrade(r.marks_obtained, r.total_marks) : '-');
      const gradeColor = g === 'A+' || g === 'A' ? '#16a34a' : g === 'B' || g === 'B+' ? '#2563eb' : g === 'F' ? '#dc2626' : '#374151';
      doc.fillColor(gradeColor).fontSize(9).font('Helvetica-Bold').text(g, 480, cy + 6, { width: 55, align: 'center' });
      cy += 20;
    });

    // Footer
    doc.rect(50, 762, W, 25).fill(light);
    doc.fillColor(gray).fontSize(8).font('Helvetica').text(`Generated on ${new Date().toLocaleDateString('en-IN')} | ${coachingName}`, 65, 771, { width: W - 30, align: 'center' });

    doc.end();
  });
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function calcGrade(obtained, total) {
  if (!total || total === 0) return '-';
  const pct = (obtained / total) * 100;
  if (pct >= 90) return 'A+';
  if (pct >= 75) return 'A';
  if (pct >= 60) return 'B+';
  if (pct >= 50) return 'B';
  if (pct >= 40) return 'C';
  if (pct >= 33) return 'D';
  return 'F';
}

function calculateOverallGrade(results = []) {
  if (!results.length) return '-';
  const valid = results.filter(r => !r.is_absent && r.marks_obtained != null && r.total_marks);
  if (!valid.length) return '-';
  const avg = valid.reduce((s, r) => s + (r.marks_obtained / r.total_marks) * 100, 0) / valid.length;
  return calcGrade(avg, 100);
}

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function amountToWords(n) {
  if (n === 0) return 'Zero';
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + amountToWords(n % 100) : '');
  if (n < 100000) return amountToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + amountToWords(n % 1000) : '');
  if (n < 10000000) return amountToWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + amountToWords(n % 100000) : '');
  return amountToWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + amountToWords(n % 10000000) : '');
}

module.exports = { generateFeeReceipt, generateReportCard };
