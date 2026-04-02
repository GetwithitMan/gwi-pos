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
const manifest = {
  // Legacy fields required by deploy-release.sh
  releaseId: version,
  artifactUrl: `/artifacts/version-contract-${version}.json`,
  artifactSha256: contractSha256,
  artifactFormatVersion: 3,
  // Structured fields
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
  generatedAt: new Date().toISOString(),
}

const manifestPath = path.join(artifactsDir, 'manifest.json')
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')

console.log(`[generate-artifacts] Version: ${version}`)
console.log(`[generate-artifacts]   schema:   ${schemaFilename} (sha256: ${schemaSha256.substring(0, 16)}...)`)
console.log(`[generate-artifacts]   contract: ${contractFilename} (sha256: ${contractSha256.substring(0, 16)}...)`)
console.log(`[generate-artifacts]   manifest: public/artifacts/manifest.json`)
