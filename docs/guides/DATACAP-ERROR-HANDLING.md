# Datacap Error Code Reference

Comprehensive reference for all Datacap DSIX return codes, decline reasons, and error recovery guidance.

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/datacap/response-codes.ts` | DSIX codes, processor decline map, lookup functions |
| `src/lib/datacap/constants.ts` | Error codes (simplified), card/entry/CVM maps |

## DSIX Return Code Categories

DSIX return codes are 6-digit strings. The first 3 digits indicate the category:

| Prefix | Category | Retryable | Action |
|--------|----------|-----------|--------|
| `000xxx` | **Approval** | N/A | Transaction succeeded |
| `001xxx` | **Issuer Decline** | Usually no | Customer issue — try different card |
| `002xxx` | **Processing Error** | Usually yes | Retry the transaction |
| `003xxx` | **Device/Communication** | Yes | Check hardware/network, retry |
| `004xxx` | **Configuration** | No | Fix POS/reader config |
| `005xxx` | **Batch** | Varies | Check batch status |

## Approval Codes (000xxx)

| Code | Label | Notes |
|------|-------|-------|
| `000000` | Approved | Standard approval |
| `000001` | Partial Approval | Approved for less than requested — collect remaining via another method |
| `000002` | Approved (No Duplicate) | Duplicate check passed |
| `000004` | Approved (ID Required) | Issuer requests ID verification — staff should check |
| `000006` | Approved (Offline) | SAF mode — will upload when connectivity restored |

**Partial Approval Handling:** When `000001` is returned, the POS must collect the remaining balance via a second payment method. The partial amount is in the Datacap response. Never void a partial approval without processing the remainder first.

## Common Decline Reasons

### Staff vs Customer Messaging

**SECURITY RULE:** Some decline reasons have different messages for staff and customers. Staff sees the real reason; the customer-facing display shows a sanitized message. This prevents tipping off bad actors.

Examples:
- Staff: `"STOLEN CARD — card reported stolen. Do NOT return card."` / Customer: `"Card cannot be processed."`
- Staff: `"SUSPECTED FRAUD — issuer fraud detection triggered"` / Customer: `"Card declined. Please contact your card issuer."`

Use `getDeclineReason(returnCode)` from `response-codes.ts` to get both messages.

### Issuer Declines (001xxx) — Customer Should Act

| Code | Reason | Staff Action |
|------|--------|-------------|
| `001001` | Generic decline | Ask for different card |
| `001004` | Pick up card | **DO NOT RETURN CARD** — possible fraud |
| `001005` | Do Not Honor | Customer should call bank |
| `001007` | Pick up card (fraud) | **DO NOT RETURN CARD** |
| `001041` | Lost card | **DO NOT RETURN CARD** |
| `001043` | Stolen card | **DO NOT RETURN CARD** |
| `001051` | Insufficient funds | Try smaller amount or different card |
| `001054` | Expired card | Customer needs new card |
| `001055` | Invalid PIN | Customer can retry with correct PIN |
| `001059` | Suspected fraud | Customer should call bank |
| `001075` | PIN tries exceeded | Card locked — customer must call bank |
| `001099` | Duplicate transaction | Verify if intentional before overriding |

### Processing Errors (002xxx) — POS/System Issue

| Code | Reason | Staff Action |
|------|--------|-------------|
| `002001` | Processing error | Retry the transaction |
| `002003` | Record not found | Original may have been voided or settled |
| `002005` | Format error | POS software issue — contact support |
| `002010` | Void not allowed | Transaction already settled — use refund |
| `002020` | Amount mismatch | Verify amounts match original auth |

### Device/Communication (003xxx) — Hardware/Network Issue

| Code | Reason | Staff Action |
|------|--------|-------------|
| `003001` | Device not ready | Wait and retry |
| `003002` | Device busy | Wait for current transaction to complete |
| `003003` | Device error | Try pad reset, then reboot reader |
| `003004` | Device not found | Check network/power connections |
| `003005` | Card read error | Have customer retry insert/tap, or swipe |
| `003008` | Card removed early | Ask customer to leave card until prompted |
| `003009` | Chip fallback | Ask customer to swipe instead |
| `003010` | Contactless limit | Amount too high for tap — insert chip |
| `003020` | Communication error | Check network, retry |
| `003021` | Host unreachable | Check internet connectivity |
| `003024` | DNS resolution failed | Check DNS settings |

### Configuration (004xxx) — Setup Required

| Code | Reason | Staff Action |
|------|--------|-------------|
| `004001` | Invalid merchant ID | Check Datacap config in Settings |
| `004002` | Invalid terminal ID | Reconfigure reader |
| `004003` | Param download required | Run EMVParamDownload from Settings |
| `004005` | Unsupported operation | Check terminal capabilities |

### Batch (005xxx) — Settlement Issue

| Code | Reason | Staff Action |
|------|--------|-------------|
| `005001` | Batch empty | No transactions to settle |
| `005002` | Batch close error | Retry or contact support |
| `005003` | Batch already closed | No action needed |
| `005004` | Batch out of balance | Run reconciliation |

## Error Recovery Decision Tree

```
Transaction failed
  |
  +-- CmdStatus = "Declined"?
  |     |
  |     +-- isRetryable = true? --> Retry once, then ask for different card
  |     +-- isRetryable = false? --> Ask for different card (do NOT retry)
  |     +-- Code 001004/001007/001041/001043? --> DO NOT RETURN CARD
  |
  +-- CmdStatus = "Error"?
  |     |
  |     +-- Code starts with 002? --> Retry transaction
  |     +-- Code starts with 003? --> Check hardware/network, retry
  |     +-- Code starts with 004? --> Fix configuration (no retry)
  |     +-- Code starts with 005? --> Batch issue (check settlement)
  |
  +-- No response / timeout?
        |
        +-- Check _pending_datacap_sales for orphan
        +-- DO NOT retry immediately (may double-charge)
        +-- Wait for reconciliation cron (5 min)
```

## PCI-Safe Logging Guidelines

**NEVER log:**
- Full card numbers (PAN)
- CVV/CVC codes
- Track data
- PIN blocks
- Full magnetic stripe data

**Safe to log:**
- Last 4 digits of card number (`cardLast4`)
- Card brand/type
- Authorization codes
- DSIX return codes
- CmdStatus values
- Transaction amounts
- Record numbers
- Entry method (chip/tap/swipe)

The `response-codes.ts` module is designed to produce safe log messages. Use `getResponseDescription(cmdStatus, returnCode)` for log entries.

## Processor Decline Text Mapping

Datacap also returns free-text `textResponse` values from the processor. The `PROCESSOR_DECLINE_MAP` in `response-codes.ts` maps these to staff/customer messages. Common examples:

| textResponse | Staff Message | Retryable |
|-------------|---------------|-----------|
| `INSUFFICIENT FUNDS` | Insufficient funds | No |
| `DO NOT HONOR` | Issuer declined without reason | No |
| `EXPIRED CARD` | Card expired | No |
| `SUSPECTED FRAUD` | SUSPECTED FRAUD (alert) | No |
| `LOST/STOLEN CARD` | LOST/STOLEN CARD (alert) | No |
| `INVALID PIN` | Invalid PIN entered | Yes |
| `RE-ENTER TRANSACTION` | Processor requests retry | Yes |
| `SYSTEM ERROR` | System error at processor | Yes |
| `HOST UNAVAILABLE` | Processor host unavailable | Yes |

Use `getDeclineReason(returnCode)` for DSIX codes and the `PROCESSOR_DECLINE_MAP` for text responses. Both return `{ staffMessage, customerMessage, isRetryable }`.

## CmdStatus Values

| Value | Meaning |
|-------|---------|
| `Approved` | Transaction approved by issuer/processor |
| `Declined` | Transaction declined — check `dsixReturnCode` for reason |
| `Error` | Processing error — check `dsixReturnCode` and `textResponse` |
| `Success` | Admin command succeeded (batch close, SAF forward, pad reset) |
