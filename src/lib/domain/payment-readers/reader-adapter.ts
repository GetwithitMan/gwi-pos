/**
 * Payment Reader Adapter — Hardware abstraction for card readers.
 *
 * Datacap implementation now; SoftPOS / other providers later.
 * Routes through existing DatacapClient.collectCardData() + EMVPadReset.
 */

import { getDatacapClient } from '@/lib/datacap/helpers'
import { detectWalletType } from '@/lib/datacap/client'
import type { DatacapResponse } from '@/lib/datacap/types'

// ─── Interface ──────────────────────────────────────────────────────────────

export interface CardReadResult {
  success: boolean
  recordNo: string | null
  cardType: string | null
  cardLast4: string | null
  cardholderName: string | null
  entryMethod: string | null
  walletType: string | null
  error?: string
}

export interface PaymentReaderAdapter {
  collectCardData(readerId: string, params: { placeholderAmount?: number }): Promise<CardReadResult>
  padReset(readerId: string): Promise<void>
}

// ─── Datacap Implementation ─────────────────────────────────────────────────

export class DatacapReaderAdapter implements PaymentReaderAdapter {
  private locationId: string

  constructor(locationId: string) {
    this.locationId = locationId
  }

  async collectCardData(
    readerId: string,
    params: { placeholderAmount?: number },
  ): Promise<CardReadResult> {
    const client = await getDatacapClient(this.locationId)

    const result = await client.collectCardData(readerId, {
      placeholderAmount: params.placeholderAmount ?? 0.01,
    })

    return this.mapResponse(result)
  }

  async padReset(readerId: string): Promise<void> {
    const client = await getDatacapClient(this.locationId)
    await client.padReset(readerId)
  }

  private mapResponse(response: DatacapResponse): CardReadResult {
    if (response.cmdStatus !== 'Approved' && response.cmdStatus !== 'Success') {
      return {
        success: false,
        recordNo: null,
        cardType: null,
        cardLast4: null,
        cardholderName: null,
        entryMethod: null,
        walletType: null,
        error: response.textResponse || `Card read failed: ${response.cmdStatus}`,
      }
    }

    const walletType = detectWalletType(response.aid, response.entryMethod)

    return {
      success: true,
      recordNo: response.recordNo || null,
      cardType: response.cardType || null,
      cardLast4: response.cardLast4 || null,
      cardholderName: response.cardholderName || null,
      entryMethod: response.entryMethod || null,
      walletType,
    }
  }
}
