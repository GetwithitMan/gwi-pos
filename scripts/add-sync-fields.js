#!/usr/bin/env node
/**
 * Script to add deletedAt and syncedAt fields to all Prisma models
 * (except Organization and Location which are root tables)
 *
 * Usage: node scripts/add-sync-fields.js
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, '../prisma/schema.prisma');
const BACKUP_PATH = path.join(__dirname, '../prisma/schema.prisma.backup');

// Models that should NOT get sync fields (root tables)
const EXCLUDED_MODELS = ['Organization', 'Location'];

// Fields to add
const SYNC_FIELDS_ONLY = `
  // Sync fields (for cloud sync and soft deletes)
  deletedAt DateTime?
  syncedAt  DateTime?`;

const UPDATED_AT_AND_SYNC = `
  updatedAt DateTime @updatedAt

  // Sync fields (for cloud sync and soft deletes)
  deletedAt DateTime?
  syncedAt  DateTime?`;

function addSyncFields() {
  console.log('Reading schema...');
  let schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

  // Backup original
  console.log('Creating backup at schema.prisma.backup...');
  fs.writeFileSync(BACKUP_PATH, schema);

  // Find all model definitions
  const modelRegex = /model\s+(\w+)\s*\{/g;
  let match;
  const models = [];

  while ((match = modelRegex.exec(schema)) !== null) {
    models.push({
      name: match[1],
      index: match.index
    });
  }

  console.log(`Found ${models.length} models`);

  // Process models in reverse order (so indices don't shift)
  let modifiedCount = 0;
  let skippedCount = 0;

  for (let i = models.length - 1; i >= 0; i--) {
    const model = models[i];

    // Skip excluded models
    if (EXCLUDED_MODELS.includes(model.name)) {
      console.log(`  Skipping ${model.name} (root table)`);
      skippedCount++;
      continue;
    }

    // Get model content
    const modelEnd = i < models.length - 1 ? models[i + 1].index : schema.length;
    const modelContent = schema.substring(model.index, modelEnd);

    // Check if model already has deletedAt
    if (modelContent.includes('deletedAt')) {
      console.log(`  Skipping ${model.name} (already has deletedAt)`);
      skippedCount++;
      continue;
    }

    // Check what timestamp fields exist
    const hasUpdatedAt = modelContent.includes('updatedAt');
    const hasCreatedAt = modelContent.includes('createdAt');

    if (hasUpdatedAt) {
      // Has updatedAt - add sync fields after it
      const updatedAtRegex = /updatedAt\s+DateTime\s+@updatedAt/;
      const updatedAtMatch = updatedAtRegex.exec(modelContent);

      if (updatedAtMatch) {
        const insertPosition = model.index + updatedAtMatch.index + updatedAtMatch[0].length;
        schema = schema.slice(0, insertPosition) + SYNC_FIELDS_ONLY + schema.slice(insertPosition);
        console.log(`  Added sync fields to ${model.name}`);
        modifiedCount++;
      }
    } else if (hasCreatedAt) {
      // Has createdAt but no updatedAt - add updatedAt + sync fields after createdAt
      const createdAtRegex = /createdAt\s+DateTime\s+@default\(now\(\)\)/;
      const createdAtMatch = createdAtRegex.exec(modelContent);

      if (createdAtMatch) {
        const insertPosition = model.index + createdAtMatch.index + createdAtMatch[0].length;
        schema = schema.slice(0, insertPosition) + UPDATED_AT_AND_SYNC + schema.slice(insertPosition);
        console.log(`  Added updatedAt + sync fields to ${model.name}`);
        modifiedCount++;
      }
    } else {
      // Has neither - find insertion point before relations or @@index
      console.log(`  Warning: ${model.name} has no timestamp fields`);

      const relationOrIndexRegex = /\n\s*\/\/\s*Relations|\n\s*@@/;
      const insertMatch = relationOrIndexRegex.exec(modelContent);

      if (insertMatch) {
        const insertPosition = model.index + insertMatch.index;
        const fieldsToAdd = `
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Sync fields (for cloud sync and soft deletes)
  deletedAt DateTime?
  syncedAt  DateTime?
`;
        schema = schema.slice(0, insertPosition) + fieldsToAdd + schema.slice(insertPosition);
        console.log(`  Added all timestamp + sync fields to ${model.name}`);
        modifiedCount++;
      }
    }
  }

  // Write modified schema
  console.log('\nWriting modified schema...');
  fs.writeFileSync(SCHEMA_PATH, schema);

  console.log(`\nDone!`);
  console.log(`  Modified: ${modifiedCount} models`);
  console.log(`  Skipped: ${skippedCount} models`);
  console.log(`\nBackup saved to: ${BACKUP_PATH}`);
  console.log('\nNext steps:');
  console.log('  1. Review the changes: git diff prisma/schema.prisma');
  console.log('  2. Backup database: npm run db:backup');
  console.log('  3. Push schema: npm run db:push');
  console.log('  4. Generate client: npx prisma generate');
}

// Run
addSyncFields();
