/**
 * Codemod: Wrap all API route handlers with withVenue()
 *
 * Transforms:
 *   export async function GET(request: Request) {
 *     ...
 *   }
 *
 * Into:
 *   import { withVenue } from '@/lib/with-venue'
 *   export const GET = withVenue(async function GET(request: Request) {
 *     ...
 *   })
 *
 * Strategy:
 *   1. Find "export async function METHOD(" by exact string match
 *   2. Track parenthesis depth to find end of parameter list
 *   3. After params close, find the opening "{" of the function body
 *   4. Track brace depth to find closing "}" of the function body
 *   5. Transform the declaration line and add ")" after closing "}"
 *
 * Handles: line comments, block comments, strings, template literals
 *
 * Run: node scripts/codemod-with-venue.mjs
 * Dry run: node scripts/codemod-with-venue.mjs --dry-run
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'

const DRY_RUN = process.argv.includes('--dry-run')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const API_DIR = join(process.cwd(), 'src/app/api')

let filesModified = 0
let handlersWrapped = 0
const filesSkipped = []
const errors = []

function findRouteFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...findRouteFiles(fullPath))
    } else if (entry.name === 'route.ts') {
      files.push(fullPath)
    }
  }
  return files
}

/**
 * Advance past a string literal starting at position `start`.
 * Handles single quotes, double quotes, and template literals (with nested ${...}).
 * Returns the position AFTER the closing quote.
 */
function skipString(content, start) {
  const quote = content[start]
  let i = start + 1

  if (quote === '`') {
    // Template literal — handle ${...} expressions
    while (i < content.length) {
      if (content[i] === '\\') {
        i += 2 // skip escaped char
        continue
      }
      if (content[i] === '$' && content[i + 1] === '{') {
        // Template expression — skip to matching }
        i += 2
        let depth = 1
        while (i < content.length && depth > 0) {
          if (content[i] === '\\') {
            i += 2
            continue
          }
          if (content[i] === '`') {
            // Nested template literal
            i = skipString(content, i)
            continue
          }
          if (content[i] === "'" || content[i] === '"') {
            i = skipString(content, i)
            continue
          }
          if (content[i] === '{') depth++
          if (content[i] === '}') depth--
          if (depth > 0) i++
          else i++ // move past closing }
        }
        continue
      }
      if (content[i] === '`') {
        return i + 1
      }
      i++
    }
    return i
  }

  // Regular string (single or double quotes)
  while (i < content.length) {
    if (content[i] === '\\') {
      i += 2 // skip escaped char
      continue
    }
    if (content[i] === quote) {
      return i + 1
    }
    i++
  }
  return i
}

/**
 * Skip a comment starting at position `start`.
 * Returns the position AFTER the comment.
 */
function skipComment(content, start) {
  if (content[start + 1] === '/') {
    // Single-line comment — skip to end of line
    const nl = content.indexOf('\n', start)
    return nl === -1 ? content.length : nl + 1
  }
  if (content[start + 1] === '*') {
    // Block comment — skip to */
    const end = content.indexOf('*/', start + 2)
    return end === -1 ? content.length : end + 2
  }
  return start + 1
}

/**
 * Advance `pos` past any non-code content (strings, comments, whitespace chars).
 * Returns next position of actual code character, or the same position if already at code.
 */
function nextCodeChar(content, pos) {
  while (pos < content.length) {
    const ch = content[pos]
    if (ch === '/' && (content[pos + 1] === '/' || content[pos + 1] === '*')) {
      pos = skipComment(content, pos)
      continue
    }
    return pos
  }
  return pos
}

/**
 * Scan forward from `start`, tracking brace/paren depth.
 * Skips strings, template literals, and comments.
 * Returns the position of the character that caused depth to hit 0.
 * `openChar` and `closeChar` define what we're tracking (e.g., '{'/'}' or '('/')').
 */
function findMatchingClose(content, start, openChar, closeChar) {
  let depth = 0
  let i = start

  while (i < content.length) {
    const ch = content[i]

    // Skip strings
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(content, i)
      continue
    }

    // Skip comments
    if (ch === '/' && (content[i + 1] === '/' || content[i + 1] === '*')) {
      i = skipComment(content, i)
      continue
    }

    if (ch === openChar) {
      depth++
    } else if (ch === closeChar) {
      depth--
      if (depth === 0) {
        return i
      }
    }

    i++
  }

  return -1 // unmatched
}

/**
 * Find all handler functions in a file and return their boundaries.
 */
function findHandlers(content) {
  const handlers = []

  for (const method of METHODS) {
    const pattern = `export async function ${method}(`
    let searchFrom = 0

    while (true) {
      const declStart = content.indexOf(pattern, searchFrom)
      if (declStart === -1) break
      searchFrom = declStart + pattern.length

      // Find closing ")" of parameters.
      // We start right after the opening "(" with depth 1.
      const openParenPos = declStart + pattern.length - 1 // position of the "("
      const closeParenPos = findMatchingClose(content, openParenPos, '(', ')')
      if (closeParenPos === -1) {
        errors.push(`Unmatched parens for ${method} at offset ${declStart}`)
        continue
      }

      // Find the opening "{" of the function body.
      // Must handle return type annotations like ): Promise<Response> {
      // Strategy: skip comments, strings, and angle brackets until we find "{"
      let bodyOpenPos = -1
      let angleBracketDepth = 0
      for (let i = closeParenPos + 1; i < content.length; i++) {
        const ch = content[i]
        if (ch === '/' && (content[i + 1] === '/' || content[i + 1] === '*')) {
          i = skipComment(content, i) - 1
          continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
          i = skipString(content, i) - 1
          continue
        }
        if (ch === '<') { angleBracketDepth++; continue }
        if (ch === '>') { angleBracketDepth--; continue }
        if (ch === '{' && angleBracketDepth === 0) {
          bodyOpenPos = i
          break
        }
      }

      if (bodyOpenPos === -1) {
        errors.push(`No function body "{" found for ${method} at offset ${declStart}`)
        continue
      }

      // Find closing "}" of function body.
      const bodyClosePos = findMatchingClose(content, bodyOpenPos, '{', '}')
      if (bodyClosePos === -1) {
        errors.push(`Unmatched braces for ${method} at offset ${declStart}`)
        continue
      }

      handlers.push({
        method,
        declStart,
        bodyClosePos,
      })
    }
  }

  handlers.sort((a, b) => a.declStart - b.declStart)
  return handlers
}

function processFile(filePath) {
  const content = readFileSync(filePath, 'utf-8')

  // Idempotence: skip files already wrapped
  if (content.includes('withVenue(')) {
    filesSkipped.push(filePath)
    return false
  }

  const handlers = findHandlers(content)
  if (handlers.length === 0) return false

  // Apply transformations in reverse order so offsets stay valid
  let result = content
  for (let i = handlers.length - 1; i >= 0; i--) {
    const h = handlers[i]

    // 1. Insert ")" after the closing "}"
    result =
      result.substring(0, h.bodyClosePos + 1) +
      ')' +
      result.substring(h.bodyClosePos + 1)

    // 2. Replace "export async function METHOD(" with wrapper
    const oldDecl = `export async function ${h.method}(`
    const newDecl = `export const ${h.method} = withVenue(async function ${h.method}(`
    result =
      result.substring(0, h.declStart) +
      newDecl +
      result.substring(h.declStart + oldDecl.length)
  }

  // Add import after existing imports
  const lines = result.split('\n')
  let insertIdx = 0
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('import{') ||
      trimmed.startsWith('import\t') ||
      (trimmed.startsWith('}') && trimmed.includes('from '))
    ) {
      insertIdx = i + 1
    }
  }

  if (!result.includes("from '@/lib/with-venue'")) {
    lines.splice(insertIdx, 0, "import { withVenue } from '@/lib/with-venue'")
  }

  result = lines.join('\n')

  if (!DRY_RUN) {
    writeFileSync(filePath, result, 'utf-8')
  }

  filesModified++
  handlersWrapped += handlers.length
  return true
}

// Main
console.log(DRY_RUN ? '=== DRY RUN ===' : '=== APPLYING CODEMOD ===')
console.log(`Scanning ${API_DIR}...\n`)

const routeFiles = findRouteFiles(API_DIR)
console.log(`Found ${routeFiles.length} route files\n`)

for (const file of routeFiles) {
  const rel = relative(process.cwd(), file)
  const modified = processFile(file)
  if (modified) {
    console.log(`  ✓ ${rel}`)
  }
}

console.log(`\n--- Summary ---`)
console.log(`Files modified: ${filesModified}`)
console.log(`Handlers wrapped: ${handlersWrapped}`)
if (filesSkipped.length) {
  console.log(`Files skipped: ${filesSkipped.length} (already wrapped)`)
}
if (errors.length) {
  console.log(`\nErrors (${errors.length}):`)
  for (const err of errors) {
    console.log(`  ✗ ${err}`)
  }
  console.log('\nThese files need manual wrapping.')
}
if (DRY_RUN) {
  console.log(`\nThis was a dry run. Run without --dry-run to apply changes.`)
}
