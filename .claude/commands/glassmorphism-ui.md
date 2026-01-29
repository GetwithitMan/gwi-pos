# Glassmorphism UI (Skill 100)

Modern glass effect styling throughout the POS interface.

## Overview

The POS uses glassmorphism design - frosted glass panels with backdrop blur, soft gradients, and semi-transparent overlays for a sleek, modern look.

## Theme Modes

### Bar Mode (Blue Theme)
- Primary gradient: Blue to Cyan
- Background: `from-slate-900 via-blue-900 to-slate-900`
- Accent: `from-blue-500 to-cyan-500`
- Used when viewing liquor/bar categories

### Food Mode (Orange Theme)
- Primary gradient: Orange to Amber
- Background: `from-slate-900 via-orange-900 to-slate-900`
- Accent: `from-orange-500 to-amber-500`
- Used when viewing food categories

## Glass Panel Styling

### Standard Glass Panel
```css
bg-white/10
backdrop-blur-xl
border border-white/20
rounded-2xl
shadow-xl
```

### Glass Button (Unselected)
```css
bg-white/60
hover:bg-white/80
text-gray-700
border border-white/40
hover:shadow-md
```

### Glass Button (Selected)
```css
bg-gradient-to-r from-blue-500 to-cyan-500 /* or orange for food mode */
text-white
shadow-md
shadow-blue-500/25
```

## Component Patterns

### Header Bar
```tsx
<div className="bg-gradient-to-r from-slate-900/95 via-blue-900/95 to-slate-900/95 backdrop-blur-xl">
```

### Content Panel
```tsx
<div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl">
```

### Category Button
```tsx
<button className={`
  px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200
  ${isSelected
    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-md shadow-blue-500/25'
    : 'bg-white/60 hover:bg-white/80 text-gray-700 border border-white/40'
  }
`}>
```

### Menu Item Card
```tsx
<div className="bg-white/80 backdrop-blur-sm rounded-xl p-3 hover:bg-white/90 transition-all">
```

## Animation Classes

| Class | Effect |
|-------|--------|
| `transition-all duration-200` | Smooth hover transitions |
| `hover:scale-105` | Slight grow on hover |
| `hover:shadow-lg` | Shadow appears on hover |
| `animate-pulse` | Loading state pulse |

## Color Utilities

### Transparency Levels
- `/10` - 10% opacity (very transparent)
- `/20` - 20% opacity (glass border)
- `/40` - 40% opacity (light overlay)
- `/60` - 60% opacity (semi-opaque)
- `/80` - 80% opacity (near solid)
- `/95` - 95% opacity (header bars)

### Shadow Colors
```css
shadow-blue-500/25  /* 25% opacity blue shadow */
shadow-orange-500/25 /* 25% opacity orange shadow */
```

## Responsive Considerations

- Backdrop blur may impact performance on older devices
- Consider reducing blur on mobile: `md:backdrop-blur-xl backdrop-blur-md`
- Glass effects work best on dark backgrounds

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(pos)/orders/page.tsx` | Main POS glassmorphism styling |
| `tailwind.config.ts` | Custom color definitions |
