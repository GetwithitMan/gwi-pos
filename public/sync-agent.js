// GWI POS Sync Agent — receives fleet commands from Mission Control
// Runs as the gwi-agent container (same image as gwi-pos, different CMD).
// Updates atomically with gwi-pos when gwi-node deploys a new image.
// No npm dependencies — native Node.js only.
'use strict'
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ENV_FILE         = fs.existsSync('/opt/gwi-pos/shared/.env') ? '/opt/gwi-pos/shared/.env' : '/opt/gwi-pos/.env'
const APP_DIR          = fs.existsSync('/opt/gwi-pos/current') ? '/opt/gwi-pos/current' : '/opt/gwi-pos/app'
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
    var headers = { 'Content-Type': 'application/json' }
    // Auth for internal endpoints (e.g., /api/system/update)
    if (env.INTERNAL_API_SECRET) {
      headers['Authorization'] = 'Bearer ' + env.INTERNAL_API_SECRET
    }
    var req = http.request(url, { method: 'POST', headers: headers }, function(res) {
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

// ── Deploy failure classifier ─────────────────────────────────────────────
// Maps deploy-release.sh exit state to a structured failure reason for MC.
function classifyDeployFailure(deployState, exitMessage) {
  var reason = 'FAILED_DEPLOY_SCRIPT'
  if (deployState === 'rolled_back') reason = 'FAILED_DEPLOY_SCRIPT'
  else if (deployState === 'rollback_failed') reason = 'FAILED_DEPLOY_SCRIPT'
  else if (/schema|migrat/i.test(exitMessage || '')) reason = 'FAILED_SCHEMA'
  else if (/readiness|health/i.test(exitMessage || '')) reason = 'FAILED_READINESS'
  else if (/verify|checksum|signature|minisign/i.test(exitMessage || '')) reason = 'FAILED_ARTIFACT_VERIFY'
  return reason
}

// ── FORCE_UPDATE handler ───────────────────────────────────────────────────
// Phase 8.2: First tries version-targeted update via local update agent
// (preflight checks, payment safety, cloud event reporting).
// Falls back to direct update if local POS server is unreachable.
async function handleForceUpdate(payload, cmdId) {
  var targetVersion = (payload && payload.version) || null
  currentAttemptId = generateAttemptId()

  // Get current version for state tracking
  var previousVersion = 'unknown'
  try { previousVersion = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf-8')).version } catch (e) {}

  if (cmdId) ackProgress(cmdId, 'IN_PROGRESS', { step: 'starting', targetVersion: targetVersion, previousVersion: previousVersion })

  // Version compatibility check — advisory only, NEVER blocks the update
  // If we can't determine compatibility, proceed anyway. A failed update
  // can be rolled back; a blocked update leaves the venue on old code forever.
  var versionCompat = '/opt/gwi-pos/scripts/version-compat.sh'
  if (fs.existsSync(versionCompat)) {
    try {
      var currentSchema = getCurrentSchemaVersion()
      var targetSchema = (payload && payload.targetSchemaVersion) || ''
      var currentApp = getCurrentAppVersion()
      var targetApp = targetVersion || ''

      // Only run if we have valid numeric schema versions
      if (currentSchema && targetSchema && /^\d+$/.test(currentSchema) && /^\d+$/.test(targetSchema)) {
        execSync('bash ' + versionCompat + ' "' + currentSchema + '" "' + targetSchema + '" "' + currentApp + '" "' + targetApp + '"', {
          encoding: 'utf-8',
          timeout: 10000
        })
        log('Version compatibility check passed')
      } else {
        log('Version compat: schema versions not both numeric (current=' + currentSchema + ', target=' + targetSchema + ') — proceeding with update')
      }
    } catch (err) {
      // ADVISORY ONLY — log the warning but ALWAYS proceed with the update
      log('Version compatibility WARNING: ' + (err.message || '').slice(0, 200))
      log('Proceeding with update anyway (compat check is advisory)')
    }
  }

  // ── Deploy via gwi-node (single bootstrap agent) ────────────────────────
  var GWI_NODE = process.env.GWI_NODE_PATH || '/opt/gwi-pos/gwi-node.sh'

  // Self-update gwi-node from the running image before deploy
  try {
    run('bash "' + GWI_NODE + '" self-update', APP_DIR, 30)
  } catch (e) {
    log('[Update] gwi-node self-update warning: ' + e.message)
  }

  if (!fs.existsSync(GWI_NODE)) {
    // Bootstrap: extract gwi-node from current release if it exists
    var bootstrapPath = path.join(APP_DIR, 'public', 'scripts', 'gwi-node.sh')
    if (fs.existsSync(bootstrapPath)) {
      try {
        fs.copyFileSync(bootstrapPath, GWI_NODE)
        fs.chmodSync(GWI_NODE, 0o755)
        log('[Update] Bootstrapped gwi-node.sh from release')
      } catch (e) {
        log('[Update] Bootstrap failed: ' + e.message)
      }
    }
  }

  if (!fs.existsSync(GWI_NODE)) {
    // Fatal: no gwi-node.sh anywhere
    var result = { ok: false, error: 'gwi-node.sh not found — run installer', steps: ['missing-agent'] }
    if (cmdId) ackProgress(cmdId, 'FAILED', { step: 'missing-agent', error: result.error })
    return result
  }

  log('[Update] Deploying via gwi-node...')
  if (cmdId) ackProgress(cmdId, 'IN_PROGRESS', { step: 'gwi-node-deploy', targetVersion: targetVersion })

  try {
    execSync('bash "' + GWI_NODE + '" deploy', {
      cwd: APP_DIR,
      encoding: 'utf-8',
      timeout: 600000,
      stdio: 'pipe'
    })
    log('[Update] gwi-node deploy completed')

    // Read deploy result
    var newVersion = previousVersion
    try {
      var vf = JSON.parse(fs.readFileSync('/opt/gwi-pos/shared/state/running-version.json', 'utf-8'))
      newVersion = vf.version || previousVersion
    } catch (e) {}

    // Self-update sync-agent from new image
    try { selfUpdateSyncAgent() } catch (e) {}

    if (cmdId) ackProgress(cmdId, 'COMPLETED', {
      step: 'gwi-node-deploy-done',
      version: newVersion
    })
    return { ok: true, version: newVersion, steps: ['gwi-node-deploy OK'], _acked: true }
  } catch (deployErr) {
    log('[Update] gwi-node deploy FAILED: ' + (deployErr.message || '').slice(0, 300))

    // Read deploy log for failure details
    var failError = (deployErr.message || '').slice(0, 200)
    if (cmdId) ackProgress(cmdId, 'FAILED', {
      step: 'gwi-node-deploy-failed',
      error: failError
    })
    return { ok: false, error: failError, steps: ['gwi-node-deploy-failed'], _acked: true }
  }
}

// ── Self-update sync agent ────────────────────────────────────────────────
// No-op: sync-agent runs in a container (gwi-agent) and updates automatically
// when gwi-node deploys a new image and restarts the gwi-agent container.
function selfUpdateSyncAgent() {
  log('[Update] Sync agent is containerized — self-update is automatic')
}

// ── Component updates from checkout ────────────────────────────────────────
// When running in container (gwi-agent), host-level component updates
// (dashboard, watchdog, monitoring) are handled by gwi-node, not the agent.
function updateComponentsFromCheckout() {
  if (process.env.GWI_NODE_PATH) {
    log('[Components] Running in container — host component updates handled by gwi-node')
    return { _updated: false }
  }
  var result = { _updated: false, dashboard: null, monitoring: false, watchdog: false }

  // Dashboard .deb update (version-aware)
  try {
    var installedVer = ''
    try { installedVer = execSync('dpkg-query -W -f="${Version}" gwi-nuc-dashboard 2>/dev/null || echo "0.0.0"', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim() } catch (e) { installedVer = '0.0.0' }
    var availableVer = '0.0.0'
    var versionFile = path.join(APP_DIR, 'public', 'dashboard-version.txt')
    if (fs.existsSync(versionFile)) {
      availableVer = fs.readFileSync(versionFile, 'utf-8').trim()
    }
    var debPath = path.join(APP_DIR, 'public', 'gwi-nuc-dashboard.deb')
    if (installedVer !== availableVer && availableVer !== '0.0.0' && fs.existsSync(debPath)) {
      log('[Components] Dashboard update: ' + installedVer + ' -> ' + availableVer)
      var ok = run('dpkg -i "' + debPath + '" 2>/dev/null || apt-get install -f -y', APP_DIR, 60)
      if (ok) {
        run('pkill -f gwi-dashboard || true', APP_DIR, 5)
        // Restart dashboard via systemd (if service exists) or direct launch
        run('su - ' + (process.env.POSUSER || 'gwipos') + ' -c "export XDG_RUNTIME_DIR=/run/user/$(id -u); export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus; systemctl --user restart gwi-dashboard.service 2>/dev/null || DISPLAY=:0 nohup $(which gwi-dashboard 2>/dev/null || which gwi-nuc-dashboard 2>/dev/null || echo /usr/bin/gwi-dashboard) >/dev/null 2>&1 &"', APP_DIR, 10)
        result.dashboard = { from: installedVer, to: availableVer, updated: true }
        result._updated = true
        log('[Components] Dashboard updated and restarted')
      }
    } else {
      result.dashboard = { from: installedVer, to: installedVer, updated: false }
    }
  } catch (e) {
    log('[Components] Dashboard update failed: ' + (e.message || '').slice(0, 200))
  }

  // Monitoring scripts
  try {
    var scripts = [
      { src: 'public/watchdog.sh', dest: '/opt/gwi-pos/watchdog.sh' },
      { src: 'public/scripts/hardware-inventory.sh', dest: '/opt/gwi-pos/scripts/hardware-inventory.sh' },
      { src: 'public/scripts/disk-pressure-monitor.sh', dest: '/opt/gwi-pos/scripts/disk-pressure-monitor.sh' },
      { src: 'public/scripts/version-compat.sh', dest: '/opt/gwi-pos/scripts/version-compat.sh' },
      { src: 'public/scripts/rolling-restart.sh', dest: '/opt/gwi-pos/scripts/rolling-restart.sh' }
    ]
    scripts.forEach(function(s) {
      var srcPath = path.join(APP_DIR, s.src)
      if (fs.existsSync(srcPath)) {
        run('sudo mkdir -p "$(dirname ' + s.dest + ')" && sudo cp "' + srcPath + '" "' + s.dest + '" && sudo chmod +x "' + s.dest + '"', APP_DIR, 10)
        result.monitoring = true
        result._updated = true
      }
    })

    // Deploy installer libraries
    var libDir = path.join(APP_DIR, 'public', 'installer-modules', 'lib')
    if (fs.existsSync(libDir)) {
      run('sudo mkdir -p /opt/gwi-pos/installer-modules/lib && sudo cp "' + libDir + '"/*.sh /opt/gwi-pos/installer-modules/lib/ && sudo chmod +x /opt/gwi-pos/installer-modules/lib/*.sh', APP_DIR, 10)
    }
    log('[Components] Monitoring scripts updated')
  } catch (e) {
    log('[Components] Script update failed: ' + (e.message || '').slice(0, 200))
  }

  // Watchdog timer activation
  try {
    var timerStatus = ''
    try { timerStatus = execSync('systemctl is-active gwi-watchdog.timer 2>/dev/null || echo inactive', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim() } catch (e) { timerStatus = 'inactive' }
    if (timerStatus !== 'active' && fs.existsSync('/opt/gwi-pos/watchdog.sh')) {
      var svcSrc = path.join(APP_DIR, 'public', 'watchdog.service')
      var timerSrc = path.join(APP_DIR, 'public', 'watchdog.timer')
      if (fs.existsSync(svcSrc) && fs.existsSync(timerSrc)) {
        run('sudo cp "' + svcSrc + '" /etc/systemd/system/gwi-watchdog.service; sudo cp "' + timerSrc + '" /etc/systemd/system/gwi-watchdog.timer; sudo systemctl daemon-reload; sudo systemctl enable --now gwi-watchdog.timer', APP_DIR, 15)
        result.watchdog = true
        result._updated = true
        log('[Components] Watchdog timer activated')
      }
    } else {
      result.watchdog = timerStatus === 'active'
    }
  } catch (e) {
    log('[Components] Watchdog activation failed: ' + (e.message || '').slice(0, 200))
  }

  // Ansible baseline enforcement — ensures hardening is current after every update
  // Non-fatal — direct hardening fallback in the script covers critical items
  try {
    var hardeningScript = path.join(APP_DIR, 'public', 'installer-modules', '11-system-hardening.sh')
    if (fs.existsSync(hardeningScript)) {
      log('[Components] Running Ansible baseline enforcement...')
      var hardenEnv = Object.assign({}, process.env, {
        APP_BASE: '/opt/gwi-pos',
        APP_DIR: APP_DIR,
        POSUSER: process.env.POSUSER || 'gwipos',
        STATION_ROLE: process.env.STATION_ROLE || 'server'
      })
      execSync('bash "' + hardeningScript + '"', {
        encoding: 'utf-8',
        timeout: 600000,  // 10 min
        env: hardenEnv
      })
      log('[Components] Ansible baseline completed')
    }
  } catch (e) {
    log('[Components] Ansible baseline failed (non-fatal): ' + (e.message || '').slice(0, 200))
  }

  return result
}

// ── Command ACK ────────────────────────────────────────────────────────────
var currentAttemptId = null

function generateAttemptId() {
  return crypto.randomBytes(8).toString('hex')
}

function ack(cmdId, result) {
  var body = result.ok
    ? { status: 'COMPLETED', resultPayload: { version: result.version, steps: result.steps } }
    : { status: 'FAILED', errorMessage: result.error || 'Unknown', resultPayload: { steps: result.steps } }
  postJson('/api/fleet/commands/' + cmdId + '/ack', body)
    .then(function(r) { log('[Sync] ACK ' + body.status + ' (HTTP ' + r.status + ')') })
    .catch(function(e) { log('[Sync] ACK failed: ' + e.message) })
}

function ackProgress(cmdId, status, payload) {
  if (!payload) payload = {}
  payload.attemptId = currentAttemptId
  payload.commandId = cmdId
  payload.timestamp = new Date().toISOString()
  var body = { status: status, resultPayload: payload }
  if (payload.error) body.errorMessage = payload.error
  postJson('/api/fleet/commands/' + cmdId + '/ack', body)
    .then(function(r) { log('[Sync] ACK ' + status + ' (HTTP ' + r.status + ')') })
    .catch(function(e) { log('[Sync] ACK failed: ' + e.message) })
}

// ── Update state persistence ──────────────────────────────────────────────
function writeUpdateState(data) {
  try {
    fs.mkdirSync('/opt/gwi-pos/state', { recursive: true })
    fs.writeFileSync('/opt/gwi-pos/state/last-update.json', JSON.stringify(data, null, 2))
  } catch (e) {
    log('[Update] Failed to write state: ' + e.message)
  }
}

// ── Version helpers ──────────────────────────────────────────────────────
function getCurrentSchemaVersion() {
  try {
    // Read from _gwi_migrations table count, or from last migration file
    var migrationsDir = path.join(APP_DIR, 'scripts', 'migrations')
    if (fs.existsSync(migrationsDir)) {
      var files = fs.readdirSync(migrationsDir).filter(function(f) { return /^\d{3}-/.test(f) }).sort()
      return files.length > 0 ? (files[files.length - 1].match(/^(\d{3})/) || [])[1] || '000' : '000'
    }
    return '000'
  } catch (e) { return '000' }
}

function getCurrentAppVersion() {
  // Priority 1: running-version.json (authoritative, written by deploy-release.sh)
  try {
    var rv = JSON.parse(fs.readFileSync('/opt/gwi-pos/shared/state/running-version.json', 'utf-8'))
    if (rv.version) return rv.version
  } catch (e) { /* fall through */ }
  // Priority 2: /opt/gwi-pos/current/package.json (symlink to active release)
  try {
    var pkg = JSON.parse(fs.readFileSync('/opt/gwi-pos/current/package.json', 'utf-8'))
    if (pkg.version) return pkg.version
  } catch (e) { /* fall through */ }
  // Priority 3: unknown
  return 'unknown'
}

// ── Process received command ───────────────────────────────────────────────
async function processCommand(dataStr) {
  try {
    var cmd = JSON.parse(dataStr)
    log('[Sync] Command: ' + cmd.type + ' (' + cmd.id + ')')

    var result
    if (cmd.type === 'FORCE_UPDATE') {
      result = await handleForceUpdate(cmd.payload || {}, cmd.id)
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

          // Restart POS container to pick up new config
          log('[Sync] CONFIGURE_SYNC: restarting POS container...')
          var csOk = run('docker restart gwi-pos', APP_DIR, 30)

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
      result = await handleForceUpdate(cmd.payload || {}, cmd.id)
    } else if (cmd.type === 'RELOAD_TERMINALS') {
      // Restart POS container to force all connected terminals to reconnect
      log('[Sync] RELOAD_TERMINALS — restarting POS container...')
      var rlOk = run('docker restart gwi-pos', APP_DIR, 30)
      result = { ok: rlOk }
    } else if (cmd.type === 'RELOAD_TERMINAL') {
      // Single terminal reload — same effect as RELOAD_TERMINALS on NUC
      log('[Sync] RELOAD_TERMINAL — restarting POS container...')
      var rtOk = run('docker restart gwi-pos', APP_DIR, 30)
      result = { ok: rtOk }
    } else if (cmd.type === 'RESTART_KIOSK') {
      log('[Sync] RESTART_KIOSK — restarting kiosk container...')
      var rkOk = run('docker restart thepasspos-kiosk', APP_DIR, 30)
      if (!rkOk) rkOk = run('docker restart pulse-kiosk', APP_DIR, 30)
      result = { ok: rkOk }
    } else if (cmd.type === 'KILL_SWITCH') {
      log('[Sync] KILL_SWITCH received — acknowledged')
      result = { ok: true }
    } else if (cmd.type === 'SCHEDULE_REBOOT') {
      var delayMin = (cmd.payload && cmd.payload.delayMinutes) || 15
      log('[Sync] Scheduling reboot in ' + delayMin + ' minutes')
      var ok = run('shutdown -r +' + delayMin, APP_DIR, 30)
      result = { ok: ok, scheduledRebootIn: delayMin }
    } else if (cmd.type === 'CANCEL_REBOOT') {
      log('[Sync] Cancelling scheduled reboot')
      run('shutdown -c', APP_DIR, 10)
      result = { ok: true }
    } else if (cmd.type === 'RUN_BASELINE') {
      // MC sends RUN_BASELINE command to run Ansible hardening baseline
      // This is Stage 11 (system-hardening.sh) from the installer
      log('Received RUN_BASELINE command from MC')
      currentAttemptId = generateAttemptId()
      ackProgress(cmd.id, 'IN_PROGRESS', { step: 'baseline_start' })

      try {
        var baselinePath = '/opt/gwi-pos/installer-modules/11-system-hardening.sh'

        if (!fs.existsSync(baselinePath)) {
          throw new Error('Stage 11 script not found at ' + baselinePath)
        }

        // Optional: accept specific tags from MC command
        var tags = (cmd.payload && cmd.payload.tags) || ''  // e.g., "kiosk_hardening,notification_suppression"
        var skipTags = (cmd.payload && cmd.payload.skipTags) || ''
        var dryRun = cmd.payload && cmd.payload.dryRun === true

        var baselineEnv = Object.assign({}, process.env)
        if (tags) baselineEnv.HARDENING_TAGS = tags
        if (skipTags) baselineEnv.SKIP_HARDENING_TAGS = skipTags
        if (dryRun) baselineEnv.HARDENING_DRY_RUN = 'true'

        execSync('bash ' + baselinePath, {
          encoding: 'utf-8',
          timeout: 600000,  // 10 minute timeout for Ansible
          env: baselineEnv,
          cwd: '/opt/gwi-pos'
        })

        // Read result artifact
        var baselineResult = {}
        try {
          baselineResult = JSON.parse(fs.readFileSync('/opt/gwi-pos/state/stage11-result.json', 'utf-8'))
        } catch (e) { /* ignore */ }

        ackProgress(cmd.id, 'COMPLETED', {
          step: 'baseline_complete',
          result: baselineResult,
          dryRun: dryRun
        })
        log('RUN_BASELINE completed successfully')
        result = { ok: true, _acked: true }
      } catch (err) {
        ackProgress(cmd.id, 'FAILED', {
          step: 'baseline_failed',
          error: err.message,
          stderr: (err.stderr || '').slice(-500)
        })
        log('RUN_BASELINE FAILED: ' + err.message)
        result = { ok: false, error: err.message, _acked: true }
      }
    } else if (cmd.type === 'DISK_CLEANUP') {
      log('Received DISK_CLEANUP command from MC')
      currentAttemptId = generateAttemptId()
      ackProgress(cmd.id, 'IN_PROGRESS', { step: 'cleanup_start' })

      try {
        execSync('bash /opt/gwi-pos/scripts/disk-pressure-monitor.sh', {
          encoding: 'utf-8',
          timeout: 120000
        })

        var diskState = {}
        try {
          diskState = JSON.parse(fs.readFileSync('/opt/gwi-pos/state/disk-pressure.json', 'utf-8'))
        } catch (e) { /* ignore */ }

        ackProgress(cmd.id, 'COMPLETED', { step: 'cleanup_complete', diskState: diskState })
        log('DISK_CLEANUP completed')
        result = { ok: true, _acked: true }
      } catch (err) {
        ackProgress(cmd.id, 'FAILED', { step: 'cleanup_failed', error: err.message })
        log('DISK_CLEANUP FAILED: ' + err.message)
        result = { ok: false, error: err.message, _acked: true }
      }
    } else if (cmd.type === 'PROMOTE') {
      // Promote this BACKUP NUC to PRIMARY
      log('[Sync] Received PROMOTE command — promoting backup to primary')
      currentAttemptId = generateAttemptId()
      ackProgress(cmd.id, 'IN_PROGRESS', { step: 'promote_start' })

      try {
        // Run promote.sh if it exists (keepalived promote script)
        var promoteScript = '/opt/gwi-pos/promote.sh'
        if (fs.existsSync(promoteScript)) {
          execSync('bash ' + promoteScript, { encoding: 'utf8', timeout: 60000 })
          log('[Sync] promote.sh executed successfully')
        }

        // Update local role in .env
        var envFile = '/opt/gwi-pos/.env'
        if (fs.existsSync(envFile)) {
          var envContent = fs.readFileSync(envFile, 'utf8')
          envContent = envContent.replace(/STATION_ROLE=backup/i, 'STATION_ROLE=server')
          fs.writeFileSync(envFile, envContent)
          log('[Sync] Updated STATION_ROLE to server in .env')
        }

        // Enable POS service (backup role has it disabled to prevent stale-data sync)
        // Must enable BEFORE restart so the service survives reboots after promotion.
        try {
          execSync('sudo systemctl enable thepasspos', { encoding: 'utf8', timeout: 10000 })
          log('[Sync] POS service enabled for auto-start')
        } catch (enableErr) {
          log('[Sync] Warning: POS enable failed: ' + enableErr.message)
        }

        // Restart POS service to pick up new role
        try {
          execSync('sudo systemctl restart thepasspos', { encoding: 'utf8', timeout: 30000 })
          log('[Sync] POS service restarted')
        } catch (restartErr) {
          log('[Sync] Warning: POS restart failed: ' + restartErr.message)
        }

        ackProgress(cmd.id, 'COMPLETED', {
          step: 'promote_complete',
          newRole: 'server',
          previousPrimaryId: (cmd.payload && cmd.payload.previousPrimaryId) || null
        })
        log('[Sync] PROMOTE completed — this NUC is now PRIMARY')
        result = { ok: true, _acked: true }
      } catch (err) {
        ackProgress(cmd.id, 'FAILED', {
          step: 'promote_failed',
          error: err.message
        })
        log('[Sync] PROMOTE FAILED: ' + err.message)
        result = { ok: false, error: err.message, _acked: true }
      }
    } else {
      log('[Sync] Unknown command: ' + cmd.type + ', ACK OK')
      result = { ok: true }
    }
    // FORCE_UPDATE, RE_PROVISION, and PROMOTE handle their own ACKs (two-phase progress)
    if (!result._acked) {
      ack(cmd.id, result)
    }
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

// ── Boot repair: detect and recover from interrupted updates ──────────────
function checkInterruptedUpdate(done) {
  var lockFile = '/opt/gwi-pos/state/.update-transaction.lock'
  var stateFile = '/opt/gwi-pos/state/last-update.json'

  // Check for stale transaction lock (>30 min old)
  try {
    if (fs.existsSync(lockFile)) {
      var lockStat = fs.statSync(lockFile)
      var ageMs = Date.now() - lockStat.mtimeMs
      if (ageMs > 30 * 60 * 1000) {
        log('[Boot] Stale update transaction detected (' + Math.round(ageMs / 60000) + 'min old)')
        // Try rollback
        try {
          var rollbackOk = run('source "' + APP_DIR + '/public/installer-modules/lib/atomic-update.sh" && rollback_transaction', '/opt/gwi-pos', 60)
          log('[Boot] Rollback ' + (rollbackOk ? 'succeeded' : 'failed'))
        } catch (e) {
          log('[Boot] Rollback error: ' + e.message)
        }

        // Report to MC
        reportInterruptedUpdate('INTERRUPTED', 'Stale transaction lock detected on boot')
      }
    }
  } catch (e) {
    log('[Boot] Lock check error: ' + e.message)
  }

  // Check last-update.json for IN_PROGRESS state
  try {
    if (fs.existsSync(stateFile)) {
      var state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
      if (state.status === 'IN_PROGRESS') {
        var stateAge = Date.now() - new Date(state.attemptedAt).getTime()
        if (stateAge > 30 * 60 * 1000) {
          log('[Boot] Found stale IN_PROGRESS update from ' + state.attemptedAt)

          // Check current health to determine recovery status
          var currentVersion = 'unknown'
          try { currentVersion = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf-8')).version } catch (e) {}

          var recoveryStatus
          if (currentVersion === state.targetVersion) {
            recoveryStatus = 'RECOVERED_COMPLETED'
          } else if (currentVersion === state.previousVersion) {
            recoveryStatus = 'RECOVERED_ROLLED_BACK'
          } else {
            recoveryStatus = 'RECOVERY_UNKNOWN'
          }

          log('[Boot] Recovery status: ' + recoveryStatus + ' (running v' + currentVersion + ')')

          // Update state file
          state.status = recoveryStatus
          fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))

          reportInterruptedUpdate(recoveryStatus, 'Boot recovery from interrupted update')
        }
      }
    }
  } catch (e) {
    log('[Boot] State check error: ' + e.message)
  }

  done()
}

function reportInterruptedUpdate(status, reason) {
  var payload = { status: status, reason: reason, reportedAt: new Date().toISOString() }
  postJson('/api/fleet/deploy-health', payload)
    .then(function(r) { log('[Boot] Reported ' + status + ' to MC (HTTP ' + r.status + ')') })
    .catch(function(e) { log('[Boot] Failed to report to MC: ' + e.message) })
}

// ── Start ──────────────────────────────────────────────────────────────────
log('[Sync] GWI POS Sync Agent started')
log('[Sync] MC: ' + MC_URL + '  Node: ' + NODE_ID)

// ── Legacy path drift warning ─────────────────────────────────────────────
// /opt/gwi-pos/app should be a symlink to /opt/gwi-pos/current (or not exist).
// If it exists as a real directory, a legacy git clone is lingering and wasting
// disk. Warn loudly so MC and logs surface the drift.
try {
  if (fs.existsSync('/opt/gwi-pos/app')) {
    var appStat = fs.lstatSync('/opt/gwi-pos/app')
    if (!appStat.isSymbolicLink()) {
      log('[WARN] /opt/gwi-pos/app exists as a real directory (not a symlink). '
        + 'This is a legacy git clone — deploy-release.sh uses /opt/gwi-pos/current. '
        + 'Consider removing /opt/gwi-pos/app to reclaim disk space.')
    }
  }
} catch (e) { /* non-fatal */ }

checkBootUpdate(function() {
  checkInterruptedUpdate(function() {
    backfillCloudIdentity().then(function() {
      connectStream()
    })
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
