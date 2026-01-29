# Backup & Restore

Database backup, restoration, and data management.

## Overview

GWI POS uses SQLite for local data storage. Regular backups protect against data loss.

## Database Location

```
prisma/pos.db        # Main database file
prisma/backups/      # Backup directory
```

## Backup Commands

### Create Backup
```bash
npm run db:backup
```
Creates timestamped backup:
```
prisma/backups/pos-20260128-143022.db
```

### List Backups
```bash
npm run db:list-backups
```
Shows all available backups with dates.

### Restore from Backup
```bash
npm run db:restore
```
Restores from most recent backup.

### Restore Specific Backup
```bash
cp prisma/backups/pos-20260128-143022.db prisma/pos.db
```

## Automatic Backups

### Before Destructive Operations
These commands auto-backup first:
- `npm run reset` - Full database reset
- `npm run db:push` - Schema push (if destructive)
- `npm run db:migrate` - Migrations

### Scheduled Backups
Configure cron job for regular backups:
```bash
# Daily at 2am
0 2 * * * cd /path/to/gwi-pos && npm run db:backup
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
| `npm run db:backup` | None | Creates backup |

## Data Export

### Export to CSV
```bash
# Using sqlite3
sqlite3 prisma/pos.db ".mode csv" ".output orders.csv" "SELECT * FROM Order;"
```

### Export All Tables
```bash
# Create SQL dump
sqlite3 prisma/pos.db .dump > backup.sql
```

## Data Import

### From SQL Dump
```bash
sqlite3 prisma/pos.db < backup.sql
```

### From Another Database
```bash
# Copy and regenerate
cp other.db prisma/pos.db
npx prisma generate
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
npm run db:restore
```

## Database Maintenance

### Vacuum (Optimize)
```bash
sqlite3 prisma/pos.db "VACUUM;"
```

### Check Integrity
```bash
sqlite3 prisma/pos.db "PRAGMA integrity_check;"
```

### Database Size
```bash
ls -lh prisma/pos.db
```

## Multi-Device Sync

### Current Limitation
- SQLite is single-file
- No built-in sync
- Local storage only

### For Multi-Device
Consider:
- PostgreSQL for production
- Cloud database service
- Sync service layer

## Disaster Recovery

### Recovery Steps
1. Stop application
2. Locate most recent backup
3. Restore backup file
4. Regenerate Prisma client
5. Restart application
6. Verify data

### Verification
```bash
# Check row counts
sqlite3 prisma/pos.db "SELECT COUNT(*) FROM Order;"
sqlite3 prisma/pos.db "SELECT COUNT(*) FROM MenuItem;"
```

## Backup Storage

### Local Backups
- Stored in `prisma/backups/`
- Keep last 30 days
- Auto-cleanup old backups

### Off-Site Backups
Recommended for production:
- Cloud storage (S3, GCS)
- External drive
- Remote server

### Backup Script
```bash
#!/bin/bash
# backup-to-cloud.sh
npm run db:backup
LATEST=$(ls -t prisma/backups/*.db | head -1)
aws s3 cp $LATEST s3://my-bucket/backups/
```

## Key Files

| File | Purpose |
|------|---------|
| `prisma/pos.db` | Main database |
| `prisma/backups/` | Backup directory |
| `package.json` | Backup scripts |
| `prisma/schema.prisma` | Database schema |
