import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSendEmail = vi.hoisted(() => vi.fn())

vi.mock('@/lib/email-service', () => ({
  sendEmail: mockSendEmail,
}))
vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
import { sendGiftCardEmail } from '@/lib/gift-card-email'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendGiftCardEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendEmail.mockResolvedValue({ success: true })
  })

  it('calls sendEmail with correct parameters', async () => {
    await sendGiftCardEmail({
      recipientEmail: 'jane@example.com',
      recipientName: 'Jane',
      cardCode: 'GC-1234-5678',
      balance: 50,
      locationName: 'Test Restaurant',
    })

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@example.com',
        subject: expect.stringContaining('Test Restaurant'),
        html: expect.any(String),
      })
    )
  })

  it('HTML contains card code and balance', async () => {
    await sendGiftCardEmail({
      recipientEmail: 'jane@example.com',
      cardCode: 'GC-ABCD-EFGH',
      balance: 75.50,
      locationName: 'Fancy Bistro',
    })

    const html = mockSendEmail.mock.calls[0][0].html as string
    expect(html).toContain('GC-ABCD-EFGH')
    expect(html).toContain('$75.50')
  })

  it('HTML escapes user-provided text (XSS prevention)', async () => {
    await sendGiftCardEmail({
      recipientEmail: 'jane@example.com',
      recipientName: '<script>alert("xss")</script>',
      cardCode: 'GC-SAFE-TEST',
      balance: 25,
      fromName: '<img onerror=alert(1) src=x>',
      message: 'Enjoy your <b>gift</b> & "card"!',
      locationName: 'Joe\'s Bar & Grill',
    })

    const html = mockSendEmail.mock.calls[0][0].html as string

    // Should NOT contain raw HTML injection vectors
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img onerror')

    // Should contain escaped versions
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img onerror')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
    expect(html).toContain('&#039;')
  })

  it('handles missing optional fields (no recipientName, no message)', async () => {
    await sendGiftCardEmail({
      recipientEmail: 'anonymous@example.com',
      cardCode: 'GC-ANON-1234',
      balance: 100,
      locationName: 'The Pub',
    })

    const html = mockSendEmail.mock.calls[0][0].html as string

    // Should have a generic greeting
    expect(html).toContain('Hi there,')
    // Should have the card code
    expect(html).toContain('GC-ANON-1234')
    // Should have the balance
    expect(html).toContain('$100.00')
  })

  it('includes fromName and message when provided', async () => {
    await sendGiftCardEmail({
      recipientEmail: 'jane@example.com',
      recipientName: 'Jane',
      cardCode: 'GC-FROM-TEST',
      balance: 50,
      fromName: 'Bob',
      message: 'Happy Birthday!',
      locationName: 'Cafe',
    })

    const html = mockSendEmail.mock.calls[0][0].html as string

    expect(html).toContain('Hi Jane,')
    expect(html).toContain('Bob')
    expect(html).toContain('Happy Birthday!')
  })

  it('includes location address when provided', async () => {
    await sendGiftCardEmail({
      recipientEmail: 'jane@example.com',
      cardCode: 'GC-ADDR-TEST',
      balance: 50,
      locationName: 'Downtown Grill',
      locationAddress: '123 Main St, City, ST 12345',
    })

    const html = mockSendEmail.mock.calls[0][0].html as string
    expect(html).toContain('123 Main St, City, ST 12345')
  })
})
