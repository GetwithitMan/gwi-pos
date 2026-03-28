/**
 * PgCompat — Prisma-compatible wrapper over pg.Client
 *
 * Migration files use four methods:
 *   prisma.$executeRawUnsafe(sql, ...params)  — DDL/DML with positional params
 *   prisma.$queryRawUnsafe(sql, ...params)    — queries with positional params
 *   prisma.$executeRaw`...`                   — DDL/DML with tagged template
 *   prisma.$queryRaw`...`                     — queries with tagged template
 *
 * Both Prisma and pg use $1, $2, ... positional placeholders.
 * Both return rows as plain objects.
 * This wrapper bridges the interface so migration files work unchanged.
 */

const { Client } = require('pg')

class PgCompat {
  constructor(connectionString) {
    this._connectionString = connectionString
    this._client = null
  }

  async connect() {
    const opts = { connectionString: this._connectionString }

    // Neon requires SSL. pg does not auto-negotiate like @prisma/adapter-pg.
    if (this._connectionString.includes('neon.tech')) {
      opts.ssl = { rejectUnauthorized: false }
    }

    this._client = new Client(opts)
    await this._client.connect()
    return this
  }

  /**
   * Execute DDL/DML. Returns affected row count (no migration checks this).
   */
  async $executeRawUnsafe(sql, ...params) {
    const result = await this._client.query(sql, params.length > 0 ? params : undefined)
    return result.rowCount ?? 0
  }

  /**
   * Execute a query and return rows as an array of plain objects.
   * Matches Prisma's return shape: const [row] = await prisma.$queryRawUnsafe(...)
   */
  async $queryRawUnsafe(sql, ...params) {
    const result = await this._client.query(sql, params.length > 0 ? params : undefined)
    // Convert BigInt values to Number for compatibility with Prisma-style code
    return result.rows.map(row => {
      const converted = {}
      for (const [key, value] of Object.entries(row)) {
        converted[key] = typeof value === 'bigint' ? Number(value) : value
      }
      return converted
    })
  }

  /**
   * Tagged template version of $queryRawUnsafe.
   * Used as: prisma.$queryRaw`SELECT ... WHERE col = ${val}`
   * Converts tagged template to parameterized query with $1, $2, etc.
   */
  async $queryRaw(strings, ...values) {
    const sql = strings.reduce((acc, str, i) => acc + str + (i < values.length ? `$${i + 1}` : ''), '')
    const result = await this._client.query(sql, values.length > 0 ? values : undefined)
    return result.rows
  }

  /**
   * Tagged template version of $executeRawUnsafe.
   * Used as: prisma.$executeRaw`ALTER TABLE ...`
   */
  async $executeRaw(strings, ...values) {
    const sql = strings.reduce((acc, str, i) => acc + str + (i < values.length ? `$${i + 1}` : ''), '')
    const result = await this._client.query(sql, values.length > 0 ? values : undefined)
    return result.rowCount ?? 0
  }

  /**
   * Disconnect. Called in finally blocks.
   */
  async $disconnect() {
    if (this._client) {
      await this._client.end()
      this._client = null
    }
  }
}

module.exports = { PgCompat }
