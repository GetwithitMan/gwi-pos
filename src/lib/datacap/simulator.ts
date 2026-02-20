// Datacap Direct API — Built-in Simulator
// Returns realistic XML responses for testing without hardware

import type { DatacapRequestFields, TranCode } from './types'
import { DEFAULT_SEQUENCE_NO } from './constants'

function randomDigits(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')
}

function randomAlphaNum(n: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function incrementSequenceNo(seq: string): string {
  // Increment last 4 digits, wrapping at 9999
  const num = parseInt(seq.slice(-4), 10)
  const next = ((num + 10) % 10000).toString().padStart(4, '0')
  return seq.slice(0, -4) + next
}

const SIM_CARDS = [
  { type: 'VISA', last4: '4111', name: 'JOHN SMITH' },
  { type: 'MASTERCARD', last4: '5432', name: 'JANE DOE' },
  { type: 'AMEX', last4: '3782', name: 'ALEX JOHNSON' },
  { type: 'DISCOVER', last4: '6011', name: 'CHRIS WILSON' },
  { type: 'VISA', last4: '4242', name: 'SARAH MILLER' },
]

function randomCard() {
  return SIM_CARDS[Math.floor(Math.random() * SIM_CARDS.length)]
}

function wrapResponse(content: string): string {
  return `<RStream>${content}</RStream>`
}

interface SimOptions {
  sequenceNo?: string
  decline?: boolean
  error?: boolean    // Simulate a device/communication error
  partial?: boolean  // Simulate partial approval (approves 50% of requested amount)
}

/**
 * Simulate a Datacap XML response for testing.
 * Returns valid XML matching real device format.
 */
export function simulateResponse(
  tranCode: TranCode,
  fields: DatacapRequestFields,
  options: SimOptions = {}
): string {
  const seqIn = fields.sequenceNo || options.sequenceNo || DEFAULT_SEQUENCE_NO
  const seqOut = incrementSequenceNo(seqIn)
  const card = randomCard()
  const authCode = randomDigits(6)
  const recordNo = `DC4:${randomAlphaNum(30)}`
  const refNo = fields.refNo || fields.invoiceNo || randomDigits(6)

  // Simulate error (device/communication failure)
  if (options.error) {
    return wrapResponse(`
      <CmdStatus>Error</CmdStatus>
      <DSIXReturnCode>200003</DSIXReturnCode>
      <ResponseOrigin>Client</ResponseOrigin>
      <TextResponse>Device Error</TextResponse>
      <SequenceNo>${seqOut}</SequenceNo>
      <TranCode>${tranCode}</TranCode>
    `)
  }

  // Simulate decline
  if (options.decline) {
    return wrapResponse(`
      <CmdStatus>Declined</CmdStatus>
      <DSIXReturnCode>100001</DSIXReturnCode>
      <ResponseOrigin>Processor</ResponseOrigin>
      <TextResponse>DECLINED</TextResponse>
      <SequenceNo>${seqOut}</SequenceNo>
      <TranCode>${tranCode}</TranCode>
    `)
  }

  switch (tranCode) {
    case 'EMVSale':
    case 'EMVPreAuth':
    case 'EMVPreAuthCompletion':
    case 'EMVForceAuth': {
      const amount = fields.amounts?.purchase?.toFixed(2) || '0.00'
      const gratuity = fields.amounts?.gratuity?.toFixed(2)
      return wrapResponse(`
        <CmdStatus>Approved</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Processor</ResponseOrigin>
        <TextResponse>APPROVED</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>${tranCode}</TranCode>
        <Authorize>${amount}</Authorize>
        <AuthCode>${authCode}</AuthCode>
        <RefNo>${refNo}</RefNo>
        <RecordNo>${recordNo}</RecordNo>
        <AcctNo>***${card.last4}</AcctNo>
        <CardType>${card.type}</CardType>
        <CardholderName>${card.name}</CardholderName>
        <CardholderID>SIM_${randomAlphaNum(16)}</CardholderID>
        <EntryMethod>CONTACTLESS</EntryMethod>
        <AID>A0000000031010</AID>
        <CVM>NO_CVM</CVM>
        ${gratuity ? `<Gratuity>${gratuity}</Gratuity>` : ''}
        <Line1>${card.type} ${tranCode === 'EMVPreAuth' ? 'PRE-AUTH' : 'SALE'}</Line1>
        <Line2>Card: ***${card.last4}</Line2>
        <Line3>Auth: ${authCode}</Line3>
        <Line4>Amount: $${amount}</Line4>
      `)
    }

    case 'EMVReturn': {
      const amount = fields.amounts?.purchase?.toFixed(2) || '0.00'
      return wrapResponse(`
        <CmdStatus>Approved</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Processor</ResponseOrigin>
        <TextResponse>RETURN APPROVED</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>EMVReturn</TranCode>
        <Authorize>${amount}</Authorize>
        <AuthCode>${authCode}</AuthCode>
        <RefNo>${refNo}</RefNo>
        <RecordNo>${recordNo}</RecordNo>
        <AcctNo>***${card.last4}</AcctNo>
        <CardType>${card.type}</CardType>
        <EntryMethod>CHIP</EntryMethod>
      `)
    }

    case 'PreAuthCaptureByRecordNo':
    case 'IncrementalAuthByRecordNo':
    case 'AdjustByRecordNo': {
      const amount = fields.amounts?.purchase?.toFixed(2) || '0.00'
      const gratuity = fields.amounts?.gratuity?.toFixed(2)
      const total = gratuity
        ? (parseFloat(amount) + parseFloat(gratuity)).toFixed(2)
        : amount
      return wrapResponse(`
        <CmdStatus>Approved</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Processor</ResponseOrigin>
        <TextResponse>APPROVED</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>${tranCode}</TranCode>
        <Authorize>${total}</Authorize>
        <AuthCode>${authCode}</AuthCode>
        <RefNo>${refNo}</RefNo>
        <RecordNo>${fields.recordNo || recordNo}</RecordNo>
      `)
    }

    case 'VoidSaleByRecordNo':
    case 'VoidReturnByRecordNo': {
      return wrapResponse(`
        <CmdStatus>Approved</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Processor</ResponseOrigin>
        <TextResponse>VOID APPROVED</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>${tranCode}</TranCode>
        <AuthCode>${authCode}</AuthCode>
        <RefNo>${refNo}</RefNo>
        <RecordNo>${fields.recordNo || recordNo}</RecordNo>
      `)
    }

    case 'ReturnByRecordNo': {
      const amount = fields.amounts?.purchase?.toFixed(2) || '0.00'
      return wrapResponse(`
        <CmdStatus>Approved</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Processor</ResponseOrigin>
        <TextResponse>RETURN APPROVED</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>ReturnByRecordNo</TranCode>
        <Authorize>${amount}</Authorize>
        <AuthCode>${authCode}</AuthCode>
        <RefNo>${refNo}</RefNo>
        <RecordNo>${fields.recordNo || recordNo}</RecordNo>
      `)
    }

    case 'EMVPadReset': {
      return wrapResponse(`
        <CmdStatus>Success</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Client</ResponseOrigin>
        <TextResponse>Reset Successful</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>EMVPadReset</TranCode>
      `)
    }

    case 'EMVParamDownload': {
      return wrapResponse(`
        <CmdStatus>Success</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Client</ResponseOrigin>
        <TextResponse>Parameter Download Successful</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>EMVParamDownload</TranCode>
      `)
    }

    case 'CollectCardData': {
      return wrapResponse(`
        <CmdStatus>Success</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Device</ResponseOrigin>
        <TextResponse>Card Data Collected</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>CollectCardData</TranCode>
        <AcctNo>***${card.last4}</AcctNo>
        <CardType>${card.type}</CardType>
        <CardholderName>${card.name}</CardholderName>
        <CardholderID>SIM_${randomAlphaNum(16)}</CardholderID>
        <EntryMethod>CONTACTLESS</EntryMethod>
      `)
    }

    case 'GetSuggestiveTip': {
      const tipPercents = [15, 18, 20, 25]
      const selected = tipPercents[Math.floor(Math.random() * tipPercents.length)]
      return wrapResponse(`
        <CmdStatus>Success</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Device</ResponseOrigin>
        <TextResponse>Tip Selected</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>GetSuggestiveTip</TranCode>
        <Gratuity>${selected}</Gratuity>
      `)
    }

    case 'GetSignature': {
      // Return a small base64 "signature" placeholder
      return wrapResponse(`
        <CmdStatus>Success</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Device</ResponseOrigin>
        <TextResponse>Signature Captured</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>GetSignature</TranCode>
        <SignatureData>SIM_SIGNATURE_${randomAlphaNum(20)}</SignatureData>
      `)
    }

    case 'GetYesNo': {
      return wrapResponse(`
        <CmdStatus>Success</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Device</ResponseOrigin>
        <TextResponse>Yes</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>GetYesNo</TranCode>
      `)
    }

    case 'GetMultipleChoice': {
      const choice = fields.buttonLabels?.[0] || 'Option 1'
      return wrapResponse(`
        <CmdStatus>Success</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Device</ResponseOrigin>
        <TextResponse>${choice}</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>GetMultipleChoice</TranCode>
      `)
    }

    case 'BatchSummary': {
      return wrapResponse(`
        <CmdStatus>Success</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Client</ResponseOrigin>
        <TextResponse>Batch Summary</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>BatchSummary</TranCode>
        <BatchNo>${randomDigits(6)}</BatchNo>
        <BatchItemCount>42</BatchItemCount>
      `)
    }

    case 'BatchClose': {
      return wrapResponse(`
        <CmdStatus>Success</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Processor</ResponseOrigin>
        <TextResponse>Batch Closed Successfully</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>BatchClose</TranCode>
        <BatchNo>${randomDigits(6)}</BatchNo>
      `)
    }

    case 'PartialReversalByRecordNo': {
      const amount = fields.amounts?.purchase?.toFixed(2) || '0.00'
      return wrapResponse(`
        <CmdStatus>Approved</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Processor</ResponseOrigin>
        <TextResponse>REVERSAL APPROVED</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>PartialReversalByRecordNo</TranCode>
        <Authorize>${amount}</Authorize>
        <AuthCode>${authCode}</AuthCode>
        <RefNo>${refNo}</RefNo>
        <RecordNo>${fields.recordNo || recordNo}</RecordNo>
      `)
    }

    case 'SaleByRecordNo': {
      const amount = fields.amounts?.purchase?.toFixed(2) || '0.00'
      const gratuity = fields.amounts?.gratuity?.toFixed(2)
      const total = gratuity
        ? (parseFloat(amount) + parseFloat(gratuity)).toFixed(2)
        : amount
      // Partial approval simulation: approve only 50% of requested
      if (options.partial) {
        const partialAmount = (parseFloat(amount) / 2).toFixed(2)
        return wrapResponse(`
          <CmdStatus>Approved</CmdStatus>
          <DSIXReturnCode>000001</DSIXReturnCode>
          <ResponseOrigin>Processor</ResponseOrigin>
          <TextResponse>PARTIAL APPROVAL</TextResponse>
          <SequenceNo>${seqOut}</SequenceNo>
          <TranCode>SaleByRecordNo</TranCode>
          <Authorize>${partialAmount}</Authorize>
          <AuthCode>${authCode}</AuthCode>
          <RefNo>${refNo}</RefNo>
          <RecordNo>${fields.recordNo || recordNo}</RecordNo>
          <PartialAuthApprovalCode>${authCode}</PartialAuthApprovalCode>
        `)
      }
      return wrapResponse(`
        <CmdStatus>Approved</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Processor</ResponseOrigin>
        <TextResponse>APPROVED</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>SaleByRecordNo</TranCode>
        <Authorize>${total}</Authorize>
        <AuthCode>${authCode}</AuthCode>
        <RefNo>${refNo}</RefNo>
        <RecordNo>${fields.recordNo || recordNo}</RecordNo>
      `)
    }

    case 'PreAuthByRecordNo': {
      const amount = fields.amounts?.purchase?.toFixed(2) || '0.00'
      return wrapResponse(`
        <CmdStatus>Approved</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Processor</ResponseOrigin>
        <TextResponse>PRE-AUTH APPROVED</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>PreAuthByRecordNo</TranCode>
        <Authorize>${amount}</Authorize>
        <AuthCode>${authCode}</AuthCode>
        <RefNo>${refNo}</RefNo>
        <RecordNo>${fields.recordNo || recordNo}</RecordNo>
      `)
    }

    case 'EMVAuthOnly': {
      return wrapResponse(`
        <CmdStatus>Approved</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Processor</ResponseOrigin>
        <TextResponse>APPROVED</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>EMVAuthOnly</TranCode>
        <Authorize>0.00</Authorize>
        <AuthCode>${authCode}</AuthCode>
        <RefNo>${refNo}</RefNo>
        <RecordNo>${recordNo}</RecordNo>
        <AcctNo>***${card.last4}</AcctNo>
        <CardType>${card.type}</CardType>
        <CardholderName>${card.name}</CardholderName>
        <EntryMethod>CONTACTLESS</EntryMethod>
        <AID>A0000000031010</AID>
        <CVM>NO_CVM</CVM>
      `)
    }

    case 'SAF_Statistics': {
      return wrapResponse(`
        <CmdStatus>Success</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Client</ResponseOrigin>
        <TextResponse>SAF Statistics</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>SAF_Statistics</TranCode>
        <SAFCount>0</SAFCount>
        <SAFAmount>0.00</SAFAmount>
      `)
    }

    case 'SAF_ForwardAll': {
      return wrapResponse(`
        <CmdStatus>Success</CmdStatus>
        <DSIXReturnCode>000000</DSIXReturnCode>
        <ResponseOrigin>Processor</ResponseOrigin>
        <TextResponse>SAF Forward Complete</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
        <TranCode>SAF_ForwardAll</TranCode>
        <SAFForwarded>0</SAFForwarded>
      `)
    }

    default: {
      return wrapResponse(`
        <CmdStatus>Error</CmdStatus>
        <DSIXReturnCode>200003</DSIXReturnCode>
        <ResponseOrigin>Client</ResponseOrigin>
        <TextResponse>Unknown TranCode: ${tranCode}</TextResponse>
        <SequenceNo>${seqOut}</SequenceNo>
      `)
    }
  }
}
