# Reinstall Policy

## Current Behavior

Reinstalls use **warn-continue** on schema migration failures to preserve
existing venue data. The installer will log schema warnings but will not
abort the deployment.

## Rationale

Hard-bricking a live venue with customer data, active orders, and payment
history is categorically worse than operating with a schema warning. A
venue that can still take orders with a lagging schema is recoverable; a
venue that refuses to boot is a business-critical outage.

## Known Risk

A venue could continue operating on a **partially migrated schema**. This
may cause runtime errors on features that depend on new columns or tables.
This is an accepted risk, not a resolved issue. It stays on the risk
register until we move to fail-closed mode.

## Operator Recovery Path

If a reinstall produces schema warnings:

1. Check the boot report at `/opt/gwi-pos/shared/state/boot-report.json`
2. Run `gwi-node status` to verify convergence
3. If schema is behind: run `gwi-node deploy` to re-attempt migration
4. If still failing: escalate to engineering with the boot report attached

Do not attempt manual SQL fixes or hotfixes on the NUC.

## Future Direction

Move to **fail-closed** with an explicit `--force-reinstall` break-glass
flag. Under fail-closed mode, schema failures will abort the install
unless the operator explicitly opts in to warn-continue via the flag.
This requires confidence that migrations are idempotent and tested
against every supported schema version.
