# PM Prompts Directory

This directory contains reusable prompts for managing the GWI POS project using a terminal hierarchy system.

## How It Works

The project uses a chain of command where each terminal has a specific role:

```
ARCHITECT (You)
    ↓
DOMAIN PM (one per domain)
    ↓
SUB-PMs (Frontend, Backend, API)
    ↓
WORKERS (write code)
```

## Available Prompts

| File | Role | Use When |
|------|------|----------|
| `architect-prompt.md` | System Architect | Managing multiple domains, defining bridges |
| `floorplan-domain-pm-prompt.md` | Floor Plan Domain PM | Managing floor plan layers |
| `worker-prompt-template.md` | Worker Template | Assigning coding tasks |

## Quick Start

### Single-Domain Work (Most Common)

If you're only working on Floor Plan:

1. Open Claude Code
2. Read `/docs/domains/floorplan/spec.md`
3. Work on one layer at a time
4. Use the worker template when needed

### Multi-Domain Work

If you need to coordinate multiple domains:

1. Use the Architect prompt in your main terminal
2. Spin up Domain PM terminals for each active domain
3. Let Domain PMs manage their Sub-PMs

## Practical Tips

1. **You don't need all prompts at once.** Start simple — you can be Architect + Domain PM while there's only one domain.

2. **Read the spec before working.** The spec at `/docs/domains/floorplan/spec.md` has everything you need.

3. **Stay in your directory.** Each layer has its own folder. Don't cross boundaries.

4. **Test in isolation first.** Get each layer working before integrating.

5. **Ask before adding.** If something's not in the spec, ask before building it.

## File Structure After Using This System

```
src/domains/floor-plan/
  ├── shared/           ← Types all layers use
  ├── canvas/           ← Layer 1
  ├── tables/           ← Layer 2
  ├── seats/            ← Layer 3
  ├── groups/           ← Layer 4
  ├── admin/            ← Layer 5
  ├── staff/            ← Layer 6
  ├── status/           ← Layer 7
  ├── entertainment/    ← Layer 8
  └── waitlist/         ← Layer 9
```
