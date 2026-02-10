# Skill 252: Dynamic Tip Groups (Time-Segmented Pooling)

**Status:** DONE
**Domain:** Tips & Tip Bank
**Date:** 2026-02-10
**Dependencies:** Skill 250 (Tip Ledger Foundation)
**Phase:** Tip Bank Phase 3

## Overview

Bartenders form groups mid-shift to pool tips. Membership changes create time segments with recalculated splits. Each segment stores a splitJson with exact percentages, and tips are allocated using the segment active at the time of payment.

## What Was Built

### Schema (prisma/schema.prisma)
- `TipGroup` — Active group with owner, splitMode (equal/custom/role_weighted/hours_weighted), status
- `TipGroupMembership` — Member join/leave tracking with approval workflow, status (active/left/pending_approval)
- `TipGroupSegment` — Time-stamped split snapshots with memberCount and splitJson

### Domain Logic (src/lib/domain/tips/tip-groups.ts, ~665 lines)
- `startTipGroup()` — Create group + first segment with initial members
- `addMemberToGroup()` — Close current segment, add membership, open new segment with recalculated splits
- `removeMemberFromGroup()` — Close segment, mark membership left, open new segment. Last member closes group
- `requestJoinGroup()` — Create pending membership for owner approval
- `approveJoinRequest()` — Approve pending → triggers addMember flow
- `transferGroupOwnership()` — Manual or auto on clock-out to senior member
- `closeGroup()` — End group, close final segment
- `findActiveGroupForEmployee()` — Is employee in an active group?
- `findSegmentForTimestamp()` — Which segment was active at a given time?
- `getGroupInfo()` — Full group details with members and segments

### Tip Allocation Pipeline (src/lib/domain/tips/tip-allocation.ts, ~520 lines)
- `allocateTipsForOrder()` — Main pipeline: check group membership → find segment → split by splitJson → post ledger entries
- `calculateGroupCheckout()` — Per-segment breakdown for shift closeout display

### API Routes
- `GET /api/tips/groups` — List active groups for location
- `POST /api/tips/groups` — Start new group
- `GET /api/tips/groups/[id]` — Group details with members, segments
- `PUT /api/tips/groups/[id]` — Update group (transfer ownership, change split mode)
- `DELETE /api/tips/groups/[id]` — Close group
- `POST /api/tips/groups/[id]/members` — Add member / request join
- `PUT /api/tips/groups/[id]/members` — Approve join request
- `DELETE /api/tips/groups/[id]/members` — Remove member / leave group

### Socket Events (src/lib/socket-dispatch.ts)
- `tip-group:created` — New group started
- `tip-group:member-joined` — Member added (triggers segment recalc)
- `tip-group:member-left` — Member left
- `tip-group:closed` — Group ended
- `tip-group:ownership-transferred` — New owner

## Files Created
- `src/lib/domain/tips/tip-groups.ts`
- `src/lib/domain/tips/tip-allocation.ts`
- `src/app/api/tips/groups/route.ts`
- `src/app/api/tips/groups/[id]/route.ts`
- `src/app/api/tips/groups/[id]/members/route.ts`

## Files Modified
- `prisma/schema.prisma` — TipGroup, TipGroupMembership, TipGroupSegment models
- `src/lib/domain/tips/index.ts` — Barrel exports
- `src/lib/socket-dispatch.ts` — Tip group socket events

## Verification
1. Start group → verify first segment created with equal splits
2. Add member → verify current segment closes, new segment opens with recalculated splits
3. Remove last member → verify group closes
4. allocateTipsForOrder() → verify tips use segment active at payment timestamp
5. Socket events fire for all group mutations
