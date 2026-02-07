// Datacap Direct API — Sequence Number Management
// Each response echoes SequenceNo; use that value in the next request per reader

import { db } from '@/lib/db'
import { DEFAULT_SEQUENCE_NO } from './constants'

export async function getSequenceNo(readerId: string): Promise<string> {
  const reader = await db.paymentReader.findUnique({
    where: { id: readerId },
    select: { lastSequenceNo: true },
  })
  return reader?.lastSequenceNo || DEFAULT_SEQUENCE_NO
}

export async function updateSequenceNo(readerId: string, sequenceNo: string): Promise<void> {
  if (!sequenceNo) return
  await db.paymentReader.update({
    where: { id: readerId },
    data: { lastSequenceNo: sequenceNo },
  })
}
