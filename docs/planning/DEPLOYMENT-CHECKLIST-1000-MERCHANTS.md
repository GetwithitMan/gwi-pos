# Deployment Checklist: 1000 Merchants

Target: scale from pilot to 1,000 active merchant venues.

---

## Pre-Deploy

- [ ] Rotate Neon credentials (old password `npg_oFx7hM6sTSwy` was exposed)
- [ ] Set required env vars on ALL NUCs: `SESSION_SECRET`, `PORTAL_HMAC_SECRET`, `INTERNAL_API_SECRET`
- [ ] Set `CRON_SECRET` on Vercel for both POS and MC projects
- [ ] Set `ALERT_WEBHOOK_URL` on MC Vercel (Slack/PagerDuty webhook)
- [ ] Verify `.env.production.local` does not exist on any machine

## Database

- [ ] Run MC Prisma push: `npx prisma db push` (adds ProvisioningJob, Alert models)
- [ ] Run NUC migration 084 on all existing venues (auto-runs on NUC boot)
- [ ] Populate venue registry: `dotenv -e .env.local -- tsx scripts/populate-venue-registry.ts`
- [ ] Verify Neon connection limits are adequate (recommend Scale plan for 1000+ venues)
- [ ] Contact Neon re: 1000 databases per project limits

## Vercel

- [ ] Verify all crons registered in `vercel.json` for both POS and MC
- [ ] Verify `CRON_SECRET` matches between vercel.json and env vars
- [ ] MC security headers deployed (verify with securityheaders.com)

## Monitoring

- [ ] Set up `ALERT_WEBHOOK_URL` for P1/P2 alert notifications
- [ ] Verify heartbeat cleanup cron is running (check MC logs)
- [ ] Monitor Neon connection counts for first week after deploy

## Post-Deploy Verification

- [ ] Create a test venue from MC — verify full provisioning pipeline completes
- [ ] Verify crons process all venue databases (check logs for `[forAllVenues]` entries)
- [ ] Verify remote owner access works (login to venue via `*.ordercontrolcenter.com`)
- [ ] Verify NUC heartbeats appear in MC dashboard
- [ ] Verify socket dispatch from Vercel crons reaches NUCs (test reservation expiry)

## Scaling Milestones

- [ ] At 100 merchants: Monitor Neon connection counts, cron execution times
- [ ] At 500 merchants: Consider sync relay architecture (HTTP batch API replacing direct TCP)
- [ ] At 1000 merchants: Re-evaluate `DB_POOL_SIZE`, cron concurrency, Vercel function limits
