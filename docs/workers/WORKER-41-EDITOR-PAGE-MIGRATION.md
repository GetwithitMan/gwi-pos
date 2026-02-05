# Worker 41: Editor Page Migration

You are a DEVELOPER replacing the monolithic floor plan editor page with the new domain-based editor.

## Context

The current `/floor-plan` page is a 2035-line monolithic component. The new `FloorPlanEditor` from `src/domains/floor-plan/admin/` is modular and well-tested. We need to replace the page contents while keeping the admin layout.

## Files to Modify

```
═══════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - ONLY MODIFY THIS FILE
═══════════════════════════════════════════════════════════════════
```

1. `src/app/(admin)/floor-plan/page.tsx` - REPLACE contents

## Current State

The current page:
- 2035 lines of monolithic code
- Uses `useFloorPlanStore` from components
- Has inline drag handlers, collision detection
- Uses `FloorPlanTable`, `FloorPlanEntertainment` components
- Has `PropertiesSidebar`, `RoomTabs`, `AddRoomModal`

## Target State

The new page should:
- Import `FloorPlanEditor` from `@/domains/floor-plan/admin`
- Keep `AdminPageHeader` and `AdminSubNav` for navigation
- Wrap in `ThemeProvider` with theme toggle button
- Be < 100 lines

## Implementation

### New `src/app/(admin)/floor-plan/page.tsx`

```typescript
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminSubNav, floorSubNav } from '@/components/admin/AdminSubNav';
import { FloorPlanEditor } from '@/domains/floor-plan/admin';
import { ThemeProvider, useFloorPlanTheme } from '@/contexts/ThemeContext';

function FloorPlanEditorWithTheme() {
  const { theme, themeName, toggleTheme } = useFloorPlanTheme();
  const { employee } = useAuthStore();

  if (!employee?.location?.id) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading location...
      </div>
    );
  }

  return (
    <div data-theme={themeName}>
      {/* Theme Toggle in Header */}
      <div className="flex justify-end mb-4">
        <button
          onClick={toggleTheme}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background: theme.buttonSecondary,
            color: theme.textMuted,
            border: `1px solid ${theme.panelBorder}`,
          }}
        >
          {themeName === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
        </button>
      </div>

      {/* Floor Plan Editor */}
      <FloorPlanEditor
        locationId={employee.location.id}
        onExit={() => window.location.href = '/orders'}
        theme={theme}
      />
    </div>
  );
}

export default function FloorPlanPage() {
  const router = useRouter();
  const { isAuthenticated, employee } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/floor-plan');
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated || !employee?.location?.id) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 p-6">
      <AdminPageHeader
        title="Floor Plan Editor"
        subtitle="Drag tables to position them. Click to edit properties and seats."
      />
      <AdminSubNav items={floorSubNav} basePath="/floor-plan" />

      <div className="mt-6">
        <ThemeProvider defaultTheme="dark">
          <FloorPlanEditorWithTheme />
        </ThemeProvider>
      </div>
    </div>
  );
}
```

## Required Updates to FloorPlanEditor

The `FloorPlanEditor` component needs a `theme` prop. If it doesn't have one yet, add this interface update:

In `src/domains/floor-plan/admin/FloorPlanEditor.tsx`, ensure the props include:

```typescript
interface FloorPlanEditorProps {
  locationId: string;
  onExit?: () => void;
  theme?: FloorPlanTheme;  // Add this
}
```

And apply theme colors where appropriate (or pass down to child components).

## Backup

Before replacing, create backup:
```bash
cp src/app/(admin)/floor-plan/page.tsx src/app/(admin)/floor-plan/page.old.tsx
```

## Acceptance Criteria

- [ ] Page loads without errors
- [ ] Admin header and sub-nav still visible
- [ ] FloorPlanEditor renders with all tools
- [ ] Theme toggle button works
- [ ] Dark/light themes apply correctly
- [ ] Tables can be created, dragged, edited
- [ ] Rooms/sections work
- [ ] Entertainment elements work
- [ ] Save functionality works
- [ ] Exit button navigates to /orders

## Limitations

- Do NOT modify `FloorPlanEditor.tsx` beyond adding theme prop
- Do NOT change any APIs
- Do NOT modify other pages
- Keep the backup file for rollback
