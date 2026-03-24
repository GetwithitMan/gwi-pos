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
                // Self-update sync-agent + deploy all components from checkout
                selfUpdateSyncAgent()
                var compResult = updateComponentsFromCheckout()
                if (cmdId) ackProgress(cmdId, 'COMPLETED', { step: 'update-agent-done', version: newVer, steps: ['update-agent OK', 'components OK'], componentUpdates: compResult })
                return { ok: true, version: newVer, steps: ['update-agent OK', 'components OK'], _acked: true }
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
                  var compResult2 = updateComponentsFromCheckout()
                  if (cmdId) ackProgress(cmdId, 'COMPLETED', { step: 'update-agent-done', version: prData.currentVersion || 'unknown', steps: ['update-agent OK', 'restart OK', 'components OK'], componentUpdates: compResult2 })
                  return { ok: true, version: prData.currentVersion || 'unknown', steps: ['update-agent OK', 'restart OK', 'components OK'], _acked: true }
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
        if (cmdId) ackProgress(cmdId, 'COMPLETED', { step: 'already-in-progress', version: 'pending', steps: ['update-agent already running'] })
        return { ok: true, version: 'pending', steps: ['update-agent already running'], _acked: true }
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

  // Write IN_PROGRESS state for boot recovery
  writeUpdateState({
    status: 'IN_PROGRESS',
    attemptId: currentAttemptId,
    targetVersion: targetVersion || 'latest',
    previousVersion: previousVersion,
    attemptedAt: new Date().toISOString(),
    method: 'direct'
  })

  function step(name, cmd, failOk, timeout) {
    log('  ' + name + '...')
    var ok = run(cmd, APP_DIR, timeout)
    steps.push(name + (ok ? ' OK' : ' FAIL'))
    return ok || failOk
  }

  // ── Git self-repair before any git operations ──
  // Fix ownership: previous sudo/root operations leave files root-owned,
  // causing git (running as service user) to fail with "Permission denied"
  try {
    var posUser = env.POSUSER || 'gwipos'
    try { posUser = execSync('stat -c %U ' + APP_DIR, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }).trim() } catch (e) {}
    if (posUser && posUser !== 'root') {
      execSync('sudo chown -R ' + posUser + ':' + posUser + ' "' + APP_DIR + '"', { timeout: 30000, stdio: 'pipe' })
      // Re-lock sensitive files
      try { execSync('sudo chown root:' + posUser + ' /opt/gwi-pos/.env && sudo chmod 640 /opt/gwi-pos/.env', { timeout: 5000, stdio: 'pipe' }) } catch (e) {}
      try { execSync('sudo chown -R root:root /opt/gwi-pos/keys && sudo chmod 700 /opt/gwi-pos/keys', { timeout: 5000, stdio: 'pipe' }) } catch (e) {}
      try { execSync('sudo chown root:' + posUser + ' /opt/gwi-pos/.git-credentials && sudo chmod 640 /opt/gwi-pos/.git-credentials', { timeout: 5000, stdio: 'pipe' }) } catch (e) {}
      log('  Fixed file ownership for ' + posUser)
      steps.push('ownership-fix OK')
    }
  } catch (e) {
    log('  Ownership fix failed (non-fatal): ' + (e.message || '').slice(0, 100))
  }

  // Clear stale git lock files left by interrupted operations
  try {
    var lockFiles = [
      path.join(APP_DIR, '.git', 'index.lock'),
      path.join(APP_DIR, '.git', 'refs', 'remotes', 'origin', 'main.lock'),
      path.join(APP_DIR, '.git', 'HEAD.lock'),
      path.join(APP_DIR, '.git', 'config.lock'),
      path.join(APP_DIR, '.git', 'shallow.lock'),
      path.join(APP_DIR, '.git', 'refs', 'heads', 'main.lock'),
    ]
    lockFiles.forEach(function(f) {
      try {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f)
          log('  Removed stale lock: ' + f)
        }
      } catch (e) {}
    })
  } catch (e) {}

  // Abort interrupted merge/rebase/cherry-pick state
  try {
    if (fs.existsSync(path.join(APP_DIR, '.git', 'MERGE_HEAD'))) {
      log('  Aborting interrupted merge')
      run('git merge --abort', APP_DIR, 10)
    }
    if (fs.existsSync(path.join(APP_DIR, '.git', 'rebase-merge')) || fs.existsSync(path.join(APP_DIR, '.git', 'rebase-apply'))) {
      log('  Aborting interrupted rebase')
      run('git rebase --abort', APP_DIR, 10)
    }
    if (fs.existsSync(path.join(APP_DIR, '.git', 'CHERRY_PICK_HEAD'))) {
      log('  Aborting interrupted cherry-pick')
      run('git cherry-pick --abort', APP_DIR, 10)
    }
  } catch (e) {}
  steps.push('git-repair OK')
  if (cmdId) ackProgress(cmdId, 'IN_PROGRESS', { step: 'backup', detail: 'git-repair complete, starting fetch' })

  // ── Git fetch with retry ──
  var fetchOk = false
  for (var fetchAttempt = 1; fetchAttempt <= 3; fetchAttempt++) {
    if (step('git fetch (attempt ' + fetchAttempt + ')', 'git fetch origin --tags --prune', true, 60)) {
      fetchOk = true
      break
    }
    if (fetchAttempt < 3) {
      log('  Retrying fetch in 5s...')
      execSync('sleep 5', { timeout: 10000 })
    }
  }
  if (!fetchOk) {
    log('  WARNING: All fetch attempts failed — attempting checkout with existing refs')
  }
  if (cmdId) ackProgress(cmdId, 'IN_PROGRESS', { step: 'git-fetch', detail: fetchOk ? 'fetch OK' : 'fetch failed, using existing refs' })

  // Version-targeted: try pinned tag first, fall back to origin/main
  var tagRef = targetVersion ? 'v' + targetVersion : null
  var tagExists = false
  if (tagRef) {
    try {
      execSync('git rev-parse --verify refs/tags/' + tagRef, { cwd: APP_DIR, timeout: 5000, stdio: 'pipe' })
      tagExists = true
    } catch (e) { /* tag doesn't exist */ }
  }

  var gitCheckoutError = ''
  if (tagExists) {
    // Pinned release: deterministic checkout of the exact tagged commit
    log('  Deploying pinned release: ' + tagRef)
    try {
      execSync('git checkout ' + tagRef, { cwd: APP_DIR, timeout: 30000, stdio: 'pipe', encoding: 'utf-8' })
      steps.push('pinned-release: ' + tagRef)
    } catch (e) {
      gitCheckoutError = ((e.stderr || e.stdout || e.message || '') + '').slice(0, 500)
      steps.push('git checkout FAIL: ' + gitCheckoutError.slice(0, 100))
      log('  FAILED: ' + gitCheckoutError)
      var failResult = { ok: false, error: 'git checkout failed: ' + gitCheckoutError, steps: steps }
      if (cmdId) ackProgress(cmdId, 'FAILED', { step: 'git-checkout', error: failResult.error, steps: steps })
      writeUpdateState({ status: 'FAILED', attemptId: currentAttemptId, targetVersion: targetVersion || 'latest', previousVersion: previousVersion, attemptedAt: new Date().toISOString(), completedAt: new Date().toISOString(), method: 'direct', error: failResult.error, steps: steps })
      return Object.assign(failResult, { _acked: true })
    }
  } else {
    // Fallback: use origin/main (backward compatible)
    if (tagRef) {
      log('  Tag ' + tagRef + ' not found, falling back to origin/main')
    }
    log('  git reset to origin/main...')
    try {
      execSync('git reset --hard origin/main', { cwd: APP_DIR, timeout: 30000, stdio: 'pipe', encoding: 'utf-8' })
      steps.push('fallback: origin/main')
    } catch (e) {
      gitCheckoutError = ((e.stderr || e.stdout || e.message || '') + '').slice(0, 500)
      // Nuclear recovery: if reset fails, nuke and re-clone
      log('  git reset failed — attempting nuclear recovery (re-clone)...')
      steps.push('git reset FAIL — nuclear recovery')
      try {
        var repoUrl = ''
        try { repoUrl = execSync('git remote get-url origin', { cwd: APP_DIR, timeout: 5000, stdio: 'pipe', encoding: 'utf-8' }).trim() } catch (e) {}
        if (!repoUrl) repoUrl = 'https://github.com/GetwithitMan/gwi-pos.git'
        execSync('rm -rf "' + APP_DIR + '"', { timeout: 30000 })
        execSync('git clone --depth 1 "' + repoUrl + '" "' + APP_DIR + '"', { timeout: 120000, stdio: 'pipe' })
        log('  Nuclear re-clone succeeded')
        steps.push('nuclear-reclone OK')
        // Re-copy env files
        try { fs.copyFileSync(ENV_FILE, path.join(APP_DIR, '.env')) } catch (e) {}
        try { fs.copyFileSync(ENV_FILE, path.join(APP_DIR, '.env.local')) } catch (e) {}
      } catch (cloneErr) {
        log('  Nuclear re-clone FAILED: ' + ((cloneErr.message || '') + '').slice(0, 200))
        var cloneFailResult = { ok: false, error: 'git recovery failed: ' + gitCheckoutError, steps: steps }
        if (cmdId) ackProgress(cmdId, 'FAILED', { step: 'git-checkout', error: cloneFailResult.error, steps: steps })
        writeUpdateState({ status: 'FAILED', attemptId: currentAttemptId, targetVersion: targetVersion || 'latest', previousVersion: previousVersion, attemptedAt: new Date().toISOString(), completedAt: new Date().toISOString(), method: 'direct', error: cloneFailResult.error, steps: steps })
        return Object.assign(cloneFailResult, { _acked: true })
      }
    }
  }

  // Verify version-contract.json after checkout (schema + seed versions for diagnostics)
  try {
    var contract = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'public', 'version-contract.json'), 'utf-8'))
    log('  Version contract: schema=' + contract.schemaVersion + ' seed=' + contract.seedVersion +
        ' migrations=' + contract.migrationCount + ' generated=' + contract.generatedAt)
    steps.push('contract: schema=' + contract.schemaVersion)
  } catch (e) {
    log('  Warning: could not read version-contract.json')
  }

  // Re-copy env files in case they were updated
  try { fs.copyFileSync(ENV_FILE, path.join(APP_DIR, '.env')) } catch (e) {}
  try { fs.copyFileSync(ENV_FILE, path.join(APP_DIR, '.env.local')) } catch (e) {}

  // Stamp target version into package.json so NUC reports correct version to MC
  if (targetVersion) {
    try {
      var pkgPath = path.join(APP_DIR, 'package.json')
      var pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      if (pkg.version !== targetVersion) {
        pkg.version = targetVersion
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
        log('  Stamped version ' + targetVersion + ' into package.json')
        steps.push('version-stamp OK')
      }
    } catch (e) {
      log('  Version stamp failed: ' + (e.message || '').slice(0, 100))
    }
  }

  if (cmdId) ackProgress(cmdId, 'IN_PROGRESS', { step: 'npm-install', detail: 'starting npm ci' })
  if (!step('npm install', 'npm ci --production=false', false, 180)) {
    log('  npm ci failed — clearing cache and retrying...')
    run('npm cache clean --force', APP_DIR, 30)
    run('rm -rf node_modules', APP_DIR, 30)
    if (!step('npm install (retry)', 'npm ci --production=false', false, 300)) {
      var npmFailResult = { ok: false, error: 'npm install failed after retry', steps: steps }
      if (cmdId) ackProgress(cmdId, 'FAILED', { step: 'npm-install', error: npmFailResult.error, steps: steps })
      writeUpdateState({ status: 'FAILED', attemptId: currentAttemptId, targetVersion: targetVersion || 'latest', previousVersion: previousVersion, attemptedAt: new Date().toISOString(), completedAt: new Date().toISOString(), method: 'direct', error: npmFailResult.error, steps: steps })
      return Object.assign(npmFailResult, { _acked: true })
    }
  }
  // Clean stale Prisma v6 cache (Prisma 7 generates to src/generated/prisma/)
  step('clean-prisma-cache', 'rm -rf node_modules/.prisma', true, 10)
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

  // NOTE: NUC does NOT migrate Neon. MC owns Neon schema advancement.
  // NUC reads version truth from Neon and blocks sync if behind.
  // If Neon schema is behind, MC must push the update to this venue.
  // Skip typecheck on NUC (already verified in CI) + set heap for Next.js build
  if (cmdId) ackProgress(cmdId, 'IN_PROGRESS', { step: 'build', detail: 'starting npm run build' })
  if (!step('build', 'SKIP_TYPECHECK=1 NODE_OPTIONS="--max-old-space-size=4096" npm run build', false, 600)) {
    var buildFailResult = { ok: false, error: 'build failed', steps: steps }
    if (cmdId) ackProgress(cmdId, 'FAILED', { step: 'build', error: buildFailResult.error, steps: steps })
    writeUpdateState({ status: 'FAILED', attemptId: currentAttemptId, targetVersion: targetVersion || 'latest', previousVersion: previousVersion, attemptedAt: new Date().toISOString(), completedAt: new Date().toISOString(), method: 'direct', error: buildFailResult.error, steps: steps })
    return Object.assign(buildFailResult, { _acked: true })
  }
  // Try current service name (thepasspos), fall back to legacy (pulse-pos)
  if (cmdId) ackProgress(cmdId, 'IN_PROGRESS', { step: 'restart', detail: 'restarting POS service' })
  log('  restart...')
  var restartOk = run('sudo systemctl restart thepasspos', APP_DIR, 30)
  if (!restartOk) restartOk = run('sudo systemctl restart pulse-pos', APP_DIR, 30)
  steps.push('restart' + (restartOk ? ' OK' : ' FAIL'))
  if (!restartOk) {
    var restartFailResult = { ok: false, error: 'restart failed', steps: steps }
    if (cmdId) ackProgress(cmdId, 'FAILED', { step: 'restart', error: restartFailResult.error, steps: steps })
    writeUpdateState({ status: 'FAILED', attemptId: currentAttemptId, targetVersion: targetVersion || 'latest', previousVersion: previousVersion, attemptedAt: new Date().toISOString(), completedAt: new Date().toISOString(), method: 'direct', error: restartFailResult.error, steps: steps })
    return Object.assign(restartFailResult, { _acked: true })
  }

  selfUpdateSyncAgent()

  // Deploy all components from the checkout (dashboard, monitoring, watchdog)
  var componentUpdates = updateComponentsFromCheckout()
  steps.push('components ' + (componentUpdates._updated ? 'OK' : 'skip'))

  var ver = 'unknown'
  try { ver = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf-8')).version } catch (e) {}
  log('[Update] SUCCESS — v' + ver)
  if (cmdId) ackProgress(cmdId, 'COMPLETED', { step: 'done', version: ver, steps: steps, componentUpdates: componentUpdates })
  writeUpdateState({ status: 'COMPLETED', attemptId: currentAttemptId, targetVersion: targetVersion || 'latest', previousVersion: previousVersion, attemptedAt: new Date().toISOString(), completedAt: new Date().toISOString(), method: 'direct', version: ver, steps: steps, componentUpdates: componentUpdates })
  return { ok: true, version: ver, steps: steps, _acked: true }
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

// ── Component updates from checkout ────────────────────────────────────────
// After a successful POS update, deploy all bundled components (dashboard,
// monitoring scripts, watchdog) so every FORCE_UPDATE brings the full stack
// to the target version — not just the POS app.
function updateComponentsFromCheckout() {
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
      var ok = run('sudo dpkg -i "' + debPath + '" 2>/dev/null || sudo apt-get install -f -y', APP_DIR, 60)
      if (ok) {
        run('pkill -f gwi-dashboard || true', APP_DIR, 5)
        result.dashboard = { from: installedVer, to: availableVer, updated: true }
        result._updated = true
        log('[Components] Dashboard updated successfully')
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
    var migrationsDir = '/opt/gwi-pos/app/scripts/migrations'
    if (fs.existsSync(migrationsDir)) {
      var files = fs.readdirSync(migrationsDir).filter(function(f) { return /^\d{3}-/.test(f) }).sort()
      return files.length > 0 ? (files[files.length - 1].match(/^(\d{3})/) || [])[1] || '000' : '000'
    }
    return '000'
  } catch (e) { return '000' }
}

function getCurrentAppVersion() {
  try {
    var pkg = JSON.parse(fs.readFileSync('/opt/gwi-pos/app/package.json', 'utf-8'))
    return pkg.version || '0.0.0'
  } catch (e) { return '0.0.0' }
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
      result = await handleForceUpdate(cmd.payload || {}, cmd.id)
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
          var rollbackOk = run('source /opt/gwi-pos/app/public/installer-modules/lib/atomic-update.sh && rollback_transaction', '/opt/gwi-pos', 60)
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
