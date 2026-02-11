# Mission Control Changelog

## Session: February 11, 2026 (Planning & Preparation)

### Summary
Architecture plan for Mission Control Center (Module A: Tenant & Fleet Management) was designed, refined through multiple review rounds, and approved. All preparation files created for implementation kickoff.

### What Was Done
- Designed complete Module A architecture plan (12 sections + 3 appendices)
- Incorporated hardware plan requirements (Postgres Schema isolation, Clerk B2B auth, wildcard subdomains, hardware kit, deliverables checklist)
- Created Domain 25: Mission Control in domain registry
- Created domain documentation (`/docs/domains/MISSION-CONTROL-DOMAIN.md`)
- Saved permanent plan copy (`/docs/plans/MISSION-CONTROL-MODULE-A.md`)
- Added 21 skill placeholders (Skills 300-320) to Skills Index
- Added implementation tasks to PM Task Board
- Updated CLAUDE.md with Domain 25 registration

### Architecture Decisions Made
1. **Sync Agent Sidecar**: Separate Docker container is the ONLY cloud communication channel. POS app never calls Mothership directly.
2. **Zero Inbound Ports**: All communication is outbound-initiated by local servers. Servers never expose ports to the internet.
3. **RSA Key Exchange**: 4096-bit keypair generated locally during provisioning. Private key never leaves server.
4. **HMAC Request Signing**: Every server→cloud request includes HMAC-SHA256 signature (mirrors Twilio webhook pattern).
5. **SSE over WebSocket**: Server-Sent Events chosen for cloud→server commands (firewall-friendly, auto-reconnect, simpler).
6. **Postgres Schemas + RLS**: Two-layer tenant isolation — structural (schema per org) + policy (RLS as defense-in-depth).
7. **Clerk B2B**: Admin authentication via Clerk Organizations (MFA, org-scoped sessions, RBAC).
8. **Hardware Fingerprint**: SHA-256 of SMBIOS UUID + MAC + CPU + RAM + disk serial, versioned for future formula updates.
9. **License Grace Period**: 14-day default, HMAC-signed local cache, in-memory caching with 60s timer.
10. **Cosign Image Signing**: Keyless OIDC-based Docker image signing for secure update pipeline.
11. **PayFac Model**: GWI owns master Datacap account. Venues are sub-merchants — cannot bring their own processor or bypass GWI processing.
12. **Cloud-Pushed Credentials**: Datacap merchantId/operatorId/secureDeviceIds encrypted AES-256-GCM at rest, delivered via RSA-encrypted SSE command. POS has NO settings UI for credentials.
13. **Tamper Prevention**: Sync Agent overwrites any local DB credential tampering on 60s heartbeat. Unregistered readers rejected.
14. **Subscription Tiers**: Starter ($99/mo) / Pro ($199/mo) / Enterprise ($399/mo) with hardware device limits and feature gating.
15. **Processing Fee Deduction**: GWI processing markup deducted from Datacap settlement (off the top), not billed separately to merchant.
16. **Late Payment Escalation**: Stripe retry (Day 1-5) → email (Day 5) → warning banner (Day 14) → read-only (Day 30) → kill switch (Day 45).

### Key Documents Created
- `/docs/plans/MISSION-CONTROL-MODULE-A.md` — Complete architecture plan
- `/docs/domains/MISSION-CONTROL-DOMAIN.md` — Domain documentation
- `/docs/changelogs/MISSION-CONTROL-CHANGELOG.md` — This changelog

---

## Session: February 11, 2026 (PayFac & Revenue Model)

### Summary
Extended the Module A architecture plan with three new sections covering payment processing control (PayFac model), subscription tier enforcement with hardware limits, and revenue/fee structure with late payment escalation. Answered owner questions about Docker, PWA, offline capability, and Datacap credential management.

### What Was Done
- Added **Section 13: Payment Processing Control (PayFac Model)** — GWI owns master Datacap account, venues are sub-merchants, cloud-pushed encrypted credentials, tamper prevention, per-reader management
- Added **Section 14: Hardware Limits & Subscription Tiers** — Starter ($99/mo) / Pro ($199/mo) / Enterprise ($399/mo) with device caps, feature gating, two-level enforcement (cloud + local cache)
- Added **Section 15: Revenue & Fee Structure** — Three revenue streams (subscription, processing markup, revenue share), settlement deduction, late payment escalation (Day 1→45)
- Added Threat Model entries T11-T14 (processing bypass attempts)
- Added Deliverables Checklist items 15-17
- Updated Appendix A (Sync Agent status API) with `paymentConfig` and `subscriptionLimits` fields
- Updated Appendix C (Operational Defaults) with 3 new tables (Payment Processing, Subscription & Hardware Limits, Billing & Late Payment)
- Updated Domain doc with PayFac and Billing layers + expanded responsibilities
- Added 3 new skills (321-323) to Skills Index
- Added 3 new tasks (T-065 to T-067) to PM Task Board

### Architecture Decisions Made (continued from Session 1)
11. **PayFac Model**: GWI owns master Datacap account. Venues are sub-merchants — cannot bring their own processor or bypass GWI processing.
12. **Cloud-Pushed Credentials**: Datacap merchantId/operatorId/secureDeviceIds encrypted AES-256-GCM at rest, delivered via RSA-encrypted SSE command. POS has NO settings UI for credentials.
13. **Tamper Prevention**: Sync Agent overwrites any local DB credential tampering on 60s heartbeat. Unregistered readers rejected.
14. **Subscription Tiers**: Starter ($99/mo) / Pro ($199/mo) / Enterprise ($399/mo) with hardware device limits and feature gating.
15. **Processing Fee Deduction**: GWI processing markup deducted from Datacap settlement (off the top), not billed separately to merchant.
16. **Late Payment Escalation**: Stripe retry (Day 1-5) → email (Day 5) → warning banner (Day 14) → read-only (Day 30) → kill switch (Day 45).

### Owner Q&A Documented
- **Docker**: Pre-installed on Ubuntu NUC. GWI builds Docker images via GitHub Actions, signed with Cosign. Updates pushed from Mission Control dashboard — operators never touch servers.
- **PWA**: Terminals are browsers pointing at the NUC's local IP. Works as installable Progressive Web App on any device.
- **Offline**: NUC hosts everything locally (app + PostgreSQL + Socket.io). 100% functional with no internet. Sync Agent queues data for when internet returns.
- **Datacap credentials**: Admin enters MID + operatorId + secureDeviceIds in Mission Control per location. Credentials auto-push to NUC via encrypted SSE. Venue has zero access to modify.

### How to Resume
1. Say: `PM Mode: Mission Control`
2. Review `/docs/plans/MISSION-CONTROL-MODULE-A.md` for full architecture (now 15 sections + 3 appendices)
3. Review PM Task Board for Phase 2A tasks (T-054 to T-067)
4. Start with Skill 300: Cloud Project Bootstrap (create separate Next.js project)

### Next Session Priority
**Phase 2A: Foundation (Weeks 1-3)**
1. Create separate cloud Next.js project with Neon PostgreSQL
2. Cloud Prisma schema (all cloud models including PaymentConfig, SubscriptionLimits, BillingConfig)
3. `POST /api/fleet/register` — server registration endpoint
4. `POST /api/fleet/heartbeat` — heartbeat ingestion
5. `POST /api/fleet/license/validate` — license validation
6. Provisioning script for Ubuntu servers
7. Basic fleet dashboard (status cards, online/offline)

---

## Pending Workers
None yet — implementation starts next session.

## Known Issues
None — this is a greenfield cloud project.
