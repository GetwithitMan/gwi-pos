/**
 * Unit tests for the mobile link-customer socket handler.
 *
 * The handler is a transport shim around PUT /api/orders/{id}/customer —
 * we mock the HTTP layer with a fake fetch and assert on the
 * outbound payload + the normalized result the socket-server emits back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processLinkCustomerRequest } from '../link-customer'

const ORDER_ID = 'order_abc'
const EMPLOYEE_ID = 'emp_123'
const CUSTOMER_ID = 'cust_xyz'
const LOCATION_ID = 'loc_1'

function makeFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  return vi.fn(impl) as unknown as typeof fetch
}

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('processLinkCustomerRequest', () => {
  it('forwards a link request to PUT /api/orders/{id}/customer with the right body', async () => {
    const seen: { url: string; body: any } = { url: '', body: null }
    const httpFetch = makeFetch(async (url, init) => {
      seen.url = url as string
      seen.body = JSON.parse(String(init.body))
      return jsonResponse({
        data: {
          success: true,
          customerId: CUSTOMER_ID,
          customer: {
            id: CUSTOMER_ID,
            name: 'Jane Doe',
            firstName: 'Jane',
            lastName: 'Doe',
            loyaltyPoints: 120,
            totalSpent: 350,
            totalOrders: 4,
            tags: ['VIP'],
            isBanned: false,
          },
          loyaltyEnabled: true,
        },
      })
    })

    const result = await processLinkCustomerRequest(
      { orderId: ORDER_ID, customerId: CUSTOMER_ID, employeeId: EMPLOYEE_ID },
      LOCATION_ID,
      { httpFetch, loopbackOrigin: 'http://test.local' },
    )

    expect(seen.url).toBe(`http://test.local/api/orders/${ORDER_ID}/customer`)
    expect(seen.body).toEqual({ customerId: CUSTOMER_ID, employeeId: EMPLOYEE_ID })
    expect(result.broadcast).toBe(true)
    expect(result.payload.success).toBe(true)
    expect(result.payload.customerId).toBe(CUSTOMER_ID)
    expect(result.payload.customer?.name).toBe('Jane Doe')
    expect(result.payload.loyaltyEnabled).toBe(true)
  })

  it('forwards an unlink request (customerId: null) and returns success', async () => {
    const seen: { body: any } = { body: null }
    const httpFetch = makeFetch(async (_url, init) => {
      seen.body = JSON.parse(String(init.body))
      return jsonResponse({
        data: { success: true, customerId: null, customer: null, loyaltyEnabled: true },
      })
    })

    const result = await processLinkCustomerRequest(
      { orderId: ORDER_ID, customerId: null, employeeId: EMPLOYEE_ID },
      LOCATION_ID,
      { httpFetch, loopbackOrigin: 'http://test.local' },
    )

    expect(seen.body).toEqual({ customerId: null, employeeId: EMPLOYEE_ID })
    expect(result.payload.success).toBe(true)
    expect(result.payload.customerId).toBeNull()
    expect(result.payload.customer).toBeNull()
  })

  it('returns a failure payload (with broadcast=false) when locationId is missing', async () => {
    const httpFetch = makeFetch(async () => jsonResponse({}))
    const result = await processLinkCustomerRequest(
      { orderId: ORDER_ID, customerId: CUSTOMER_ID, employeeId: EMPLOYEE_ID },
      undefined,
      { httpFetch, loopbackOrigin: 'http://test.local' },
    )
    expect(result.payload.success).toBe(false)
    expect(result.payload.error).toMatch(/Not authenticated/i)
    expect(result.broadcast).toBe(false)
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it('rejects requests missing orderId without calling the route', async () => {
    const httpFetch = makeFetch(async () => jsonResponse({}))
    const result = await processLinkCustomerRequest(
      { customerId: CUSTOMER_ID, employeeId: EMPLOYEE_ID },
      LOCATION_ID,
      { httpFetch, loopbackOrigin: 'http://test.local' },
    )
    expect(result.payload.success).toBe(false)
    expect(result.payload.error).toMatch(/orderId/i)
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it('rejects requests missing employeeId without calling the route', async () => {
    const httpFetch = makeFetch(async () => jsonResponse({}))
    const result = await processLinkCustomerRequest(
      { orderId: ORDER_ID, customerId: CUSTOMER_ID },
      LOCATION_ID,
      { httpFetch, loopbackOrigin: 'http://test.local' },
    )
    expect(result.payload.success).toBe(false)
    expect(result.payload.error).toMatch(/employeeId/i)
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it('rejects an empty-string customerId (treats null as the only valid unlink form)', async () => {
    const httpFetch = makeFetch(async () => jsonResponse({}))
    const result = await processLinkCustomerRequest(
      { orderId: ORDER_ID, customerId: '', employeeId: EMPLOYEE_ID },
      LOCATION_ID,
      { httpFetch, loopbackOrigin: 'http://test.local' },
    )
    expect(result.payload.success).toBe(false)
    expect(result.payload.error).toMatch(/customerId/i)
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it('surfaces server-side error messages back through the socket payload', async () => {
    const httpFetch = makeFetch(async () =>
      jsonResponse({ error: 'Customer does not belong to this location' }, { status: 400 }),
    )
    const result = await processLinkCustomerRequest(
      { orderId: ORDER_ID, customerId: CUSTOMER_ID, employeeId: EMPLOYEE_ID },
      LOCATION_ID,
      { httpFetch, loopbackOrigin: 'http://test.local' },
    )
    expect(result.payload.success).toBe(false)
    expect(result.payload.error).toMatch(/does not belong/i)
    // We DO want to broadcast failures so other surfaces don't keep stale state.
    expect(result.broadcast).toBe(true)
  })

  it('treats a network/loopback failure as a transient failure with a generic message', async () => {
    const httpFetch = makeFetch(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    const result = await processLinkCustomerRequest(
      { orderId: ORDER_ID, customerId: CUSTOMER_ID, employeeId: EMPLOYEE_ID },
      LOCATION_ID,
      { httpFetch, loopbackOrigin: 'http://test.local' },
    )
    expect(result.payload.success).toBe(false)
    expect(result.payload.error).toMatch(/Failed to link customer/i)
    expect(result.broadcast).toBe(true)
  })
})
