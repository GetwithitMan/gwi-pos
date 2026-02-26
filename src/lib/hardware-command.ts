import { db } from '@/lib/db'

/**
 * Execute a hardware command remotely via the NUC.
 * Creates a HardwareCommand record and polls for the NUC worker to process it.
 * Used when running on Vercel (cloud) where direct hardware access isn't possible.
 */
export async function executeHardwareCommand(opts: {
  locationId: string
  commandType: string
  targetDeviceId: string
  payload?: Record<string, unknown>
  timeoutMs?: number
}): Promise<{ success: boolean; resultPayload?: any; error?: string }> {
  const { locationId, commandType, targetDeviceId, payload, timeoutMs = 30000 } = opts

  // Create command with 60s expiry
  const command = await db.hardwareCommand.create({
    data: {
      locationId,
      commandType,
      targetDeviceId,
      payload: (payload ?? undefined) as any,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60000),
    },
  })

  // Poll for result
  const pollInterval = 1500
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, pollInterval))

    const updated = await db.hardwareCommand.findUnique({
      where: { id: command.id },
      select: { status: true, resultPayload: true, errorMessage: true },
    })

    if (!updated) {
      return { success: false, error: 'Command record not found' }
    }

    if (updated.status === 'COMPLETED') {
      // Clean up the command record
      void db.hardwareCommand.delete({ where: { id: command.id } }).catch(() => {})
      const result = updated.resultPayload as Record<string, any> | null
      return {
        success: result?.success ?? true,
        resultPayload: result,
      }
    }

    if (updated.status === 'FAILED') {
      void db.hardwareCommand.delete({ where: { id: command.id } }).catch(() => {})
      const result = updated.resultPayload as Record<string, any> | null
      return {
        success: false,
        resultPayload: result,
        error: updated.errorMessage || 'Command failed on NUC',
      }
    }
  }

  // Timeout — clean up
  void db.hardwareCommand.delete({ where: { id: command.id } }).catch(() => {})
  return { success: false, error: 'Command timed out — NUC may be offline' }
}
