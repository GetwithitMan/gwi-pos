// Datacap Direct API — Sequence Number Management
// Each response echoes SequenceNo; use that value in the next request per reader

import { db } from '@/lib/db'
import { DEFAULT_SEQUENCE_NO } from './constants'

/**
 * Validate that a sequence number matches the Datacap format: 10-12 digits.
 * Invalid sequence numbers can cause transaction failures or duplicate detection issues.
 */
function validateSequenceNo(seqNo: string): boolean {
  return /^\d{10,12}$/.test(seqNo)
}

export async function getSequenceNo(readerId: string): Promise<string> {
  const reader = await db.paymentReader.findUnique({
    where: { id: readerId },
    select: { lastSequenceNo: true },
  })
  const seqNo = reader?.lastSequenceNo || DEFAULT_SEQUENCE_NO
  // If stored value is corrupted, reset to default
  return validateSequenceNo(seqNo) ? seqNo : DEFAULT_SEQUENCE_NO
}

export async function updateSequenceNo(readerId: string, sequenceNo: string): Promise<void> {
  if (!sequenceNo) return

  // Validate format before persisting — reset to default if invalid
  const validSeqNo = validateSequenceNo(sequenceNo) ? sequenceNo : DEFAULT_SEQUENCE_NO

  await db.paymentReader.update({
    where: { id: readerId },
    data: { lastSequenceNo: validSeqNo },
  })
}
