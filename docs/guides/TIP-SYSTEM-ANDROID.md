# Tip System -- Android Integration Guide

This document covers what Android Register and PAX devices need to implement for tip group support, feature flags, and shift closeout integration.

## Feature Flags (Settings)

All tip group UI must be gated behind settings fetched from the NUC at bootstrap or settings refresh. The flags live under `settings.tipBank`:

| Flag | Type | Default | Effect |
|------|------|---------|--------|
| `tipGroupsEnabled` | boolean | `false` | Master toggle. When false, hide ALL group UI (creation, joining, group indicators). |
| `allowEmployeeGroupCreation` | boolean | `false` | When false, employees can only join admin-defined template groups -- hide "Create Group" button. |
| `showTipIndicatorOnPOS` | boolean | `true` | Show/hide the tip badge in the POS header showing current group and live tip total. |
| `showCCFeeToEmployee` | boolean | `true` | Show/hide the CC fee deduction line in the shift closeout screen. |
| `allowStandaloneServers` | boolean | `true` | Show "No Group (Keep My Own Tips)" option at clock-in. |
| `allowEmployeeCreatedGroups` | boolean | `true` | Legacy flag for ad-hoc group creation outside admin templates. |

**Decision tree at clock-in:**
1. If `tipGroupsEnabled` is false: skip group selection entirely.
2. If `tipGroupsEnabled` is true: call `GET /api/tips/group-templates/eligible` to get available templates.
3. Show template list. If `allowStandaloneServers` is true, add a "No Group" option.
4. If `allowEmployeeGroupCreation` is true, add a "Create Custom Group" option.

## Socket Events

### `tips:allocated`
Emitted after a payment allocates tips to employees. Use this to update a tip badge or running total without polling.

**Payload:**
```json
{
  "orderId": "string",
  "paymentId": "string",
  "allocations": [
    {
      "employeeId": "string",
      "amountCents": 450,
      "sourceType": "DIRECT_TIP | TIP_GROUP"
    }
  ],
  "ccFeeCents": 14,
  "netTipCents": 436
}
```

**Android action:** Filter `allocations` by the logged-in employee's ID. Add `amountCents` to the running tip badge. If `showTipIndicatorOnPOS` is true, display updated total.

### `tip-group:updated`
Emitted when group membership changes, a group is created/closed, or ownership transfers.

**Payload:**
```json
{
  "action": "created | member-joined | member-left | closed | ownership-transferred | tip-received",
  "groupId": "string",
  "employeeId": "string (optional)",
  "employeeName": "string (optional)",
  "newOwnerId": "string (optional)",
  "tipAmountCents": 0
}
```

**Android action:** Refresh group state from `GET /api/tips/groups?locationId=X&status=active`. Update group indicator. If `action` is `closed` and the employee was a member, clear group state.

## Clock-In: Group Template Selection

At clock-in, the API `GET /api/tips/group-templates/eligible` returns templates filtered by the employee's role.

**Request:**
```
GET /api/tips/group-templates/eligible?locationId={id}&employeeId={id}
```

**Response:**
```json
{
  "templates": [
    { "id": "tpl_abc", "name": "Bar Pool", "defaultSplitMode": "equal" },
    { "id": "tpl_def", "name": "Server Team", "defaultSplitMode": "role_weighted" }
  ],
  "allowStandaloneServers": true
}
```

The selected template ID should be sent with the clock-in request as `selectedTipGroupTemplateId`. This is optional -- if omitted, the employee clocks in without a group.

## API Endpoints

### Tip Groups

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/tips/groups?locationId=X&status=active` | List active groups |
| POST | `/api/tips/groups` | Create a new group |
| GET | `/api/tips/groups/{id}` | Get single group detail |
| DELETE | `/api/tips/groups/{id}` | Close a group |
| POST | `/api/tips/groups/{id}/members` | Add member or request to join |
| PUT | `/api/tips/groups/{id}/members` | Approve pending join request |
| DELETE | `/api/tips/groups/{id}/members?employeeId=X` | Remove member / leave group |
| POST | `/api/tips/groups/{id}/transfer` | Transfer group ownership |

### Creating a Group (POST /api/tips/groups)

**Request body:**
```json
{
  "locationId": "string",
  "initialMemberIds": ["emp_1", "emp_2"],
  "registerId": "string (optional)",
  "splitMode": "equal | custom | role_weighted | hours_weighted",
  "customSplits": {
    "emp_1": 0.60,
    "emp_2": 0.40
  }
}
```

- `customSplits` is **required** when `splitMode` is `"custom"`, ignored otherwise.
- Values are decimals (0.40 = 40%) and must sum to 1.0 (within 0.01 tolerance).
- The requesting employee (from `x-employee-id` header) is automatically added as creator/owner.

**Error codes:**
- `409` -- Employee already in another active group.
- `400` -- Missing `customSplits` when mode is `custom`.

### Adding a Member (POST /api/tips/groups/{id}/members)

**Request body:**
```json
{
  "employeeId": "string",
  "action": "add | request"
}
```

- `action: "add"` -- direct add (owner or manager permission required).
- `action: "request"` -- self-service join request, pending owner approval.

### Tip Shift Summary

```
GET /api/tips/my-shift-summary?employeeId=X&locationId=X&date=YYYY-MM-DD
```

**Response:**
```json
{
  "data": {
    "hasGroup": true,
    "groups": [
      {
        "groupId": "string",
        "splitMode": "equal",
        "segments": [
          {
            "segmentId": "string",
            "startedAt": "ISO",
            "endedAt": "ISO | null",
            "memberCount": 3,
            "sharePercent": 33
          }
        ],
        "totalEarnedCents": 4500
      }
    ],
    "totalGroupEarnedCents": 4500
  }
}
```

### Tip Payout (Shift Closeout)

```
POST /api/tips/payouts
```
```json
{
  "locationId": "string",
  "employeeId": "string",
  "amount": 45.00,
  "shiftId": "string (optional)",
  "approvedById": "string (optional)",
  "memo": "string (optional)"
}
```

Payout preview data (balance, CC fees, net) is available from the shift summary endpoint before the employee cashes out.

## Shift Closeout Integration

At shift closeout, display the following based on settings:

1. **Tip earnings summary** -- call `GET /api/tips/my-shift-summary` with the employee's shift date.
2. **CC fee deduction** -- only show if `settings.tipBank.showCCFeeToEmployee` is true. The fee amount comes from `tips:allocated` events (sum of `ccFeeCents`).
3. **Payout method** -- default to `settings.tipBank.defaultPayoutMethod` (`"cash"` or `"payroll"`). Employee can change if `settings.tipBank.allowEODCashOut` is true.
4. **Manager approval** -- if `settings.tipBank.requireManagerApprovalForCashOut` is true, the payout requires manager PIN.

## Headers

All API calls must include:
- `x-employee-id` -- the logged-in employee's ID
- Standard auth headers per `ANDROID-INTEGRATION.md`

## Optional vs Required Features

| Feature | Gate |
|---------|------|
| Group creation UI | `tipGroupsEnabled` AND `allowEmployeeGroupCreation` |
| Group selection at clock-in | `tipGroupsEnabled` |
| Tip badge on POS header | `showTipIndicatorOnPOS` |
| CC fee line in closeout | `showCCFeeToEmployee` |
| "No Group" option at clock-in | `allowStandaloneServers` |
| Cash-out at shift close | `allowEODCashOut` |
| Manager approval for cash-out | `requireManagerApprovalForCashOut` |
| Custom split mode | Available when creating/modifying groups (no separate flag) |
