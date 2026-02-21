# GWI POS Development Workflow

## MANDATORY: Before Programming Any Feature

### Step 1: Review Skills Index
**REQUIRED** before writing any code:

1. Open `/docs/skills/SKILLS-INDEX.md`
2. Review ALL skills to identify:
   - Which skills will be directly implemented
   - Which skills are prerequisites (dependencies)
   - Which skills can be built in parallel
   - Which skills share components or database models

### Step 2: Create Implementation Plan
Document in your plan file:

```markdown
## Skills Analysis

### Skills Being Implemented
- Skill XX: Name - Brief description
- Skill YY: Name - Brief description

### Dependencies (Must Build First)
- Skill AA: Name - Why needed
- Skill BB: Name - Why needed

### Can Be Parallelized
- Group 1: Skills XX, YY, ZZ (no interdependencies)
- Group 2: Skills AA, BB (no interdependencies)

### Shared Components
- Database models affected: Model1, Model2
- UI components shared: Component1, Component2
- API patterns: pattern description
```

### Step 3: Update CHANGELOG.md
As you work, update `/CHANGELOG.md`:

- Add entries under `[Unreleased]` section
- Group by skill number and name
- Include all files created/modified
- Document any fixes made

### Step 4: Update Skills Index
After completing work:

1. Update status in `/docs/skills/SKILLS-INDEX.md`
2. Mark skills as DONE, PARTIAL, or BLOCKED
3. Update "Next Foundational Skills" if needed

---

## Plan File Template

When creating a new implementation plan, use this structure:

```markdown
# Feature: [Feature Name]

## Skills Analysis

### Skills Being Implemented
| Skill | Name | Notes |
|-------|------|-------|
| XX | Name | What we're building |

### Dependencies
| Skill | Name | Status | Notes |
|-------|------|--------|-------|
| YY | Name | DONE/TODO | Why needed |

### Parallel Opportunities
Skills that can be built simultaneously: XX, YY, ZZ

---

## Database Changes
- Model changes
- Migration needed

## API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/xxx | GET | Description |

## UI Components
| Component | Location | Purpose |
|-----------|----------|---------|
| ComponentName | path/file.tsx | Description |

## Implementation Order
1. Step 1
2. Step 2
3. Step 3

## Verification
- [ ] Test case 1
- [ ] Test case 2
```

---

## CHANGELOG Format

```markdown
## [Unreleased]

### Added

#### Skill Name (Skill XX) - YYYY-MM-DD
- `path/to/file.ts` - Description of what was added
- `path/to/file.tsx` - Description of what was added

### Changed
- `path/to/file.ts` - What changed and why

### Fixed
- Description of bug and fix

---

## Skills Implementation Status

| Skill | Name | Status | Notes |
|-------|------|--------|-------|
| XX | Name | DONE | Implementation notes |
```

---

## Quick Reference: Current Priority Skills

Based on `/docs/skills/SKILLS-INDEX.md`, the next foundational skills are:

1. **Skill 30: Payment Processing** - Required for most features
2. **Skill 07: Send to Kitchen** - Enables order completion
3. **Skill 16: Table Layout** - Foundation for dine-in
4. **Skill 47: Clock In/Out** - Employee time tracking

Always check the skills index for the latest priorities.
