/** Shared types for OrderPanelActions and its sub-components */

import type { DatacapProcessingStatus } from '@/hooks/useDatacap'

export interface DatacapHookReturn {
  reader: any
  isReaderOnline: boolean
  processingStatus: DatacapProcessingStatus
  isProcessing: boolean
  error: string | null
  canSwap: boolean
  showSwapModal: boolean
  setShowSwapModal: (show: boolean) => void
  backupReader: any
  swapToBackup: () => void
  triggerBeep: () => void
  cancelTransaction: () => void
  processPayment: (params: {
    orderId: string
    amount: number
    tipAmount: number
    tranType: string
  }) => Promise<void>
}
