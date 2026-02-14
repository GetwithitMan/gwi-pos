# Backup & Restore

Database backup, restoration, and data management.

## Overview

GWI POS uses Neon PostgreSQL (database-per-venue) for data storage. Each venue has its own database (`gwi_pos_{slug}`). Regular backups protect against data loss. Neon also provides point-in-time recovery via the dashboard.

## Database Connection

```env
# Pooled connection (for queries)
DATABASE_URL="postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/gwi_pos_{slug}?sslmode=require"

# Direct connection (for migrations)
DIRECT_URL="postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/gwi_pos_{slug}?sslmode=require"
```

## Backup Commands

### Create Backup (pg_dump)
```bash
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql
```
Creates timestamped SQL dump file.

### List Backups
```bash
ls -lt backups/*.sql
```
Shows all available backups with dates.

### Restore from Backup
```bash
psql $DATABASE_URL < backup-20260128-143022.sql
```

## Automatic Backups

### Before Destructive Operations
Always create a backup before:
- `npm run db:push` - Schema push (if destructive)
- `npm run db:migrate` - Migrations

### Neon Point-in-Time Recovery
Neon provides built-in point-in-time recovery via the Neon dashboard. This allows restoring to any second within the retention window without manual backups.

### Scheduled Backups
Configure cron job for regular backups:
```bash
# Daily at 2am
0 2 * * * pg_dump $DATABASE_URL > /backups/gwi-pos-$(date +\%Y\%m\%d-\%H\%M\%S).sql
```

## Dangerous Commands

### ALWAYS Backup First

| Command | Risk | Action |
|---------|------|--------|
| `npm run reset` | Deletes ALL data | Full backup first |
| `npm run db:push` | May drop tables | Backup first |
| `npm run db:migrate` | Schema changes | Backup first |

### Safe Commands

| Command | Risk | Notes |
|---------|------|-------|
| `npx prisma generate` | None | Regenerates client |
| `npm run db:studio` | None | View only |

## Data Export

### Export to CSV
```bash
# Using psql
psql $DATABASE_URL -c "COPY (SELECT * FROM \"Order\") TO STDOUT WITH CSV HEADER" > orders.csv
```

### Export All Tables
```bash
# Create SQL dump
pg_dump $DATABASE_URL > backup.sql
```

## Data Import

### From SQL Dump
```bash
psql $DATABASE_URL < backup.sql
```

## Schema Changes

### Safe Migration Process
1. Backup current database
2. Make schema changes
3. Generate migration
4. Apply migration
5. Test thoroughly
6. Keep backup for rollback

### Rollback
If migration fails:
```bash
psql $DATABASE_URL < backup.sql
```

## Database Maintenance

### Analyze (Optimize Query Plans)
```bash
psql $DATABASE_URL -c "ANALYZE;"
```

### Check Table Sizes
```bash
psql $DATABASE_URL -c "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 20;"
```

### Vacuum (Reclaim Space)
```bash
psql $DATABASE_URL -c "VACUUM ANALYZE;"
```

## Multi-Device Sync

### Current Architecture
- Neon PostgreSQL is cloud-hosted
- All devices connect via pooled DATABASE_URL
- Sync Agent sidecar handles cloud-to-local sync
- Full concurrent write support via PostgreSQL MVCC

## Disaster Recovery

### Recovery Steps
1. Stop application
2. Use Neon point-in-time recovery, or restore from pg_dump backup
3. Regenerate Prisma client
4. Restart application
5. Verify data

### Verification
```bash
# Check row counts
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Order\";"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"MenuItem\";"
```

## Backup Storage

### Local Backups
- Store pg_dump files on secure local disk
- Keep last 30 days
- Auto-cleanup old backups

### Off-Site Backups
Recommended for production:
- Cloud storage (S3, GCS)
- Neon point-in-time recovery (built-in)
- Remote server

### Backup Script
```bash
#!/bin/bash
# backup-to-cloud.sh
BACKUP_FILE="gwi-pos-$(date +%Y%m%d-%H%M%S).sql"
pg_dump $DATABASE_URL > /tmp/$BACKUP_FILE
aws s3 cp /tmp/$BACKUP_FILE s3://my-bucket/backups/
rm /tmp/$BACKUP_FILE
```

## Key Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Database schema |
| `prisma/migrations/` | Migration files |
| `src/lib/db.ts` | Master + per-venue Prisma clients |
| `package.json` | Database scripts |
