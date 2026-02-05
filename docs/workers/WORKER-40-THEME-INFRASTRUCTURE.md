# Worker 40: Theme System Infrastructure

You are a DEVELOPER building a theme system for GWI POS Floor Plan.

## Context

The floor plan needs to support both dark and light themes. The current production `/floor-plan` uses a dark slate theme. The new `/test-floorplan` uses a light theme. We need infrastructure to support both.

## Files to Create

```
═══════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - ONLY CREATE/MODIFY THESE FILES
═══════════════════════════════════════════════════════════════════
```

1. `src/lib/theme.ts` - Theme definitions
2. `src/contexts/ThemeContext.tsx` - React context
3. `src/hooks/useTheme.ts` - Hook for theme access
4. `src/app/globals.css` - Add CSS variables (DO NOT remove existing styles)

## Requirements

### 1. Theme Definitions (`src/lib/theme.ts`)

```typescript
export type ThemeName = 'dark' | 'light';

export interface FloorPlanTheme {
  name: ThemeName;

  // Canvas
  canvasBg: string;
  canvasBorder: string;
  gridDot: string;

  // Tables
  tableRectFill: string;
  tableRectStroke: string;
  tableCircleFill: string;
  tableCircleStroke: string;
  tableSelectedGlow: string;

  // Seats
  seatFill: string;
  seatStroke: string;
  seatText: string;
  seatSelectedFill: string;

  // Virtual groups
  virtualGroupBorder: string;
  virtualGroupBg: string;

  // UI
  panelBg: string;
  panelBorder: string;
  textPrimary: string;
  textMuted: string;
  buttonPrimary: string;
  buttonSecondary: string;
}

export const darkTheme: FloorPlanTheme = {
  name: 'dark',

  // Canvas - slate dark gradient
  canvasBg: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
  canvasBorder: 'rgba(255, 255, 255, 0.1)',
  gridDot: 'rgba(99, 102, 241, 0.15)',

  // Tables
  tableRectFill: '#1e293b',
  tableRectStroke: 'rgba(255, 255, 255, 0.2)',
  tableCircleFill: '#22c55e',
  tableCircleStroke: 'rgba(255, 255, 255, 0.3)',
  tableSelectedGlow: '0 0 20px rgba(99, 102, 241, 0.5)',

  // Seats
  seatFill: '#1e293b',
  seatStroke: 'rgba(255, 255, 255, 0.3)',
  seatText: '#fff',
  seatSelectedFill: '#6366f1',

  // Virtual groups
  virtualGroupBorder: 'rgba(99, 102, 241, 0.5)',
  virtualGroupBg: 'rgba(99, 102, 241, 0.1)',

  // UI
  panelBg: 'rgba(15, 23, 42, 0.95)',
  panelBorder: 'rgba(255, 255, 255, 0.1)',
  textPrimary: '#fff',
  textMuted: '#94a3b8',
  buttonPrimary: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  buttonSecondary: 'rgba(255, 255, 255, 0.05)',
};

export const lightTheme: FloorPlanTheme = {
  name: 'light',

  // Canvas - clean white
  canvasBg: '#ffffff',
  canvasBorder: '#e2e8f0',
  gridDot: '#e2e8f0',

  // Tables
  tableRectFill: '#d1fae5',
  tableRectStroke: '#10b981',
  tableCircleFill: '#86efac',
  tableCircleStroke: '#22c55e',
  tableSelectedGlow: '0 0 20px rgba(16, 185, 129, 0.4)',

  // Seats
  seatFill: '#fff',
  seatStroke: '#10b981',
  seatText: '#1e293b',
  seatSelectedFill: '#10b981',

  // Virtual groups
  virtualGroupBorder: 'rgba(99, 102, 241, 0.6)',
  virtualGroupBg: 'rgba(99, 102, 241, 0.05)',

  // UI
  panelBg: '#fff',
  panelBorder: '#e2e8f0',
  textPrimary: '#1e293b',
  textMuted: '#64748b',
  buttonPrimary: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
  buttonSecondary: '#f1f5f9',
};

export const themes: Record<ThemeName, FloorPlanTheme> = {
  dark: darkTheme,
  light: lightTheme,
};
```

### 2. Theme Context (`src/contexts/ThemeContext.tsx`)

```typescript
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ThemeName, FloorPlanTheme, themes } from '@/lib/theme';

interface ThemeContextValue {
  theme: FloorPlanTheme;
  themeName: ThemeName;
  setTheme: (name: ThemeName) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'gwi-floor-plan-theme';

export function ThemeProvider({ children, defaultTheme = 'dark' }: { children: ReactNode; defaultTheme?: ThemeName }) {
  const [themeName, setThemeName] = useState<ThemeName>(defaultTheme);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (stored && themes[stored]) {
      setThemeName(stored);
    }
  }, []);

  // Persist to localStorage
  const setTheme = (name: ThemeName) => {
    setThemeName(name);
    localStorage.setItem(STORAGE_KEY, name);
  };

  const toggleTheme = () => {
    setTheme(themeName === 'dark' ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{
      theme: themes[themeName],
      themeName,
      setTheme,
      toggleTheme,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useFloorPlanTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    // Return dark theme as default if no provider
    return {
      theme: themes.dark,
      themeName: 'dark' as ThemeName,
      setTheme: () => {},
      toggleTheme: () => {},
    };
  }
  return context;
}
```

### 3. Hook (`src/hooks/useTheme.ts`)

```typescript
// Re-export for convenience
export { useFloorPlanTheme } from '@/contexts/ThemeContext';
```

### 4. CSS Variables (ADD to `src/app/globals.css`)

At the TOP of the file, add:

```css
/* Floor Plan Theme Variables */
:root {
  /* Default to dark theme */
  --fp-canvas-bg: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
  --fp-canvas-border: rgba(255, 255, 255, 0.1);
  --fp-grid-dot: rgba(99, 102, 241, 0.15);

  --fp-table-rect-fill: #1e293b;
  --fp-table-rect-stroke: rgba(255, 255, 255, 0.2);
  --fp-table-circle-fill: #22c55e;
  --fp-table-circle-stroke: rgba(255, 255, 255, 0.3);

  --fp-seat-fill: #1e293b;
  --fp-seat-stroke: rgba(255, 255, 255, 0.3);
  --fp-seat-text: #fff;

  --fp-panel-bg: rgba(15, 23, 42, 0.95);
  --fp-panel-border: rgba(255, 255, 255, 0.1);
  --fp-text-primary: #fff;
  --fp-text-muted: #94a3b8;
}

[data-theme="light"] {
  --fp-canvas-bg: #ffffff;
  --fp-canvas-border: #e2e8f0;
  --fp-grid-dot: #e2e8f0;

  --fp-table-rect-fill: #d1fae5;
  --fp-table-rect-stroke: #10b981;
  --fp-table-circle-fill: #86efac;
  --fp-table-circle-stroke: #22c55e;

  --fp-seat-fill: #fff;
  --fp-seat-stroke: #10b981;
  --fp-seat-text: #1e293b;

  --fp-panel-bg: #fff;
  --fp-panel-border: #e2e8f0;
  --fp-text-primary: #1e293b;
  --fp-text-muted: #64748b;
}
```

## Acceptance Criteria

- [ ] `ThemeProvider` wraps children and provides context
- [ ] `useFloorPlanTheme()` returns theme object, name, setTheme, toggleTheme
- [ ] Theme persists to localStorage
- [ ] Dark theme matches current production colors
- [ ] Light theme is clean and professional
- [ ] CSS variables defined for both themes
- [ ] NO changes to any existing components yet

## Limitations

- Do NOT modify any floor plan components
- Do NOT modify any page files
- Only create theme infrastructure
- This is foundation work for Workers 41-44
