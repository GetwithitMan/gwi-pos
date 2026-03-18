#!/usr/bin/env node
/**
 * Mechanical migration: adds getRequestLocationId() fast path above adminDb bootstrap queries.
 *
 * A "bootstrap query" is defined as:
 *   1. adminDb.{model}.find{First|Unique}({ where: ..., select: { ...locationId: true... } })
 *   2. The result variable is ONLY used for .locationId (pure bootstrap) —
 *      i.e. after the null-check, the only reference to the variable is `.locationId`
 *
 * Usage: node scripts/migrate-fast-path.mjs [--dry-run]
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DRY_RUN = process.argv.includes('--dry-run')
const ROOT = path.resolve(__dirname, '..')
const API_DIR = path.join(ROOT, 'src/app/api')

// Stats
let totalMigrated = 0
let totalBootstrapsConverted = 0
let totalSkippedFiles = 0
let errors = []

function findFilesToProcess() {
  const result = execSync(
    `grep -rn "adminDb\\.\\(order\\|employee\\|menuItem\\|payment\\|orderItem\\)\\.find" "${API_DIR}" --include="*.ts" -l`,
    { encoding: 'utf8' }
  ).trim().split('\n').filter(Boolean)

  return result.filter(f => {
    const content = fs.readFileSync(f, 'utf8')
    return !content.includes('getRequestLocationId')
  })
}

/**
 * Find bootstrap patterns in a file and return transformation instructions.
 *
 * A bootstrap pattern is:
 *   const VAR = await adminDb.MODEL.findFirst/findUnique({
 *     where: { ... },
 *     select: { ...locationId: true... },
 *   })
 *
 *   if (!VAR) {
 *     return/throw 404
 *   }
 *
 *   ... VAR.locationId used downstream ...
 *
 * Where VAR is ONLY used for .locationId after the null check.
 */
function findBootstraps(lines, filePath) {
  const bootstraps = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Match: const VARNAME = await adminDb.MODEL.findFirst/findUnique(
    const assignMatch = line.match(/^(\s*)const\s+(\w+)\s*=\s*await\s+adminDb\.(order|employee|menuItem|payment|orderItem)\.find(First|Unique)\(/)
    if (!assignMatch) continue

    const indent = assignMatch[1]
    const varName = assignMatch[2]
    const model = assignMatch[3]
    const findType = assignMatch[4]
    const assignStartLine = i

    // Find the end of the call (matching parentheses)
    let depth = 0
    let assignEndLine = i
    let foundEnd = false
    for (let j = i; j < Math.min(lines.length, i + 30); j++) {
      for (const ch of lines[j]) {
        if (ch === '(') depth++
        if (ch === ')') {
          depth--
          if (depth === 0) {
            assignEndLine = j
            foundEnd = true
            break
          }
        }
      }
      if (foundEnd) break
    }
    if (!foundEnd) continue

    // Check if select includes locationId
    const queryBlock = lines.slice(assignStartLine, assignEndLine + 1).join('\n')
    if (!queryBlock.includes('locationId')) continue

    // Find the null check: if (!VAR) { ... }
    let nullCheckStart = -1
    for (let j = assignEndLine + 1; j < Math.min(lines.length, assignEndLine + 5); j++) {
      if (lines[j].trim() === '' || lines[j].trim().startsWith('//')) continue
      if (lines[j].trim().match(new RegExp(`^if\\s*\\(\\s*!${varName}\\b`))) {
        nullCheckStart = j
        break
      }
      break // non-empty, non-comment, non-matching line — no null check
    }
    if (nullCheckStart === -1) continue

    // Find end of null check block
    let nullCheckEnd = nullCheckStart
    let braceDepth = 0
    for (let j = nullCheckStart; j < Math.min(lines.length, nullCheckStart + 15); j++) {
      for (const ch of lines[j]) {
        if (ch === '{') braceDepth++
        if (ch === '}') {
          braceDepth--
          if (braceDepth === 0) {
            nullCheckEnd = j
            break
          }
        }
      }
      if (braceDepth === 0 && nullCheckEnd > nullCheckStart) break
    }
    if (nullCheckEnd === nullCheckStart) continue // couldn't find end of null check

    // Verify the null check contains a return with 404 or a throw
    const nullCheckBlock = lines.slice(nullCheckStart, nullCheckEnd + 1).join('\n')
    if (!nullCheckBlock.includes('404') && !nullCheckBlock.includes('throw') && !nullCheckBlock.includes('NotFound')) {
      continue // Not a 404 pattern
    }

    // Determine the scope boundary: find the next export/function declaration
    // to avoid scanning into a different handler
    let scopeEnd = lines.length
    for (let j = nullCheckEnd + 2; j < lines.length; j++) {
      // A new export handler or top-level function marks the end of scope
      if (/^export\s+const\s+\w+\s*=/.test(lines[j]) || /^(?:export\s+)?(?:async\s+)?function\s+\w+/.test(lines[j])) {
        scopeEnd = j
        break
      }
    }

    // Check if VAR.locationId is used after the null check (within scope)
    let locationIdUsages = 0
    let otherUsages = 0
    for (let j = nullCheckEnd + 1; j < scopeEnd; j++) {
      const usageLine = lines[j]

      // Skip comment lines and string literals containing the variable name
      const trimmedUsageLine = usageLine.trim()
      if (trimmedUsageLine.startsWith('//') || trimmedUsageLine.startsWith('*')) continue

      // Count varName.locationId usages
      const locIdRegex = new RegExp(`\\b${varName}\\.locationId\\b`, 'g')
      const locMatches = usageLine.match(locIdRegex)
      if (locMatches) locationIdUsages += locMatches.length

      // Also count destructuring: const { locationId } = varName
      const destructRegex = new RegExp(`(?:const|let|var)\\s*\\{[^}]*locationId[^}]*\\}\\s*=\\s*${varName}\\b`)
      if (destructRegex.test(usageLine)) locationIdUsages++

      // Count ALL usages of varName on this line (code only, not in strings/comments)
      // Remove string literals before checking
      const codeOnly = usageLine
        .replace(/'[^']*'/g, '""')
        .replace(/"[^"]*"/g, '""')
        .replace(/`[^`]*`/g, '""')
      const anyVarRegex = new RegExp(`\\b${varName}\\b`, 'g')
      const allMatches = codeOnly.match(anyVarRegex)
      if (allMatches) {
        const totalOnLine = allMatches.length
        const locIdOnLine = (locMatches ? locMatches.length : 0) + (destructRegex.test(usageLine) ? 1 : 0)
        // Other usages: varName references that aren't .locationId
        if (totalOnLine > locIdOnLine) {
          otherUsages += (totalOnLine - locIdOnLine)
        }
      }
    }

    if (locationIdUsages === 0) continue // locationId not used downstream

    // If there are other usages, this isn't a pure bootstrap — skip
    // (the variable is used for more than just .locationId)
    if (otherUsages > 0) continue

    // Find preceding comment lines
    let commentStart = assignStartLine
    for (let j = assignStartLine - 1; j >= Math.max(0, assignStartLine - 5); j--) {
      const trimmed = lines[j].trim()
      if (trimmed.startsWith('//') && (
        /bootstrap|lightweight|locationId|NOTE.*locationId|TODO.*locationId|Initial fetch|fetch.*locationId|check.*location/i.test(trimmed)
      )) {
        commentStart = j
      } else {
        break
      }
    }

    bootstraps.push({
      commentStart,
      assignStartLine,
      assignEndLine,
      nullCheckStart,
      nullCheckEnd,
      varName,
      model,
      indent,
      locationIdUsages,
    })
  }

  return bootstraps
}

function migrateFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const relPath = path.relative(ROOT, filePath)
  let lines = content.split('\n')

  const bootstraps = findBootstraps(lines, filePath)
  if (bootstraps.length === 0) {
    return false
  }

  // Track variable name uniqueness within the file
  const usedVarNames = new Set()
  // Scan existing variable names
  for (const line of lines) {
    const match = line.match(/\b(?:let|const|var)\s+(\w*[Ll]ocationId\w*)\b/)
    if (match) usedVarNames.add(match[1])
  }

  // Process bootstraps from bottom to top (to preserve line numbers)
  const sortedBootstraps = [...bootstraps].sort((a, b) => b.commentStart - a.commentStart)

  let changeCount = 0

  for (const bp of sortedBootstraps) {
    // Generate unique locationId variable name
    let locVarName = 'locationId'
    if (usedVarNames.has(locVarName) || sortedBootstraps.length > 1) {
      // Need a context-specific name
      // Use the function/handler context to generate a name
      // Look backwards for the function name
      let contextName = ''
      for (let j = bp.commentStart - 1; j >= Math.max(0, bp.commentStart - 30); j--) {
        const funcMatch = lines[j].match(/(?:async\s+)?function\s+(\w+)/)
        if (funcMatch) {
          contextName = funcMatch[1].toLowerCase()
          break
        }
        const exportMatch = lines[j].match(/export\s+const\s+(\w+)\s*=/)
        if (exportMatch) {
          contextName = exportMatch[1].toLowerCase()
          break
        }
      }

      if (contextName && contextName !== 'get' && contextName !== 'post' && contextName !== 'put' && contextName !== 'patch' && contextName !== 'delete') {
        locVarName = `${contextName}LocationId`
      } else {
        locVarName = `${bp.varName}LocationId`
        // Remove trailing "Check", "Meta", "ForAuth" from prefix
        locVarName = locVarName.replace(/(?:Check|Meta|ForAuth)LocationId$/, 'LocationId')
        if (locVarName === 'LocationId') locVarName = 'bootstrapLocationId'
      }
    }

    // Make sure it's unique
    let suffix = 0
    let finalVarName = locVarName
    while (usedVarNames.has(finalVarName)) {
      suffix++
      finalVarName = `${locVarName}${suffix}`
    }
    locVarName = finalVarName
    usedVarNames.add(locVarName)

    // Build the replacement block
    const indent = bp.indent
    const originalLines = lines.slice(bp.commentStart, bp.nullCheckEnd + 1)

    const newBlock = [
      `${indent}// Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.`,
      `${indent}let ${locVarName} = getRequestLocationId()`,
      `${indent}if (!${locVarName}) {`,
      ...originalLines.map(l => `${indent}  ${l.trimStart() ? l.replace(/^(\s*)/, '$1  ').replace(new RegExp(`^${indent}  `), `${indent}  `) : l}`),
      `${indent}  ${locVarName} = ${bp.varName}.locationId`,
      `${indent}}`,
    ]

    // Actually, let me build this more carefully to get indentation right
    const newBlock2 = [
      `${indent}// Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.`,
      `${indent}let ${locVarName} = getRequestLocationId()`,
      `${indent}if (!${locVarName}) {`,
    ]

    for (const origLine of originalLines) {
      if (origLine.trim() === '') {
        newBlock2.push('')
      } else {
        newBlock2.push(`  ${origLine}`)
      }
    }

    newBlock2.push(`${indent}  ${locVarName} = ${bp.varName}.locationId`)
    newBlock2.push(`${indent}}`)

    // Replace the original lines
    lines.splice(bp.commentStart, bp.nullCheckEnd - bp.commentStart + 1, ...newBlock2)

    // Now replace all downstream uses of `varName.locationId` with `locVarName`
    const offset = newBlock2.length - (bp.nullCheckEnd - bp.commentStart + 1)
    for (let j = bp.commentStart + newBlock2.length; j < lines.length; j++) {
      const regex = new RegExp(`\\b${bp.varName}\\.locationId\\b`, 'g')
      if (regex.test(lines[j])) {
        lines[j] = lines[j].replace(regex, locVarName)
      }
    }

    changeCount++
  }

  if (changeCount === 0) return false

  // Add import if needed
  const importLine = `import { getRequestLocationId } from '@/lib/request-context'`
  const joined = lines.join('\n')
  if (!joined.includes('getRequestLocationId')) {
    // Find the last import line
    let lastImportIdx = -1
    for (let i = 0; i < lines.length; i++) {
      if (/^import\s/.test(lines[i]) || /^} from '/.test(lines[i].trim())) {
        lastImportIdx = i
      }
      // Stop after we pass the import section
      if (lastImportIdx >= 0 && !lines[i].trim().startsWith('import') && !lines[i].trim().startsWith('} from') && lines[i].trim() !== '' && !lines[i].trim().startsWith('//') && !lines[i].trim().startsWith('*')) {
        break
      }
    }
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, importLine)
    }
  }

  const newContent = lines.join('\n')
  if (newContent !== content) {
    if (!DRY_RUN) {
      fs.writeFileSync(filePath, newContent)
    }
    console.log(`${DRY_RUN ? '[DRY] ' : ''}${relPath}: ${changeCount} bootstrap(s) migrated`)
    totalMigrated++
    totalBootstrapsConverted += changeCount
    return true
  }
  return false
}

// Main
const files = findFilesToProcess()
console.log(`Found ${files.length} files to check\n`)

for (const f of files) {
  try {
    if (!migrateFile(f)) {
      totalSkippedFiles++
    }
  } catch (err) {
    errors.push({ file: path.relative(ROOT, f), error: err.message })
    console.error(`ERROR in ${path.relative(ROOT, f)}: ${err.message}`)
  }
}

console.log(`\n${'='.repeat(70)}`)
console.log(`Files migrated: ${totalMigrated}`)
console.log(`Bootstraps converted: ${totalBootstrapsConverted}`)
console.log(`Files skipped (no pure bootstrap): ${totalSkippedFiles}`)
console.log(`Errors: ${errors.length}`)
if (errors.length > 0) {
  for (const e of errors) console.log(`  ${e.file}: ${e.error}`)
}
if (DRY_RUN) console.log('\n(dry run — no files were modified)')
