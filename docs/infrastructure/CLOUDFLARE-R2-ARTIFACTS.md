# Cloudflare R2 Artifact Storage

> Artifact storage for NUC deployment tarballs, manifests, and deploy-tools.

---

## What Goes Where

| Artifact | Storage | Why |
|----------|---------|-----|
| Tarballs (`pos-release-*.tar.zst`) | **Cloudflare R2** | Large binary artifacts, CDN-cached, HMAC-authed download |
| Deploy-tools (`deploy-tools-*.tar.gz`) | **Cloudflare R2** | Lightweight migration runner, co-located with tarballs |
| Manifests (`manifest.json`, `version-contract-*.json`) | **Cloudflare R2** | Version metadata, read by MC and NUCs |
| Docker images | **GHCR** (`ghcr.io/gwi-pos`) | Docker-native registry, Cosign signing, SBOM attestation |

**Docker images do NOT go to R2.** GHCR provides native Docker registry semantics (pull by tag/digest, layer caching, Cosign verification). R2 is for flat files only.

---

## Release Descriptor (v3)

The release descriptor is written by `build-release.yml` and consumed by MC when creating releases.

### v3 Fields (added for Docker support)

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | App version (e.g., `1.2.63`) |
| `releaseId` | string | `{version}-{gitSha}` |
| `tarballUrl` | string | R2 URL for `.tar.zst` artifact |
| `tarballSha256` | string | SHA-256 of tarball |
| `deployToolsUrl` | string | R2 URL for deploy-tools artifact |
| `imageRef` | string | GHCR image reference (e.g., `ghcr.io/gwi-pos/pos:1.2.63-abc1234`) |
| `imageDigest` | string | Docker image digest (`sha256:...`) for immutable pulls |
| `manifestUrl` | string | R2 URL for manifest.json |
| `buildDate` | string | ISO 8601 timestamp |
| `gitSha` | string | Full commit SHA |

The `imageRef` and `imageDigest` fields are new in v3. MC uses `imageRef` + `imageDigest` in FleetCommand payloads for Docker NUCs. Tarball NUCs continue using `tarballUrl`.

---

## Access Control

- **R2 uploads:** `build-release.yml` uses R2 API tokens (stored as GitHub Actions secrets)
- **R2 downloads:** MC proxy adds HMAC auth headers; NUCs never access R2 directly
- **GHCR pushes:** `build-release.yml` uses `GITHUB_TOKEN` (automatic in Actions)
- **GHCR pulls:** NUCs authenticate with a read-only PAT stored in `/opt/gwi-pos/.env`

---

*Last updated: 2026-04-03*
