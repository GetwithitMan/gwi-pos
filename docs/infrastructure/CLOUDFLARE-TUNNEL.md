# Cloudflare Tunnel — NUC Postgres Exposure

Required for: Weekly backup GitHub Actions workflow (Layer 2), Neon logical replication (Layer 1).

## Setup Steps

### 1. Install cloudflared on the NUC
SSH into NUC: `ssh smarttab@172.16.1.254`

```bash
# Download and install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Authenticate (opens browser on your Mac — use a free Cloudflare account)
cloudflared tunnel login
```

### 2. Create a tunnel
```bash
cloudflared tunnel create gwi-pos-nuc
# Note the tunnel ID shown
```

### 3. Configure the tunnel (~/.cloudflared/config.yml on NUC)
```yaml
tunnel: <TUNNEL-ID>
credentials-file: /home/smarttab/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: nuc-db.yourdomain.com
    service: tcp://localhost:5432
  - service: http_status:404
```

### 4. Run as a service
```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

### 5. Add GitHub Secrets
In GitHub → gwi-pos → Settings → Secrets:
- `NUC_DB_HOST`: nuc-db.yourdomain.com
- `NUC_DB_PASSWORD`: <replicator user password>
- `NEON_API_KEY`: from console.neon.tech → Account → API Keys
- `NEON_PROJECT_ID`: from Neon project settings URL

## Neon Logical Replication (Layer 1)

On the NUC Postgres (`/etc/postgresql/*/main/postgresql.conf`):
```
wal_level = logical
max_replication_slots = 5
max_wal_senders = 5
```

Create replication user on NUC:
```sql
CREATE USER replicator WITH REPLICATION LOGIN PASSWORD 'strong-password-here';
GRANT CONNECT ON DATABASE gwi_pos_dev TO replicator;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO replicator;
CREATE PUBLICATION gwi_pos_full FOR ALL TABLES;
```

On Neon console (SQL editor):
```sql
CREATE SUBSCRIPTION gwi_pos_sub
  CONNECTION 'host=nuc-db.yourdomain.com port=5432 dbname=gwi_pos_dev user=replicator password=<password> sslmode=require'
  PUBLICATION gwi_pos_full;
```

**Important:** DDL changes (schema migrations) are NOT replicated. After running nuc-pre-migrate.js on the NUC, also run the same DDL on Neon manually.
