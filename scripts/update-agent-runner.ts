import { executeUpdate, reportDeployHealth } from '../src/lib/update-agent'

async function main() {
  const targetVersion = process.argv[2]
  if (!targetVersion) {
    console.error('[update-agent-runner] targetVersion required')
    process.exit(1)
  }

  try {
    const result = await executeUpdate(targetVersion)
    if (result.success) {
      console.log(`[update-agent-runner] Update succeeded: ${result.previousVersion} → ${result.targetVersion} (${result.durationMs}ms)`)
    } else {
      console.error(`[update-agent-runner] Update failed: ${result.error || 'unknown error'}`)
    }

    try {
      await reportDeployHealth(result)
    } catch (err) {
      console.warn('[update-agent-runner] reportDeployHealth failed', err)
    }
  } catch (err) {
    console.error('[update-agent-runner] Fatal update failure', err)
    process.exit(1)
  }
}

void main()
