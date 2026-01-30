import PDFDocument from 'pdfkit'

export interface PayStubData {
  // Company info
  companyName: string
  companyAddress?: string
  companyPhone?: string

  // Employee info
  employeeName: string
  employeeAddress?: string
  employeeId: string
  paymentMethod: string
  last4BankAccount?: string

  // Pay period info
  payPeriodStart: string
  payPeriodEnd: string
  payDate: string
  checkNumber?: string

  // Earnings
  earnings: {
    description: string
    hours: number
    rate: number
    amount: number
  }[]

  // Other income
  tips: number
  commission: number
  bankedTips: number

  // Deductions (taxes)
  deductions: {
    description: string
    amount: number
  }[]

  // Totals
  grossPay: number
  totalDeductions: number
  netPay: number

  // YTD
  ytdGross: number
  ytdTaxes: number
  ytdNet: number
}

export function generatePayStubPDF(data: PayStubData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margin: 50,
        info: {
          Title: `Pay Stub - ${data.employeeName}`,
          Author: data.companyName,
        }
      })

      const chunks: Buffer[] = []
      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const pageWidth = doc.page.width - 100 // margins
      const leftCol = 50
      const rightCol = 350

      // Header with company name
      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .text(data.companyName, leftCol, 50, { align: 'center', width: pageWidth })

      if (data.companyAddress) {
        doc
          .fontSize(10)
          .font('Helvetica')
          .text(data.companyAddress, leftCol, 75, { align: 'center', width: pageWidth })
      }

      // Pay Stub Title
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('PAY STUB', leftCol, 100, { align: 'center', width: pageWidth })

      // Divider
      doc
        .moveTo(leftCol, 120)
        .lineTo(leftCol + pageWidth, 120)
        .stroke()

      // Employee and Pay Period Info - Two columns
      let y = 135

      // Left column - Employee Info
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .text('Employee Information', leftCol, y)
      y += 18

      doc
        .fontSize(10)
        .font('Helvetica')
        .text(`Name: ${data.employeeName}`, leftCol, y)
      y += 14
      doc.text(`Employee ID: ${data.employeeId}`, leftCol, y)
      y += 14

      if (data.employeeAddress) {
        doc.text(`Address: ${data.employeeAddress}`, leftCol, y)
        y += 14
      }

      // Right column - Pay Period Info
      let rightY = 135
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .text('Pay Period Information', rightCol, rightY)
      rightY += 18

      doc
        .fontSize(10)
        .font('Helvetica')
        .text(`Pay Period: ${formatDate(data.payPeriodStart)} - ${formatDate(data.payPeriodEnd)}`, rightCol, rightY)
      rightY += 14
      doc.text(`Pay Date: ${formatDate(data.payDate)}`, rightCol, rightY)
      rightY += 14
      doc.text(`Payment Method: ${data.paymentMethod}`, rightCol, rightY)
      rightY += 14

      if (data.checkNumber) {
        doc.text(`Check #: ${data.checkNumber}`, rightCol, rightY)
        rightY += 14
      }

      if (data.last4BankAccount) {
        doc.text(`Account: ****${data.last4BankAccount}`, rightCol, rightY)
        rightY += 14
      }

      // Divider
      y = Math.max(y, rightY) + 15
      doc
        .moveTo(leftCol, y)
        .lineTo(leftCol + pageWidth, y)
        .stroke()

      // EARNINGS Section
      y += 15
      doc
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('EARNINGS', leftCol, y)
      y += 20

      // Earnings table header
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Description', leftCol, y)
        .text('Hours', leftCol + 180, y, { width: 60, align: 'right' })
        .text('Rate', leftCol + 250, y, { width: 70, align: 'right' })
        .text('Amount', leftCol + 330, y, { width: 80, align: 'right' })
      y += 15

      // Earnings rows
      doc.font('Helvetica')
      for (const earning of data.earnings) {
        doc
          .fontSize(9)
          .text(earning.description, leftCol, y)
          .text(earning.hours.toFixed(2), leftCol + 180, y, { width: 60, align: 'right' })
          .text(formatCurrency(earning.rate), leftCol + 250, y, { width: 70, align: 'right' })
          .text(formatCurrency(earning.amount), leftCol + 330, y, { width: 80, align: 'right' })
        y += 14
      }

      // Tips, Commission, Banked Tips
      if (data.tips > 0) {
        doc
          .text('Tips', leftCol, y)
          .text('—', leftCol + 180, y, { width: 60, align: 'right' })
          .text('—', leftCol + 250, y, { width: 70, align: 'right' })
          .text(formatCurrency(data.tips), leftCol + 330, y, { width: 80, align: 'right' })
        y += 14
      }

      if (data.commission > 0) {
        doc
          .text('Commission', leftCol, y)
          .text('—', leftCol + 180, y, { width: 60, align: 'right' })
          .text('—', leftCol + 250, y, { width: 70, align: 'right' })
          .text(formatCurrency(data.commission), leftCol + 330, y, { width: 80, align: 'right' })
        y += 14
      }

      if (data.bankedTips > 0) {
        doc
          .text('Banked Tips', leftCol, y)
          .text('—', leftCol + 180, y, { width: 60, align: 'right' })
          .text('—', leftCol + 250, y, { width: 70, align: 'right' })
          .text(formatCurrency(data.bankedTips), leftCol + 330, y, { width: 80, align: 'right' })
        y += 14
      }

      // Gross Pay Total
      y += 5
      doc
        .moveTo(leftCol + 300, y)
        .lineTo(leftCol + 410, y)
        .stroke()
      y += 8

      doc
        .font('Helvetica-Bold')
        .text('Gross Pay:', leftCol + 230, y)
        .text(formatCurrency(data.grossPay), leftCol + 330, y, { width: 80, align: 'right' })
      y += 25

      // DEDUCTIONS Section
      doc
        .fontSize(12)
        .text('DEDUCTIONS', leftCol, y)
      y += 20

      // Deductions table header
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Description', leftCol, y)
        .text('Current', leftCol + 330, y, { width: 80, align: 'right' })
      y += 15

      // Deductions rows
      doc.font('Helvetica')
      for (const deduction of data.deductions) {
        doc
          .fontSize(9)
          .text(deduction.description, leftCol, y)
          .text(formatCurrency(deduction.amount), leftCol + 330, y, { width: 80, align: 'right' })
        y += 14
      }

      // Total Deductions
      y += 5
      doc
        .moveTo(leftCol + 300, y)
        .lineTo(leftCol + 410, y)
        .stroke()
      y += 8

      doc
        .font('Helvetica-Bold')
        .text('Total Deductions:', leftCol + 200, y)
        .text(formatCurrency(data.totalDeductions), leftCol + 330, y, { width: 80, align: 'right' })
      y += 30

      // NET PAY Box
      doc
        .rect(leftCol + 200, y, 210, 40)
        .stroke()

      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('NET PAY:', leftCol + 210, y + 12)
        .text(formatCurrency(data.netPay), leftCol + 290, y + 12, { width: 110, align: 'right' })
      y += 60

      // YTD Summary
      doc
        .fontSize(12)
        .text('YEAR-TO-DATE SUMMARY', leftCol, y)
      y += 20

      doc
        .fontSize(10)
        .font('Helvetica')
        .text('YTD Gross Earnings:', leftCol, y)
        .text(formatCurrency(data.ytdGross), leftCol + 150, y, { width: 100, align: 'right' })
      y += 14

      doc
        .text('YTD Taxes Withheld:', leftCol, y)
        .text(formatCurrency(data.ytdTaxes), leftCol + 150, y, { width: 100, align: 'right' })
      y += 14

      doc
        .font('Helvetica-Bold')
        .text('YTD Net Pay:', leftCol, y)
        .text(formatCurrency(data.ytdNet), leftCol + 150, y, { width: 100, align: 'right' })

      // Footer
      const footerY = doc.page.height - 80
      doc
        .fontSize(8)
        .font('Helvetica')
        .text('This is your pay stub. Please retain for your records.', leftCol, footerY, {
          align: 'center',
          width: pageWidth
        })
      doc.text(
        `Generated on ${new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}`,
        leftCol,
        footerY + 12,
        { align: 'center', width: pageWidth }
      )

      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
