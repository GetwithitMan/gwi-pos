# GWI POS Conventions

## All Workers Must Follow These Rules

This document ensures consistency across all Claude instances working on this project.

---

## 1. Before Starting ANY Work

```
1. Read /.claude/PROJECT.md to understand the project
2. Read /.claude/ARCHITECTURE.md to understand the tech
3. Check /.claude/TASKS.md for your assigned task
4. Read /CLAUDE.md for developer conventions
5. NEVER start work without PM assignment
```

---

## 2. Database Conventions

### Multi-Tenancy (CRITICAL)
```typescript
// ALWAYS filter by locationId
const items = await db.menuItem.findMany({
  where: { locationId, deletedAt: null }
})

// ALWAYS include locationId when creating
await db.orderItem.create({
  data: { locationId, ...otherFields }
})
```

### Soft Deletes (CRITICAL)
```typescript
// ❌ NEVER hard delete
await db.menuItem.delete({ where: { id } })

// ✅ ALWAYS soft delete
await db.menuItem.update({
  where: { id },
  data: { deletedAt: new Date() }
})

// ✅ ALWAYS filter out deleted records
where: { deletedAt: null }
```

### ID Format
- All IDs use `cuid()` (collision-safe for sync)
- Never use auto-increment integers

---

## 3. API Conventions

### Response Format
```typescript
// Success
return NextResponse.json({ data: result })

// Error
return NextResponse.json({ error: "Message" }, { status: 400 })
```

### Route Structure
```
/api/[domain]/route.ts           - Collection (GET list, POST create)
/api/[domain]/[id]/route.ts      - Single item (GET, PATCH, DELETE)
/api/[domain]/[id]/[action]/route.ts - Actions (POST)
```

### Decimal Handling
```typescript
// Convert Prisma Decimals to numbers in response
return NextResponse.json({
  data: {
    ...item,
    price: Number(item.price)
  }
})
```

---

## 4. Component Conventions

### File Naming
```
components/
  orders/
    OrderList.tsx        # PascalCase for components
    order-utils.ts       # kebab-case for utilities
    use-orders.ts        # use- prefix for hooks
```

### Component Structure
```typescript
// Props interface at top
interface OrderCardProps {
  order: Order
  onSelect: (id: string) => void
}

// Export named function (not default)
export function OrderCard({ order, onSelect }: OrderCardProps) {
  // ...
}
```

### Styling
- Use Tailwind CSS classes
- Follow glassmorphism theme (backdrop-blur, gradients)
- Bar mode: Blue theme
- Food mode: Orange theme

---

## 5. Documentation Conventions

### Skill File Headers (Required)
```markdown
# Skill Name

**Skill ID:** XX
**Status:** [Planning | In Development | Functional | Production]
**Progress:** XX%
**Priority:** [Critical | High | Medium | Low]
**Last Updated:** YYYY-MM-DD
**Owner:** [name or team]

---
```

### New Documentation Files
- Location: `/docs/` for project docs
- Location: `/docs/skills/` for skill specs
- Format: UPPER-CASE-WITH-DASHES.md

---

## 6. Git Conventions

### Branch Naming
```
feature/[skill-id]-[short-description]
fix/[skill-id]-[short-description]
docs/[short-description]
```

### Commit Messages
```
[type]: [short description]

[longer description if needed]

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

### Before Committing
- Run `npm run lint`
- Test the feature manually
- Backup database if schema changes: `npm run db:backup`

---

## 7. Testing Conventions

### File Location
```
src/
  app/
    api/
      orders/
        route.ts
        route.test.ts    # Co-located tests
```

### Test Naming
```typescript
describe('Orders API', () => {
  it('should create order with valid data', async () => {
    // ...
  })

  it('should reject order without locationId', async () => {
    // ...
  })
})
```

---

## 8. Error Handling

### API Errors
```typescript
try {
  // operation
} catch (error) {
  console.error('[OrdersAPI] Failed to create order:', error)
  return NextResponse.json(
    { error: 'Failed to create order' },
    { status: 500 }
  )
}
```

### Client Errors
```typescript
// Use toast notifications for user-facing errors
toast.error('Failed to save order')

// Log detailed errors for debugging
console.error('[OrderStore] Save failed:', error)
```

---

## 9. Performance Rules

### Query Optimization
```typescript
// ✅ Select only needed fields
await db.order.findMany({
  select: { id: true, total: true, status: true }
})

// ❌ Don't fetch everything
await db.order.findMany({
  include: { items: { include: { modifiers: true } } }
})
```

### State Management
```typescript
// ✅ Use Zustand for global state
// ✅ Use React state for local UI state
// ❌ Don't duplicate server state in global store
```

---

## 10. Reporting Work to PM

### When Starting
```
Starting Task [ID]: [Brief description]
Reading relevant files...
```

### When Complete
```
Completed Task [ID]: [Brief description]

Files Changed:
- /path/to/file1.ts (created/modified)
- /path/to/file2.ts (modified)

Summary:
[What was done]

Testing:
[How it was tested]

Notes:
[Any issues or follow-ups needed]
```

### If Blocked
```
BLOCKED on Task [ID]: [Brief description]

Blocker: [What's preventing progress]
Need: [What's required to unblock]
```

---

## Quick Reference

| Rule | Summary |
|------|---------|
| locationId | ALWAYS include in queries and creates |
| deletedAt | NEVER hard delete, always soft delete |
| IDs | Use cuid(), never auto-increment |
| API response | `{ data }` or `{ error }` |
| Components | PascalCase, named exports |
| Tests | Co-located with source files |
| Commits | Type prefix, co-author line |

---
*Last Updated: January 30, 2026*
