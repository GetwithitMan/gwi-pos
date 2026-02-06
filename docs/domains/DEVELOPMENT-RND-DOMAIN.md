# Development-RnD Domain

**Domain ID:** 15
**Status:** Active Development
**Created:** February 5, 2026

## Overview

The Development-RnD domain covers experimental features, prototyping, technical spikes, and research tasks that don't yet belong to a specific production domain. This is the staging ground for:
- New feature prototypes before they graduate to a production domain
- Technical research and proof-of-concepts
- Architecture experiments and benchmarks
- Cross-domain refactors and tooling improvements
- Developer experience (DX) enhancements

## Domain Trigger

```
PM Mode: Development-RnD
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   DEVELOPMENT-RnD DOMAIN                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │ PROTOTYPES  │    │  RESEARCH   │    │   TOOLING   │        │
│  │  Experimental│    │  Tech spikes│    │  DX & build │        │
│  │  features   │    │  & POCs     │    │  improvements│        │
│  └─────────────┘    └─────────────┘    └─────────────┘        │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                           │                                    │
│                    ┌──────┴──────┐                             │
│                    │  Graduation │                             │
│                    │  Pipeline   │                             │
│                    └──────┬──────┘                             │
│                           │                                    │
│         ┌─────────────────┼─────────────────┐                  │
│         │                 │                 │                  │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐           │
│  │ Production  │  │  Archived   │  │  Abandoned  │           │
│  │  Domain     │  │  (learned)  │  │  (documented)│          │
│  └─────────────┘  └─────────────┘  └─────────────┘           │
│                                                                │
└─────────────────────────────────────────────────────────────────┘
```

## Layer Structure

| Layer | Scope | Files/API Routes |
|-------|-------|------------------|
| **Prototypes** | Experimental feature implementations | `/src/app/(admin)/rnd/`, `/src/components/rnd/` |
| **Research** | Technical spikes, benchmarks, POCs | `/docs/rnd/research/` |
| **Tooling** | Build tools, scripts, DX improvements | `/scripts/`, `/src/lib/dev-tools/` |
| **Architecture** | Cross-domain refactors, pattern research | `/docs/rnd/architecture/` |
| **Benchmarks** | Performance testing and comparison | `/docs/rnd/benchmarks/` |

## Graduation Process

When an RnD feature is ready for production:

1. **Document the findings** - What worked, what didn't, key decisions
2. **Identify target domain** - Which production domain owns this feature
3. **Create worker prompts** - Using the target domain's PM Mode
4. **Move code** - From `/rnd/` paths to production domain paths
5. **Archive the spike** - Keep research docs, remove experimental code

## Integration Points

| Domain | Relationship |
|--------|-------------|
| All Domains | RnD features may graduate to any production domain |
| Settings | Experimental feature flags |
| Hardware | New device/protocol research |
| Menu | New item type experiments |

## Feature Flag Convention

RnD features behind flags use this pattern:
```typescript
// In settings or .env.local
RND_FEATURE_NAME=true

// In code
if (process.env.RND_FEATURE_NAME === 'true') {
  // experimental code path
}
```

## Key Rules

1. **RnD code must NOT ship to production** - Always behind feature flags or in `/rnd/` paths
2. **Document everything** - Failed experiments are valuable learning
3. **Time-box spikes** - Set clear goals and deadlines for research
4. **No production dependencies** - Production code must never import from `/rnd/` paths
5. **Graduation is mandatory** - Features don't live in RnD forever; they graduate or get archived
