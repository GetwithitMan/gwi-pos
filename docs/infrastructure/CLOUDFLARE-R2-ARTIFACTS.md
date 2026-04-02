# Cloudflare R2 Artifact Hosting

## Purpose

NUC deployment artifacts (150-300 MB compressed tarballs) are hosted on Cloudflare R2 to eliminate egress costs. R2 provides S3-compatible storage with zero egress fees, decoupling artifact delivery from Vercel (which is not designed for large binary hosting). NUCs pull artifacts directly from R2 during deploys.

## Setup (Already Done)

| Resource | Value |
|----------|-------|
| Bucket | `gwi-pos-artifacts` |
| Account ID | `45325ffd511728b7bbb7089379193b96` |
| Public URL | `https://pub-15bf4245be0e4c05b570d31988004d09.r2.dev` |
| S3 Endpoint | `https://45325ffd511728b7bbb7089379193b96.r2.cloudflarestorage.com` |
| API Token | `gwi-pos-artifact-upload` (access key `7f88becb19c3aa8403581fa2aa3cda66`) |
| Region | Western North America (WNAM) |

**GitHub Secrets** (configured in repo settings):

| Secret | Purpose |
|--------|---------|
| `R2_ACCESS_KEY_ID` | S3-compatible access key for uploads |
| `R2_SECRET_ACCESS_KEY` | S3-compatible secret key for uploads |
| `R2_ACCOUNT_ID` | Cloudflare account ID (used to build the S3 endpoint) |
| `MINISIGN_SECRET_KEY` | Signs manifests and version contracts for NUC verification |

## Bucket Structure

```
gwi-pos-artifacts/
  releases/{releaseId}/
    pos-release-{releaseId}.tar.zst       # Full NUC artifact (zstd compressed)
    manifest.json                          # Build metadata (version, SHA, timestamp)
    manifest.json.minisig                  # Minisign signature of manifest
    version-contract-{version}.json        # Version contract for MC webhook detection
    version-contract-{version}.json.minisig
    schema-{version}.sql                   # Schema snapshot (if present)
  latest/
    pos-release-latest.tar.zst             # Copy of most recent artifact
    manifest.json                          # Copy of most recent manifest
```

The `releases/{releaseId}/` prefix provides immutable, versioned storage. The `latest/` prefix is a convenience alias overwritten on each deploy.

## Cache Headers

| Path Pattern | Cache Behavior | Rationale |
|-------------|---------------|-----------|
| `releases/{releaseId}/*` | Immutable (long TTL) | Release IDs are content-addressed; once uploaded, never changes |
| `latest/*` | No-cache / short TTL | Overwritten on every deploy; NUCs should always get the freshest copy |

R2 public bucket access serves objects with default caching. For `latest/`, consumers should use `Cache-Control: no-cache` request headers or always prefer the versioned path when the release ID is known.

## GitHub Action

The upload workflow lives at `.github/workflows/upload-artifact.yml`.

**Trigger:** Push to `main` (production deploys only).

**Flow:**
1. Checkout, install deps, generate Prisma client
2. `npm run build` (full Next.js production build)
3. `scripts/build-nuc-artifact.sh` -- builds tarball, signs with minisign
4. Reads `releaseId` and `version` from `public/artifacts/manifest.json`
5. Uploads artifact + manifest + signatures + version contract + schema to `releases/{releaseId}/`
6. Copies artifact + manifest to `latest/`
7. Verifies upload with a HEAD request against the public URL

**Concurrency:** Only one upload runs at a time (`concurrency.group: upload-artifact`, `cancel-in-progress: true`).

## NUC Integration

NUCs use a fallback chain when pulling artifacts during deploy:

```
1. R2 versioned path  (primary)
   https://pub-15bf4245be0e4c05b570d31988004d09.r2.dev/releases/{releaseId}/pos-release-{releaseId}.tar.zst

2. R2 latest path     (fallback if releaseId unknown)
   https://pub-15bf4245be0e4c05b570d31988004d09.r2.dev/latest/pos-release-latest.tar.zst

3. Vercel public/     (legacy fallback)
   https://{vercel-domain}/artifacts/pos-release-{releaseId}.tar.zst
```

**Signature verification:** After download, the NUC verifies `manifest.json` against `manifest.json.minisig` using the public minisign key baked into the installer. Artifacts that fail verification are rejected and the deploy aborts.

## Monitoring

Verify the latest artifact is accessible:

```bash
# Check latest manifest
curl -sI "https://pub-15bf4245be0e4c05b570d31988004d09.r2.dev/latest/manifest.json"

# Read latest manifest metadata
curl -s "https://pub-15bf4245be0e4c05b570d31988004d09.r2.dev/latest/manifest.json" | jq .

# Check a specific release artifact (replace RELEASE_ID)
curl -sI "https://pub-15bf4245be0e4c05b570d31988004d09.r2.dev/releases/${RELEASE_ID}/pos-release-${RELEASE_ID}.tar.zst"

# Verify HTTP 200 (scripted)
HTTP_CODE=$(curl -sI "https://pub-15bf4245be0e4c05b570d31988004d09.r2.dev/latest/manifest.json" -o /dev/null -w "%{http_code}")
[ "$HTTP_CODE" = "200" ] && echo "OK" || echo "FAIL: HTTP ${HTTP_CODE}"
```

Cloudflare R2 analytics are available in the Cloudflare dashboard under **R2 > gwi-pos-artifacts > Metrics** (request counts, bandwidth, storage).

## Cost Model

| Dimension | R2 Pricing | Notes |
|-----------|-----------|-------|
| Storage | $0.015/GB/month | ~300 MB per release; 20 releases = ~6 GB = ~$0.09/mo |
| Class A ops (PUT, POST, LIST) | $4.50/million | One deploy = ~10 ops; negligible |
| Class B ops (GET, HEAD) | $0.36/million | NUC pulls + monitoring; negligible |
| Egress | **$0.00** | Zero egress fees -- the entire reason R2 was chosen |

At current deploy cadence (~2-4 deploys/week, 5-10 NUCs pulling), monthly cost is effectively **under $0.15/month**. Old releases can be pruned with a lifecycle rule or manual cleanup, but storage cost is negligible.
