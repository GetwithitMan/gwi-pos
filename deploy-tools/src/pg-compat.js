/**
 * PgCompat — Prisma-compatible wrapper over pg.Client
 *
 * Every existing migration file calls exactly two methods:
 *   prisma.$executeRawUnsafe(sql, ...params)  — DDL/DML (ALTER, CREATE, UPDATE)
 *   prisma.$queryRawUnsafe(sql, ...params)    — queries (information_schema, pg_catalog)
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
    return result.rows
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
