import { NextRequest } from 'next/server'
import { requireDatacapClient, validateReader, parseBody, datacapErrorResponse } from '@/lib/datacap/helpers'
import { withVenue } from '@/lib/with-venue'

interface DevicePromptRequest {
  locationId: string
  readerId: string
  promptType: 'tip' | 'yesno' | 'signature' | 'choice'
  promptText?: string
  suggestions?: number[]
  buttonLabels?: string[]
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await parseBody<DevicePromptRequest>(request)
    const { locationId, readerId, promptType, promptText, suggestions, buttonLabels } = body

    if (!locationId || !readerId || !promptType) {
      return Response.json({ error: 'Missing required fields: locationId, readerId, promptType' }, { status: 400 })
    }

    await validateReader(readerId, locationId)
    const client = await requireDatacapClient(locationId)

    let response
    switch (promptType) {
      case 'tip':
        response = await client.getSuggestiveTip(readerId, suggestions)
        break
      case 'yesno':
        response = await client.getYesNo(readerId, promptText || 'Confirm?')
        break
      case 'signature':
        response = await client.getSignature(readerId)
        break
      case 'choice':
        response = await client.getMultipleChoice(
          readerId,
          promptText || 'Select option:',
          buttonLabels || ['Option 1', 'Option 2']
        )
        break
      default:
        return Response.json({ error: `Invalid promptType: ${promptType}` }, { status: 400 })
    }

    return Response.json({
      data: {
        success: response.cmdStatus === 'Success',
        response: response.textResponse,
        gratuity: response.gratuityAmount,
        signatureData: response.signatureData,
      },
    })
  } catch (err) {
    return datacapErrorResponse(err)
  }
})
