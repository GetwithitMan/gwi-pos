# Backup Management Plan

## Current State (Audited 2026-02-21)

### prisma/backups/ Directory

| Metric | Value |
|--------|-------|
| Total files | 82 |
| Total size | 274 MB |
| Date range | 2026-01-28 to 2026-02-13 |
| File format | SQLite `.db` snapshots |
| Non-backup files | 1 (`schema.prisma.backup-itemdiscount-20260220-153919`) |

**File size trend:** Backups grew from ~1.3 MB (Jan 28) to ~5.8 MB (Feb 13) as the development database accumulated data.

### Special Backups

| File | Size | Purpose |
|------|------|---------|
| `pos-before-restore-20260202-103934.db` | 3.0 MB | Safety snapshot before a restore operation |
| `pos-combine-cleanup-20260212-080736.db` | 5.5 MB | Snapshot before combine feature cleanup |
| `schema.prisma.backup-itemdiscount-20260220-153919` | 207 KB | Schema backup (not a database file) |

### SQLite Files at prisma/ Root

These are **legacy SQLite files** from before the project migrated to Neon PostgreSQL. They are no longer used by the application.

| File | Size | Notes |
|------|------|-------|
| `prisma/dev.db` | 0 bytes | Empty, unused |
| `prisma/pos.db` | 5.6 MB | Old local SQLite database |
| `prisma/pos.db-shm` | 32 KB | SQLite shared memory file |
| `prisma/pos.db-wal` | 0 bytes | SQLite write-ahead log |

### Loose Backup at prisma/ Root

| File | Size | Notes |
|------|------|-------|
| `prisma/schema.prisma.backup-20260220-145909` | 205 KB | Schema backup (already tracked in git status as untracked) |

---

## Recommendations

### 1. Keep Only the Last 5 Database Backups

82 backups spanning 17 days is excessive. For a development environment, keeping the **last 5 backups** provides sufficient rollback coverage while saving ~260 MB of disk space.

**Backups to keep (most recent 5):**
- `pos-20260213-071244.db` (Feb 13)
- `pos-20260212-211209.db` (Feb 12)
- `pos-20260211-184610.db` (Feb 11)
- `pos-20260211-153310.db` (Feb 11)
- `pos-20260211-121823.db` (Feb 11)

**Also keep (special purpose):**
- `pos-before-restore-20260202-103934.db` (restore safety snapshot)
- `pos-combine-cleanup-20260212-080736.db` (combine cleanup snapshot)

### 2. Remove Legacy SQLite Files

Since the project now uses Neon PostgreSQL exclusively, these files serve no purpose:
- `prisma/dev.db` (0 bytes -- empty)
- `prisma/pos.db` (5.6 MB)
- `prisma/pos.db-shm` (32 KB)
- `prisma/pos.db-wal` (0 bytes)

### 3. Move Schema Backups

Move schema backup files out of the database backup folder:
- `prisma/backups/schema.prisma.backup-itemdiscount-20260220-153919` -> `prisma/schema-backups/` or delete
- `prisma/schema.prisma.backup-20260220-145909` -> `prisma/schema-backups/` or delete

Schema history is already tracked by git, making these files redundant.

---

## Safe Archive Procedure

Before deleting old backups, archive them in case they're ever needed:

```bash
# Step 1: Create archive directory
mkdir -p prisma/backups/archive

# Step 2: Move old backups to archive (keep last 5 + special)
cd prisma/backups
ls pos-202601*.db pos-202602{01,02,03,04,05,06,07,08,09,10}*.db | \
  while read f; do mv "$f" archive/; done

# Step 3: Verify only recent backups remain
ls *.db

# Step 4: (Optional) Compress the archive for storage
tar -czf prisma/backups/archive-20260128-20260210.tar.gz archive/
rm -rf archive/

# Step 5: (Optional) Move archive off-repo entirely
mv prisma/backups/archive-*.tar.gz ~/Desktop/gwi-pos-backup-archive/
```

### To Delete Old Backups Without Archiving

```bash
# Delete all backups EXCEPT the 5 most recent + 2 special
cd prisma/backups
ls -t *.db | tail -n +6 | grep -v 'before-restore\|combine-cleanup' | xargs rm
```

### To Remove Legacy SQLite Files

```bash
rm prisma/dev.db prisma/pos.db prisma/pos.db-shm prisma/pos.db-wal
rm prisma/schema.prisma.backup-20260220-145909
rm prisma/backups/schema.prisma.backup-itemdiscount-20260220-153919
```

---

## Ongoing Backup Hygiene

### Add to .gitignore

Ensure these patterns are in `.gitignore` to prevent backups from being committed:

```
prisma/backups/
prisma/*.db
prisma/*.db-shm
prisma/*.db-wal
prisma/*.backup-*
```

### Automatic Cleanup Script

Consider adding a post-backup hook to `package.json` that prunes old backups:

```bash
# Keep only last 5 backups after each new backup
ls -t prisma/backups/pos-*.db 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null
```

---

## Summary

| Action | Space Recovered | Risk |
|--------|----------------|------|
| Delete 75 old backups (keep 5 + 2 special) | ~240 MB | Low (dev data only) |
| Remove legacy SQLite files | ~5.7 MB | None (project uses Neon PostgreSQL) |
| Remove schema backups | ~0.4 MB | None (git tracks schema history) |
| **Total** | **~246 MB** | |
