/**
 * Scale Protocol Interface
 *
 * Defines the contract for all scale hardware implementations.
 * Each scale brand/model implements this interface via the factory pattern.
 */

export interface WeightReading {
  /** Weight value in the scale's configured unit */
  weight: number
  /** Unit of measurement (lb, kg, oz, g) */
  unit: string
  /** Whether the reading is stable (not fluctuating) */
  stable: boolean
  /** Gross (total) or net (tared) weight mode */
  grossNet: 'gross' | 'net'
  /** Scale is over its maximum capacity */
  overCapacity: boolean
  /** Raw response string from the scale */
  raw: string
  /** Timestamp of the reading */
  timestamp: Date
}

export interface SerialConfig {
  portPath: string
  baudRate: number
  dataBits: number
  parity: 'none' | 'even' | 'odd'
  stopBits: number
  /** Unit of measurement for weight values */
  weightUnit: string
  /** Number of decimal places for weight parsing */
  precision: number
}

export interface ScaleProtocol {
  /** Open the serial connection */
  connect(): Promise<void>
  /** Close the serial connection */
  disconnect(): Promise<void>
  /** Send a weight request and return the parsed reading */
  requestWeight(): Promise<WeightReading>
  /** Send a tare (zero) command */
  tare(): Promise<void>
  /** Whether the serial port is currently open */
  isConnected(): boolean
  /** Register callback for continuous weight readings */
  onWeight(cb: (reading: WeightReading) => void): void
  /** Register callback for errors */
  onError(cb: (err: Error) => void): void
  /** Register callback for disconnect events */
  onDisconnect(cb: () => void): void
}
