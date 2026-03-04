/**
 * MarginEdge REST API client
 *
 * Handles product catalog sync and invoice import from MarginEdge.
 * One-way data flow: MarginEdge → GWI POS (ingredient costs, invoices).
 *
 * Timeout: 15s per request. API key auth via Bearer token.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MEProduct {
  id: string
  name: string
  description?: string
  category?: string
  unit?: string
  vendorId?: string
  vendorName?: string
  sku?: string
}

export interface MEVendor {
  id: string
  name: string
  accountNumber?: string
  contactEmail?: string
  phone?: string
}

export interface MEInvoiceLine {
  id: string
  productId?: string
  productName: string
  description?: string
  quantity: number
  unit: string
  unitCost: number
  totalCost: number
  category?: string
}

export interface MEInvoice {
  id: string
  invoiceDate: string       // ISO date
  deliveryDate?: string
  vendorId?: string
  vendorName?: string
  invoiceNumber?: string
  totalAmount?: number
  status?: string
  lineItems?: MEInvoiceLine[]
}

export interface MECategory {
  id: string
  name: string
  parentId?: string
  type?: string
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class MarginEdgeClient {
  private apiKey: string
  private baseUrl = 'https://api.marginedge.com/public/v1'
  private restaurantId?: string

  constructor(apiKey: string, restaurantId?: string) {
    this.apiKey = apiKey
    this.restaurantId = restaurantId
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxAttempts = 3
  ): Promise<Response> {
    let lastError: Error = new Error('Max retries exceeded')
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)
      try {
        const res = await fetch(url, { ...options, signal: controller.signal })
        clearTimeout(timeout)
        if (res.status === 401) throw new Error('INVALID_API_KEY')
        if (res.status === 429) {
          const retryAfterRaw = res.headers.get('Retry-After')
          const waitMs = Math.min((retryAfterRaw ? parseInt(retryAfterRaw, 10) : 10) * 1000, 60_000)
          if (attempt < maxAttempts) await new Promise(r => setTimeout(r, waitMs))
          lastError = new Error('RATE_LIMITED')
          continue
        }
        if (res.status >= 500) {
          if (attempt < maxAttempts) {
            const backoff = Math.pow(2, attempt - 1) * 1000 + Math.random() * 500
            await new Promise(r => setTimeout(r, backoff))
          }
          lastError = new Error(`ME_API_ERROR:${res.status}`)
          continue
        }
        if (!res.ok) throw new Error(`ME_API_ERROR:${res.status}`)
        return res
      } catch (err) {
        clearTimeout(timeout)
        if (err instanceof Error) {
          if (err.message === 'INVALID_API_KEY') throw err
          const code = parseInt(err.message.replace('ME_API_ERROR:', ''), 10)
          if (code >= 400 && code < 500) throw err
        }
        lastError = err instanceof Error ? err : new Error('Network error')
        if (attempt < maxAttempts) {
          const backoff = Math.pow(2, attempt - 1) * 1000 + Math.random() * 500
          await new Promise(r => setTimeout(r, backoff))
        }
      }
    }
    throw lastError
  }

  private async request<T>(
    path: string,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    if (this.restaurantId) url.searchParams.set('restaurantId', this.restaurantId)
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

    const res = await this.fetchWithRetry(url.toString(), {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
      },
    })

    return res.json() as Promise<T>
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.request('/categories')
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error: msg }
    }
  }

  async getProducts(page = 1): Promise<MEProduct[]> {
    return this.request<MEProduct[]>('/products', { page: String(page) })
  }

  async getAllProducts(): Promise<MEProduct[]> {
    const all: MEProduct[] = []
    for (let page = 1; page <= 20; page++) {
      const batch = await this.getProducts(page)
      if (!batch || !batch.length) break
      all.push(...batch)
    }
    return all
  }

  async getVendors(): Promise<MEVendor[]> {
    return this.request<MEVendor[]>('/vendors')
  }

  async getCategories(): Promise<MECategory[]> {
    return this.request<MECategory[]>('/categories')
  }

  async getInvoices(fromDate?: string, toDate?: string): Promise<MEInvoice[]> {
    const params: Record<string, string> = {}
    if (fromDate) params.fromDate = fromDate
    if (toDate) params.toDate = toDate
    return this.request<MEInvoice[]>('/invoices', params)
  }

  async getInvoice(invoiceId: string): Promise<MEInvoice> {
    return this.request<MEInvoice>(`/invoices/${encodeURIComponent(invoiceId)}`)
  }
}
