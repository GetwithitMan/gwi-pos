/**
 * Periodically snapshots peripheral device status into PeripheralSnapshot table
 * for upstream sync to Neon/MC. Runs every 60 seconds.
 *
 * Queries Terminal, Printer, PaymentReader, Scale, and KDSScreen tables,
 * then upserts a denormalized snapshot row for each device. The upstream
 * sync worker picks these up and delivers them to Neon so MC can render
 * a fleet-wide device health dashboard.
 */
import { masterClient as db } from './db'
import { createChildLogger } from './logger'

const log = createChildLogger('peripheral-snapshot')
const INTERVAL_MS = 60_000

export function startPeripheralSnapshotWriter(locationId: string) {
  async function writeSnapshots() {
    try {
      const [terminals, printers, readers, scales, kdsScreens] = await Promise.all([
        db.terminal.findMany({
          where: { locationId, deletedAt: null },
          select: { id: true, name: true, isOnline: true, lastSeenAt: true, platform: true, appVersion: true, category: true },
        }),
        db.printer.findMany({
          where: { locationId, deletedAt: null },
          select: { id: true, name: true, printerRole: true, ipAddress: true, lastPingOk: true, lastPingAt: true },
        }),
        db.paymentReader.findMany({
          where: { locationId, deletedAt: null },
          select: { id: true, name: true, isOnline: true, lastSeenAt: true, lastError: true },
        }),
        db.scale.findMany({
          where: { locationId, deletedAt: null },
          select: { id: true, name: true, isConnected: true, lastSeenAt: true, lastError: true },
        }),
        db.kDSScreen.findMany({
          where: { locationId, deletedAt: null },
          select: { id: true, name: true, isOnline: true, lastSeenAt: true, screenType: true },
        }),
      ])

      const upserts: Promise<any>[] = []

      for (const t of terminals) {
        upserts.push(db.peripheralSnapshot.upsert({
          where: { locationId_deviceType_deviceId: { locationId, deviceType: 'terminal', deviceId: t.id } },
          create: {
            locationId,
            deviceType: 'terminal',
            deviceId: t.id,
            deviceName: t.name,
            isOnline: t.isOnline,
            lastSeenAt: t.lastSeenAt,
            metadata: { platform: t.platform, appVersion: t.appVersion, category: t.category },
            lastMutatedBy: 'local',
          },
          update: {
            deviceName: t.name,
            isOnline: t.isOnline,
            lastSeenAt: t.lastSeenAt,
            metadata: { platform: t.platform, appVersion: t.appVersion, category: t.category },
            lastMutatedBy: 'local',
          },
        }))
      }

      for (const p of printers) {
        upserts.push(db.peripheralSnapshot.upsert({
          where: { locationId_deviceType_deviceId: { locationId, deviceType: 'printer', deviceId: p.id } },
          create: {
            locationId,
            deviceType: 'printer',
            deviceId: p.id,
            deviceName: p.name,
            isOnline: p.lastPingOk,
            lastSeenAt: p.lastPingAt,
            metadata: { printerRole: p.printerRole, ipAddress: p.ipAddress },
            lastMutatedBy: 'local',
          },
          update: {
            deviceName: p.name,
            isOnline: p.lastPingOk,
            lastSeenAt: p.lastPingAt,
            metadata: { printerRole: p.printerRole, ipAddress: p.ipAddress },
            lastMutatedBy: 'local',
          },
        }))
      }

      for (const r of readers) {
        upserts.push(db.peripheralSnapshot.upsert({
          where: { locationId_deviceType_deviceId: { locationId, deviceType: 'reader', deviceId: r.id } },
          create: {
            locationId,
            deviceType: 'reader',
            deviceId: r.id,
            deviceName: r.name,
            isOnline: r.isOnline,
            lastSeenAt: r.lastSeenAt,
            lastError: r.lastError,
            lastMutatedBy: 'local',
          },
          update: {
            deviceName: r.name,
            isOnline: r.isOnline,
            lastSeenAt: r.lastSeenAt,
            lastError: r.lastError,
            lastMutatedBy: 'local',
          },
        }))
      }

      for (const s of scales) {
        upserts.push(db.peripheralSnapshot.upsert({
          where: { locationId_deviceType_deviceId: { locationId, deviceType: 'scale', deviceId: s.id } },
          create: {
            locationId,
            deviceType: 'scale',
            deviceId: s.id,
            deviceName: s.name,
            isOnline: s.isConnected,
            lastSeenAt: s.lastSeenAt,
            lastError: s.lastError,
            lastMutatedBy: 'local',
          },
          update: {
            deviceName: s.name,
            isOnline: s.isConnected,
            lastSeenAt: s.lastSeenAt,
            lastError: s.lastError,
            lastMutatedBy: 'local',
          },
        }))
      }

      for (const k of kdsScreens) {
        upserts.push(db.peripheralSnapshot.upsert({
          where: { locationId_deviceType_deviceId: { locationId, deviceType: 'kds', deviceId: k.id } },
          create: {
            locationId,
            deviceType: 'kds',
            deviceId: k.id,
            deviceName: k.name,
            isOnline: k.isOnline,
            lastSeenAt: k.lastSeenAt,
            metadata: { screenType: k.screenType },
            lastMutatedBy: 'local',
          },
          update: {
            deviceName: k.name,
            isOnline: k.isOnline,
            lastSeenAt: k.lastSeenAt,
            metadata: { screenType: k.screenType },
            lastMutatedBy: 'local',
          },
        }))
      }

      await Promise.all(upserts)
      log.debug({ count: upserts.length }, 'Peripheral snapshots written')
    } catch (err) {
      log.warn({ err }, 'Peripheral snapshot write failed')
    }
  }

  const timer = setInterval(writeSnapshots, INTERVAL_MS)
  timer.unref()
  void writeSnapshots() // Run immediately on startup
  log.info('Peripheral snapshot writer started (60s interval)')
}
