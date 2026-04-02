/**
 * Generate immutable versioned artifacts for fleet rollouts.
 *
 * Produces:
 *   public/artifacts/schema-{version}.sql
 *   public/artifacts/version-contract-{version}.json
 *   public/artifacts/manifest.json
 *
 * The version key is "{appVersion}-{schemaVersion}" where:
 *   - appVersion  = package.json "version" (e.g. 1.0.55)
 *   - schemaVersion = highest migration prefix (e.g. 083)
 *
 * MC rollouts pin to a specific artifact version instead of
 * fetching "whatever POS is serving right now."
 *
 * Run AFTER generate-schema-sql.mjs and generate-version-contract.mjs.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs'
import { createHash } from 'crypto'
import { execSync } from 'child_process'
import path from 'path'

const root = process.cwd()
const artifactsDir = path.join(root, 'public/artifacts')

// ── Read inputs ────────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'))
const appVersion = pkg.version // e.g. "1.0.55"

const contractPath = path.join(root, 'src/generated/version-contract.json')
if (!existsSync(contractPath)) {
  console.error('[generate-artifacts] Missing src/generated/version-contract.json — run generate-version-contract.mjs first')
  process.exit(1)
}
const contract = JSON.parse(readFileSync(contractPath, 'utf-8'))
const schemaVersion = contract.schemaVersion // e.g. "083"

const schemaSqlPath = path.join(root, 'public/schema.sql')
if (!existsSync(schemaSqlPath)) {
  console.error('[generate-artifacts] Missing public/schema.sql — run generate-schema-sql.mjs + cp first')
  process.exit(1)
}
const schemaSql = readFileSync(schemaSqlPath, 'utf-8')

// ── Version key ────────────────────────────────────────────────────────────
const version = `${appVersion}-${schemaVersion}`

// ── Ensure output directory ────────────────────────────────────────────────
mkdirSync(artifactsDir, { recursive: true })

// ── Hash helper ────────────────────────────────────────────────────────────
function sha256(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

// ── 1. Copy schema.sql with versioned filename ─────────────────────────────
const schemaFilename = `schema-${version}.sql`
const schemaArtifactPath = path.join(artifactsDir, schemaFilename)
copyFileSync(schemaSqlPath, schemaArtifactPath)
const schemaSha256 = sha256(schemaSql)

// ── 2. Copy version-contract.json with versioned filename ──────────────────
const contractFilename = `version-contract-${version}.json`
const contractContent = JSON.stringify(contract, null, 2) + '\n'
const contractArtifactPath = path.join(artifactsDir, contractFilename)
writeFileSync(contractArtifactPath, contractContent, 'utf-8')
const contractSha256 = sha256(contractContent)

// ── 3. Generate manifest.json ──────────────────────────────────────────────
// Manifest includes both legacy fields (releaseId, artifactUrl) for deploy-release.sh
// and structured artifact fields for MC fleet management.
const gitSha = contract.gitSha || 'unknown'
const R2_BASE = 'https://pub-15bf4245be0e4c05b570d31988004d09.r2.dev'
const manifest = {
  // Legacy fields required by deploy-release.sh
  releaseId: version,
  // Point to R2 for the tar.zst artifact (Vercel can't serve 641MB files).
  // deploy-release.sh reads this URL to download the release artifact.
  // The version-contract is also available as a fallback for MC/schema-only ops.
  artifactUrl: `${R2_BASE}/releases/${version}/pos-release-${version}.tar.zst`,
  artifactSha256: '__PENDING_R2_UPLOAD__',
  artifactFormatVersion: 3,
  // Structured fields (MC requires 'version' field)
  version: appVersion,
  currentVersion: version,
  appVersion,
  schemaVersion,
  gitSha,
  artifacts: {
    schema: {
      version,
      path: `/artifacts/${schemaFilename}`,
      sha256: schemaSha256,
    },
    versionContract: {
      version,
      path: `/artifacts/${contractFilename}`,
      sha256: contractSha256,
    },
  },
}

const manifestPath = path.join(artifactsDir, 'manifest.json')
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')

// ── 4. Sign artifacts with minisign (if key available) ────────────────────
const keyPath = path.join(root, 'keys/gwi-pos-release.key')
let signed = false

/**
 * Sign a file with minisign. Tries local key file first, then
 * MINISIGN_SECRET_KEY env var (Vercel). Returns true if signed.
 */
function signFile(filePath, sigOutputPath, comment) {
  if (existsSync(keyPath)) {
    try {
      execSync(
        `minisign -Sm "${filePath}" -s "${keyPath}" -x "${sigOutputPath}" -t "${comment}"`,
        { stdio: 'pipe' }
      )
      return true
    } catch { /* fall through to env var */ }
  }
  if (process.env.MINISIGN_SECRET_KEY) {
    try {
      const tmpKeyFile = path.join(artifactsDir, '.minisign-tmp-key')
      const rawKey = process.env.MINISIGN_SECRET_KEY.trim()
      const rwMatch = rawKey.match(/(.*?)\s+(RW\S+)/)
      const keyContent = rwMatch
        ? rwMatch[1] + '\n' + rwMatch[2] + '\n'
        : rawKey + '\n'
      writeFileSync(tmpKeyFile, keyContent, 'utf-8')
      execSync(
        `minisign -Sm "${filePath}" -s "${tmpKeyFile}" -x "${sigOutputPath}" -t "${comment}"`,
        { stdio: 'pipe' }
      )
      try { execSync(`rm -f "${tmpKeyFile}"`, { stdio: 'pipe' }) } catch {}
      return true
    } catch { /* fall through */ }
  }
  return false
}

// Sign manifest
const manifestSigPath = path.join(artifactsDir, 'manifest.json.minisig')
const manifestSigned = signFile(manifestPath, manifestSigPath, `GWI POS manifest ${version}`)

// Sign version-contract (deploy-release.sh verifies this)
const contractSigPath = path.join(artifactsDir, `${contractFilename}.minisig`)
const contractSigned = signFile(contractArtifactPath, contractSigPath, `GWI POS contract ${version}`)

signed = manifestSigned && contractSigned
if (!manifestSigned) console.warn('[generate-artifacts] WARN: manifest unsigned — minisign not available')
if (!contractSigned) console.warn('[generate-artifacts] WARN: version-contract unsigned — minisign not available')

console.log(`[generate-artifacts] Version: ${version}`)
console.log(`[generate-artifacts]   schema:   ${schemaFilename} (sha256: ${schemaSha256.substring(0, 16)}...)`)
console.log(`[generate-artifacts]   contract: ${contractFilename} (sha256: ${contractSha256.substring(0, 16)}...)`)
console.log(`[generate-artifacts]   manifest: public/artifacts/manifest.json${manifestSigned ? ' (SIGNED)' : ' (unsigned)'}`)
console.log(`[generate-artifacts]   contract sig: ${contractSigned ? contractSigPath : 'NONE'}`)
