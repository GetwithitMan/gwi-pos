// GWI POS Sync Agent — receives fleet commands from Mission Control
// Runs as systemd service (pulse-sync). No npm dependencies — native Node.js only.
'use strict'
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ENV_FILE         = '/opt/gwi-pos/.env'
const APP_DIR          = '/opt/gwi-pos/app'
const LOG_FILE         = '/opt/gwi-pos/sync-agent.log'
const PRIVATE_KEY_PATH = '/opt/gwi-pos/keys/private.pem'

// ── Load config from .env ──────────────────────────────────────────────────
const env = {}
try {
  fs.readFileSync(ENV_FILE, 'utf-8').split('\n').forEach(line => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return
    const eq = t.indexOf('=')
    if (eq > 0) env[t.slice(0, eq)] = t.slice(eq + 1)
  })
} catch (e) {
  console.error('[Sync] Cannot read .env:', e.message)
  process.exit(1)
}

const NODE_ID = env.SERVER_NODE_ID
const API_KEY = env.SERVER_API_KEY
const HW_FP   = env.HARDWARE_FINGERPRINT || 'none'
const MC_URL  = env.MISSION_CONTROL_URL

if (!NODE_ID || !API_KEY || !MC_URL) {
  console.error('[Sync] Missing SERVER_NODE_ID, SERVER_API_KEY, or MISSION_CONTROL_URL')
  process.exit(1)
}

function log(msg) {
  const line = new Date().toISOString() + ' ' + msg
  console.log(line)
  try { fs.appendFileSync(LOG_FILE, line + '\n') } catch {}
}

// ── HMAC Auth ──────────────────────────────────────────────────────────────
function sign(body) {
  return crypto.createHmac('sha256', API_KEY).update(body).digest('hex')
}

function authHeaders(body) {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + API_KEY,
    'X-Server-Node-Id': NODE_ID,
    'X-Hardware-Fingerprint': HW_FP,
    'X-Request-Signature': sign(body),
  }
}

// ── HTTP helpers ───────────────────────────────────────────────────────────
function postJson(urlPath, data) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(data)
    var url = new URL(urlPath, MC_URL)
    var mod = url.protocol === 'https:' ? https : http
    var req = mod.request(url, { method: 'POST', headers: authHeaders(body) }, function(res) {
      var d = ''
      res.on('data', function(c) { d += c })
      res.on('end', function() { resolve({ status: res.statusCode, body: d }) })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function getJson(urlPath) {
  return new Promise(function(resolve, reject) {
    var url = new URL(urlPath, MC_URL)
    var mod = url.protocol === 'https:' ? https : http
    var req = mod.get(url, { headers: authHeaders('') }, function(res) {
      var d = ''
      res.on('data', function(c) { d += c })
      res.on('end', function() { resolve({ status: res.statusCode, body: d }) })
    })
    req.on('error', reject)
  })
}

function putJsonLocal(urlPath, data) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(data)
    var url = new URL(urlPath, 'http://localhost:3005')
    var req = http.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' } }, function(res) {
      var d = ''
      res.on('data', function(c) { d += c })
      res.on('end', function() { resolve({ status: res.statusCode, body: d }) })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function postJsonLocal(urlPath, data) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(data)
    var url = new URL(urlPath, 'http://localhost:3005')
    var req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, function(res) {
      var d = ''
      res.on('data', function(c) { d += c })
      res.on('end', function() { resolve({ status: res.statusCode, body: d }) })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── Shell exec ─────────────────────────────────────────────────────────────
function run(cmd, cwd, timeoutSec) {
  try {
    execSync(cmd, { cwd: cwd, timeout: (timeoutSec || 300) * 1000, stdio: 'pipe', encoding: 'utf-8' })
    return true
  } catch (e) {
    log('  FAILED: ' + (e.stderr || e.message || '').slice(0, 300))
    return false
  }
}

// ── FORCE_UPDATE handler ───────────────────────────────────────────────────
// Phase 8.2: First tries version-targeted update via local update agent
// (preflight checks, payment safety, cloud event reporting).
// Falls back to direct update if local POS server is unreachable.
async function handleForceUpdate(payload) {
  var targetVersion = (payload && payload.version) || null

  // Try version-targeted update via local update agent (Phase 8.2)
  if (targetVersion) {
    log('[Update] Attempting version-targeted update to ' + targetVersion + ' via update agent...')
    try {
      var updateRes = await postJsonLocal('/api/system/update', { targetVersion: targetVersion })
      if (updateRes.status === 200) {
        var updateData = JSON.parse(updateRes.body)
        if (updateData.success) {
          log('[Update] Update agent accepted update to ' + targetVersion + ' — monitoring...')
          // Wait for the update to complete (up to 15 minutes)
          // The update agent runs in background; poll status
          var waited = 0
          var pollInterval = 10000 // 10s
          var maxWait = 900000 // 15 min
          while (waited < maxWait) {
            await new Promise(function(r) { setTimeout(r, pollInterval) })
            waited += pollInterval
            try {
              var statusRes = await new Promise(function(resolve, reject) {
                var url = new URL('/api/system/update', 'http://localhost:3005')
                http.get(url, function(res) {
                  var d = ''
                  res.on('data', function(c) { d += c })
                  res.on('end', function() { resolve({ status: res.statusCode, body: d }) })
                }).on('error', reject)
              })
              var statusData = JSON.parse(statusRes.body)
              if (!statusData.isUpdating) {
                // Update finished (or server restarted with new version)
                var newVer = statusData.currentVersion || 'unknown'
                log('[Update] Update agent finished — version: ' + newVer)
                // Self-update sync-agent from the new repo
                selfUpdateSyncAgent()
                return { ok: true, version: newVer, steps: ['update-agent OK'] }
              }
            } catch (pollErr) {
              // Server may be restarting — expected. Wait a bit more.
              log('[Update] Server unreachable during update (expected during restart), waiting...')
              await new Promise(function(r) { setTimeout(r, 15000) })
              waited += 15000
              // Check if the server came back with new version
              try {
                var postRestartRes = await new Promise(function(resolve, reject) {
                  var url = new URL('/api/system/update', 'http://localhost:3005')
                  http.get(url, function(res) {
                    var d = ''
                    res.on('data', function(c) { d += c })
                    res.on('end', function() { resolve({ status: res.statusCode, body: d }) })
                  }).on('error', reject)
                })
                var prData = JSON.parse(postRestartRes.body)
                if (!prData.isUpdating) {
                  log('[Update] Server back online — version: ' + (prData.currentVersion || 'unknown'))
                  selfUpdateSyncAgent()
                  return { ok: true, version: prData.currentVersion || 'unknown', steps: ['update-agent OK', 'restart OK'] }
                }
              } catch (e) {
                // Still down — continue waiting
              }
            }
          }
          log('[Update] Update agent timed out after 15min — falling back to direct update')
        } else {
          log('[Update] Update agent rejected: ' + (updateData.error || 'unknown') + ' — falling back to direct update')
        }
      } else if (updateRes.status === 409) {
        log('[Update] Update already in progress — waiting...')
        return { ok: true, version: 'pending', steps: ['update-agent already running'] }
      } else {
        log('[Update] Update agent HTTP ' + updateRes.status + ' — falling back to direct update')
      }
    } catch (agentErr) {
      log('[Update] Update agent unreachable: ' + agentErr.message + ' — falling back to direct update')
    }
  }

  // Fallback: Direct update (original behavior)
  log('[Update] Starting direct FORCE_UPDATE...')
  var steps = []

  function step(name, cmd, failOk, timeout) {
    log('  ' + name + '...')
    var ok = run(cmd, APP_DIR, timeout)
    steps.push(name + (ok ? ' OK' : ' FAIL'))
    return ok || failOk
  }

  // Clear any stale git lock files left by previously interrupted operations
  try {
    var lockFiles = [
      path.join(APP_DIR, '.git', 'index.lock'),
      path.join(APP_DIR, '.git', 'refs', 'remotes', 'origin', 'main.lock'),
    ]
    lockFiles.forEach(function(f) { try { fs.unlinkSync(f) } catch (e) {} })
  } catch (e) {}

  step('git fetch', 'git fetch origin', true, 60)

  // Version-targeted: if targetVersion has a git tag, use it; otherwise origin/main
  var gitRef = 'origin/main'
  if (targetVersion) {
    var tagRef = 'v' + targetVersion
    try {
      execSync('git rev-parse ' + tagRef, { cwd: APP_DIR, timeout: 5000, stdio: 'pipe' })
      gitRef = tagRef
      log('  Using tag: ' + tagRef)
    } catch (e) {
      log('  Tag ' + tagRef + ' not found, using origin/main')
    }
  }

  // Run git reset and capture the actual error output for diagnostics
  log('  git reset to ' + gitRef + '...')
  var gitResetError = ''
  try {
    execSync('git reset --hard ' + gitRef, { cwd: APP_DIR, timeout: 30000, stdio: 'pipe', encoding: 'utf-8' })
    steps.push('git reset OK')
  } catch (e) {
    gitResetError = ((e.stderr || e.stdout || e.message || '') + '').slice(0, 500)
    steps.push('git reset FAIL: ' + gitResetError.slice(0, 100))
    log('  FAILED: ' + gitResetError)
    return { ok: false, error: 'git pull failed: ' + gitResetError, steps: steps }
  }

  // Re-copy env files in case they were updated
  try { fs.copyFileSync(ENV_FILE, path.join(APP_DIR, '.env')) } catch (e) {}
  try { fs.copyFileSync(ENV_FILE, path.join(APP_DIR, '.env.local')) } catch (e) {}

  if (!step('npm install', 'npm install --production=false', false, 180)) {
    return { ok: false, error: 'npm install failed', steps: steps }
  }
  step('prisma generate', 'npx prisma generate', true, 120)
  step('pre-migrate', 'node scripts/nuc-pre-migrate.js', true, 180)

  // Run migrate deploy — if it fails with P3005 (db-push database with no migration
  // history), baseline all existing migrations as applied and retry.
  log('  prisma migrate...')
  var migrateOk = false
  try {
    execSync('npx prisma migrate deploy', { cwd: APP_DIR, timeout: 120000, stdio: 'pipe', encoding: 'utf-8' })
    migrateOk = true
    steps.push('prisma migrate OK')
  } catch (e) {
    var migrateErr = ((e.stderr || e.stdout || e.message || '') + '').slice(0, 1000)
    if (migrateErr.indexOf('P3005') !== -1) {
      log('  Database needs baselining (created with db push)...')
      try {
        var migDirs = fs.readdirSync(path.join(APP_DIR, 'prisma', 'migrations'))
        migDirs.forEach(function(name) {
          var fullPath = path.join(APP_DIR, 'prisma', 'migrations', name)
          if (fs.statSync(fullPath).isDirectory()) {
            log('    Marking as applied: ' + name)
            run('npx prisma migrate resolve --applied ' + name, APP_DIR, 30)
          }
        })
        // db push creates any missing tables the baselined migrations would have created
        log('  Running db push to create missing tables...')
        run('npx prisma db push', APP_DIR, 180)
        migrateOk = true
        steps.push('prisma migrate (baselined + db push) OK')
      } catch (baseErr) {
        steps.push('prisma migrate baseline FAIL')
        log('  Baseline error: ' + (baseErr.message || '').slice(0, 200))
      }
    } else {
      steps.push('prisma migrate FAIL')
      log('  ' + migrateErr.slice(0, 300))
    }
  }

  // Also migrate Neon cloud database (if configured for offline-first mode)
  if (env.NEON_DATABASE_URL) {
    step('neon-pre-migrate', 'NEON_MIGRATE=true node scripts/nuc-pre-migrate.js', true, 180)
    step('neon-db-push', 'DATABASE_URL=' + JSON.stringify(env.NEON_DATABASE_URL) + ' npx prisma db push', true, 180)
  }
  if (!step('build', 'npm run build', false, 600)) {
    return { ok: false, error: 'build failed', steps: steps }
  }
  // Try current service name (thepasspos), fall back to legacy (pulse-pos)
  log('  restart...')
  var restartOk = run('sudo systemctl restart thepasspos', APP_DIR, 30)
  if (!restartOk) restartOk = run('sudo systemctl restart pulse-pos', APP_DIR, 30)
  steps.push('restart' + (restartOk ? ' OK' : ' FAIL'))
  if (!restartOk) {
    return { ok: false, error: 'restart failed', steps: steps }
  }

  selfUpdateSyncAgent()

  var ver = 'unknown'
  try { ver = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf-8')).version } catch (e) {}
  log('[Update] SUCCESS — v' + ver)
  return { ok: true, version: ver, steps: steps }
}

// ── Self-update sync agent from repo ──────────────────────────────────────
function selfUpdateSyncAgent() {
  try {
    var newAgentPath = path.join(APP_DIR, 'public', 'sync-agent.js')
    if (fs.existsSync(newAgentPath)) {
      fs.copyFileSync(newAgentPath, '/opt/gwi-pos/sync-agent.js')
      log('[Update] Sync agent self-updated from repo')
      // Restart pulse-sync 15s after ACK is sent (gives time for ACK delivery)
      setTimeout(function() {
        log('[Update] Restarting sync agent with updated version...')
        var syncOk = run('sudo systemctl restart thepasspos-sync', APP_DIR, 30)
        if (!syncOk) run('sudo systemctl restart pulse-sync', APP_DIR, 30)
      }, 15000)
    }
  } catch (e) {
    log('[Update] WARNING: Could not self-update sync agent: ' + e.message)
  }
}

// ── Command ACK ────────────────────────────────────────────────────────────
function ack(cmdId, result) {
  var body = result.ok
    ? { status: 'COMPLETED', resultPayload: { version: result.version, steps: result.steps } }
    : { status: 'FAILED', errorMessage: result.error || 'Unknown', resultPayload: { steps: result.steps } }
  postJson('/api/fleet/commands/' + cmdId + '/ack', body)
    .then(function(r) { log('[Sync] ACK ' + body.status + ' (HTTP ' + r.status + ')') })
    .catch(function(e) { log('[Sync] ACK failed: ' + e.message) })
}

// ── Process received command ───────────────────────────────────────────────
async function processCommand(dataStr) {
  try {
    var cmd = JSON.parse(dataStr)
    log('[Sync] Command: ' + cmd.type + ' (' + cmd.id + ')')

    var result
    if (cmd.type === 'FORCE_UPDATE') {
      result = handleForceUpdate(cmd.payload || {})
    } else if (cmd.type === 'DATA_CHANGED') {
      var domain = (cmd.payload && cmd.payload.domain) || 'unknown'
      var models = (cmd.payload && Array.isArray(cmd.payload.models)) ? cmd.payload.models : null
      log('[Sync] DATA_CHANGED for domain: ' + domain + (models ? ' models: ' + models.join(',') : ''))

      if (domain === 'settings') {
        try {
          var settingsRes = await getJson('/api/fleet/sync/settings')
          if (settingsRes.status === 200) {
            var data = JSON.parse(settingsRes.body)
            var payload = data.data || data  // MC wraps in { data: ... }
            var settings = payload.settings
            var version = payload.settingsVersion || 'unknown'
            // Push settings to local POS
            var localRes = await putJsonLocal('/api/settings', { settings: settings })
            if (localRes.status === 200) {
              log('[Sync] Settings applied locally, version ' + version)
              result = { ok: true, settingsVersion: version }
            } else {
              log('[Sync] Local settings update failed: HTTP ' + localRes.status)
              result = { ok: false, error: 'local-update-failed' }
            }
          } else {
            log('[Sync] Failed to fetch settings from MC: HTTP ' + settingsRes.status)
            result = { ok: false, error: 'fetch-failed' }
          }
        } catch (err) {
          log('[Sync] Settings sync error: ' + err.message)
          result = { ok: false, error: err.message }
        }
      } else {
        log('[Sync] Unhandled DATA_CHANGED domain: ' + domain)
        result = { ok: true }
      }

      // Trigger immediate downstream sync for any DATA_CHANGED event
      // If models are specified, pass them for targeted model-specific sync
      try {
        var triggerPayload = { domain: domain }
        if (models) {
          triggerPayload.models = models
        }
        await postJsonLocal('/api/internal/trigger-sync', triggerPayload)
        log('[Sync] Triggered immediate downstream sync for domain: ' + domain + (models ? ' (' + models.length + ' models)' : ''))
      } catch (triggerErr) {
        log('[Sync] Failed to trigger downstream sync: ' + triggerErr.message)
      }
    } else if (cmd.type === 'UPDATE_PAYMENT_CONFIG') {
      try {
        var encryptedPayload = cmd.payload && cmd.payload.encrypted
        if (!encryptedPayload) {
          log('[Sync] UPDATE_PAYMENT_CONFIG: missing encrypted payload')
          result = { ok: false, error: 'missing-payload' }
        } else {
          // RSA-OAEP decrypt using server private key (matches MC's rsaEncrypt)
          var privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8')
          var decryptedBuf = crypto.privateDecrypt(
            { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
            Buffer.from(encryptedPayload, 'base64')
          )
          var paymentConfig = JSON.parse(decryptedBuf.toString('utf-8'))
          // Push decrypted credentials to local POS
          var pcRes = await putJsonLocal('/api/payment-config', paymentConfig)
          if (pcRes.status === 200) {
            log('[Sync] Payment config updated — processor=' + paymentConfig.processor + ' env=' + paymentConfig.environment)
            result = { ok: true }
          } else {
            log('[Sync] Local payment-config update failed: HTTP ' + pcRes.status)
            result = { ok: false, error: 'local-update-failed' }
          }
        }
      } catch (err) {
        log('[Sync] UPDATE_PAYMENT_CONFIG error: ' + err.message)
        result = { ok: false, error: err.message }
      }
    } else if (cmd.type === 'CONFIGURE_SYNC') {
      try {
        var encNeonUrl = cmd.payload && cmd.payload.encryptedNeonDatabaseUrl
        var encNeonDirect = cmd.payload && cmd.payload.encryptedNeonDirectUrl
        if (!encNeonUrl || !encNeonDirect) {
          log('[Sync] CONFIGURE_SYNC: missing encrypted payload fields')
          result = { ok: false, error: 'missing-payload' }
        } else {
          // RSA-OAEP decrypt using server private key (same pattern as UPDATE_PAYMENT_CONFIG)
          var privKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8')
          var decryptOpts = { key: privKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }
          var neonDatabaseUrl = crypto.privateDecrypt(decryptOpts, Buffer.from(encNeonUrl, 'base64')).toString('utf-8')
          var neonDirectUrl = crypto.privateDecrypt(decryptOpts, Buffer.from(encNeonDirect, 'base64')).toString('utf-8')

          // Read current .env
          var envContent = ''
          try { envContent = fs.readFileSync(ENV_FILE, 'utf-8') } catch (e) {}
          var envLines = envContent.split('\n')

          // Helper: replace existing key or append
          function setEnvVar(lines, key, value) {
            var found = false
            for (var i = 0; i < lines.length; i++) {
              if (lines[i].indexOf(key + '=') === 0) {
                lines[i] = key + '=' + value
                found = true
                break
              }
            }
            if (!found) lines.push(key + '=' + value)
            return lines
          }

          envLines = setEnvVar(envLines, 'NEON_DATABASE_URL', neonDatabaseUrl)
          envLines = setEnvVar(envLines, 'NEON_DIRECT_URL', neonDirectUrl)
          envLines = setEnvVar(envLines, 'SYNC_ENABLED', 'true')

          // Write updated .env
          fs.writeFileSync(ENV_FILE, envLines.join('\n'))
          log('[Sync] CONFIGURE_SYNC: .env updated with Neon URLs + SYNC_ENABLED=true')

          // Copy .env to app directory (same as handleForceUpdate)
          try { fs.copyFileSync(ENV_FILE, path.join(APP_DIR, '.env')) } catch (e) {}
          try { fs.copyFileSync(ENV_FILE, path.join(APP_DIR, '.env.local')) } catch (e) {}

          // Restart POS service to pick up new config
          log('[Sync] CONFIGURE_SYNC: restarting POS service...')
          var csOk = run('sudo systemctl restart thepasspos', APP_DIR, 30)
          if (!csOk) csOk = run('sudo systemctl restart pulse-pos', APP_DIR, 30)

          // Update in-memory env so heartbeat picks up the change immediately
          env.NEON_DATABASE_URL = neonDatabaseUrl
          env.NEON_DIRECT_URL = neonDirectUrl
          env.SYNC_ENABLED = 'true'

          log('[Sync] CONFIGURE_SYNC: complete (restart=' + (csOk ? 'OK' : 'FAIL') + ')')
          result = { ok: true }
        }
      } catch (err) {
        log('[Sync] CONFIGURE_SYNC error: ' + err.message)
        result = { ok: false, error: err.message }
      }
    } else if (cmd.type === 'RE_PROVISION') {
      // Re-provision = full update cycle (same as FORCE_UPDATE)
      result = handleForceUpdate(cmd.payload || {})
    } else if (cmd.type === 'RELOAD_TERMINALS') {
      // Restart POS service to force all connected terminals to reconnect
      log('[Sync] RELOAD_TERMINALS — restarting POS service...')
      var rlOk = run('sudo systemctl restart thepasspos', APP_DIR, 30)
      if (!rlOk) rlOk = run('sudo systemctl restart pulse-pos', APP_DIR, 30)
      result = { ok: rlOk }
    } else if (cmd.type === 'RELOAD_TERMINAL') {
      // Single terminal reload — same effect as RELOAD_TERMINALS on NUC
      log('[Sync] RELOAD_TERMINAL — restarting POS service...')
      var rtOk = run('sudo systemctl restart thepasspos', APP_DIR, 30)
      if (!rtOk) rtOk = run('sudo systemctl restart pulse-pos', APP_DIR, 30)
      result = { ok: rtOk }
    } else if (cmd.type === 'RESTART_KIOSK') {
      log('[Sync] RESTART_KIOSK — restarting kiosk service...')
      var rkOk = run('sudo systemctl restart thepasspos-kiosk', APP_DIR, 30)
      if (!rkOk) rkOk = run('sudo systemctl restart pulse-kiosk', APP_DIR, 30)
      result = { ok: rkOk }
    } else if (cmd.type === 'KILL_SWITCH') {
      log('[Sync] KILL_SWITCH received — acknowledged')
      result = { ok: true }
    } else if (cmd.type === 'SCHEDULE_REBOOT') {
      var delayMin = (cmd.payload && cmd.payload.delayMinutes) || 15
      log('[Sync] Scheduling reboot in ' + delayMin + ' minutes')
      var ok = run('sudo shutdown -r +' + delayMin, APP_DIR, 30)
      result = { ok: ok, scheduledRebootIn: delayMin }
    } else if (cmd.type === 'CANCEL_REBOOT') {
      log('[Sync] Cancelling scheduled reboot')
      run('sudo shutdown -c', APP_DIR, 10)
      result = { ok: true }
    } else if (cmd.type === 'REPAIR_GIT_CREDENTIALS') {
      try {
        var token = cmd.payload && cmd.payload.deployToken
        if (!token || typeof token !== 'string' || token.length < 10) {
          log('[Sync] REPAIR_GIT_CREDENTIALS: missing or invalid deployToken')
          result = { ok: false, error: 'missing-deploy-token' }
        } else {
          var credContent = 'https://' + token + ':x-oauth-basic@github.com\n'
          fs.writeFileSync('/opt/gwi-pos/.git-credentials', credContent, { mode: 0o600 })
          log('[Sync] REPAIR_GIT_CREDENTIALS: credentials file updated')
          var fetchOk = run('git fetch origin', APP_DIR, 60)
          if (fetchOk) {
            log('[Sync] REPAIR_GIT_CREDENTIALS: git fetch OK — credentials valid')
            result = { ok: true }
          } else {
            log('[Sync] REPAIR_GIT_CREDENTIALS: git fetch failed after credential update')
            result = { ok: false, error: 'git-fetch-failed-after-update' }
          }
        }
      } catch (e) {
        log('[Sync] REPAIR_GIT_CREDENTIALS error: ' + e.message)
        result = { ok: false, error: e.message }
      }
    } else {
      log('[Sync] Unknown command: ' + cmd.type + ', ACK OK')
      result = { ok: true }
    }
    ack(cmd.id, result)
  } catch (e) {
    log('[Sync] Error processing command: ' + e.message)
  }
}

// ── SSE Stream ─────────────────────────────────────────────────────────────
var reconnectDelay = 1000

function connectStream() {
  var url = new URL('/api/fleet/commands/stream', MC_URL)
  var mod = url.protocol === 'https:' ? https : http

  log('[Sync] Connecting to ' + MC_URL + '...')

  var req = mod.get(url, { headers: authHeaders('') }, function(res) {
    if (res.statusCode !== 200) {
      log('[Sync] Stream HTTP ' + res.statusCode)
      scheduleReconnect()
      return
    }

    log('[Sync] Connected to command stream')
    reconnectDelay = 1000

    var buf = ''
    var evt = {}

    res.on('data', function(chunk) {
      buf += chunk.toString()
      var lines = buf.split('\n')
      buf = lines.pop() // keep incomplete last line

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i]
        if (line.startsWith(':')) continue  // keepalive comment
        if (line === '') {
          // End of event
          if (evt.event === 'command' && evt.data) {
            processCommand(evt.data).catch(function(e) { log('[Sync] Command error: ' + e.message) })
          } else if (evt.data) {
            log('[SSE] Ignoring non-command event: ' + (evt.event || 'none'))
          }
          evt = {}
          continue
        }
        var ci = line.indexOf(': ')
        if (ci < 0) {
          // SSE field without ": " separator — log for debugging
          if (line.trim().length > 0) {
            log('[SSE] Unparseable line: ' + line.slice(0, 200))
          }
          continue
        }
        var field = line.slice(0, ci)
        var value = line.slice(ci + 2)
        if (field === 'id') evt.id = value
        else if (field === 'event') evt.event = value
        else if (field === 'data') evt.data = (evt.data ? evt.data + '\n' + value : value)  // support multi-line data
      }
    })

    res.on('end', function() {
      log('[Sync] Stream ended, reconnecting...')
      scheduleReconnect()
    })

    res.on('error', function(err) {
      log('[Sync] Stream error: ' + err.message)
      scheduleReconnect()
    })
  })

  req.on('error', function(err) {
    log('[Sync] Connection error: ' + err.message)
    scheduleReconnect()
  })
}

function scheduleReconnect() {
  log('[Sync] Reconnect in ' + (reconnectDelay / 1000) + 's')
  setTimeout(connectStream, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, 60000)
}

// ── Boot self-update ────────────────────────────────────────────────────────
// On every startup: download the latest sync-agent.js from GitHub and replace
// the running file only if the content has changed. If it does change, exits
// with code 0 so systemd (Restart=always) picks up the new file immediately.
// Falls through silently on any network or credential error.
var CREDS_FILE = '/opt/gwi-pos/.git-credentials'
var SELF_PATH  = '/opt/gwi-pos/sync-agent.js'

function checkBootUpdate(done) {
  // Guard: ensure done() is called at most once regardless of error/timeout interplay
  var settled = false
  function finish() { if (!settled) { settled = true; done() } }

  try {
    if (!fs.existsSync(CREDS_FILE)) {
      log('[Boot] No credentials file — skipping self-update check')
      return finish()
    }
    var creds = fs.readFileSync(CREDS_FILE, 'utf-8')
    var m = creds.match(/https:\/\/([^:]+):x-oauth-basic@github\.com/)
    if (!m) {
      log('[Boot] Could not parse token from credentials — skipping self-update check')
      return finish()
    }
    var token = m[1]
    var opts = {
      hostname: 'api.github.com',
      path: '/repos/GetwithitMan/gwi-pos/contents/public/sync-agent.js',
      headers: {
        'Authorization': 'token ' + token,
        'Accept': 'application/vnd.github.raw',
        'User-Agent': 'gwi-sync-agent-boot',
      },
    }
    var req = https.get(opts, function(res) {
      if (res.statusCode !== 200) {
        log('[Boot] Self-update check HTTP ' + res.statusCode + ' — skipping')
        res.resume()
        return finish()
      }
      var chunks = []
      res.on('data', function(c) { chunks.push(c) })
      res.on('end', function() {
        try {
          var latest = Buffer.concat(chunks).toString('utf-8')
          // Refuse to apply an empty file — something went wrong with the download
          if (latest.trim().length < 100) {
            log('[Boot] Downloaded file too small — skipping update')
            return finish()
          }
          var current = ''
          try { current = fs.readFileSync(SELF_PATH, 'utf-8') } catch (e) {}
          if (latest === current) {
            log('[Boot] Sync agent is up to date')
            return finish()
          }
          log('[Boot] Sync agent update available — applying and restarting...')
          fs.writeFileSync(SELF_PATH + '.tmp', latest, { mode: 0o755 })
          fs.renameSync(SELF_PATH + '.tmp', SELF_PATH)
          log('[Boot] Updated. Exiting for systemd restart...')
          process.exit(0)
        } catch (e) {
          log('[Boot] Self-update apply error: ' + e.message + ' — continuing')
          finish()
        }
      })
    })
    req.on('error', function(e) {
      log('[Boot] Self-update network error: ' + e.message + ' — continuing')
      finish()
    })
    req.setTimeout(15000, function() {
      log('[Boot] Self-update timed out — continuing')
      req.destroy()
      // finish() will be called by the error handler triggered by destroy,
      // but the settled guard ensures it only runs once
    })
  } catch (e) {
    log('[Boot] Self-update unexpected error: ' + e.message + ' — continuing')
    finish()
  }
}

// ── Backfill cloud identity from env vars to POS database (runs once at startup) ──
function backfillCloudIdentity() {
  var cloudLocationId = env.CLOUD_LOCATION_ID
  var internalSecret = env.INTERNAL_API_SECRET
  if (!cloudLocationId || !internalSecret) return Promise.resolve()

  var body = JSON.stringify({
    cloudLocationId: cloudLocationId,
    cloudOrganizationId: env.CLOUD_ORGANIZATION_ID || null,
    cloudEnterpriseId: env.CLOUD_ENTERPRISE_ID || null,
  })
  return new Promise(function(resolve) {
    var url = new URL('/api/internal/cloud-identity', 'http://localhost:3005')
    var req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + internalSecret,
      },
    }, function(res) {
      var d = ''
      res.on('data', function(c) { d += c })
      res.on('end', function() {
        if (res.statusCode === 200) {
          log('[sync-agent] Cloud identity backfilled to POS')
        }
        resolve()
      })
    })
    req.on('error', function() {
      // Non-blocking — POS might not be ready yet. heartbeat.sh will retry.
      resolve()
    })
    req.setTimeout(5000, function() { req.destroy(); resolve() })
    req.write(body)
    req.end()
  })
}

// ── Start ──────────────────────────────────────────────────────────────────
log('[Sync] GWI POS Sync Agent started')
log('[Sync] MC: ' + MC_URL + '  Node: ' + NODE_ID)
checkBootUpdate(function() {
  backfillCloudIdentity().then(function() {
    connectStream()
  })
})

// Trim log periodically (every hour)
setInterval(function() {
  try {
    var lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n')
    if (lines.length > 1000) {
      fs.writeFileSync(LOG_FILE, lines.slice(-500).join('\n'))
    }
  } catch (e) {}
}, 3600000)
