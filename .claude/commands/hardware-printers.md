# Hardware Printers (Skill 102)

## Overview

Configure and manage receipt and kitchen printers for the POS system. Supports thermal receipt printers and impact kitchen printers with two-color ribbon support.

**Related Skills:**
- [Print Routing](./print-routing.md) - Configure which printers receive which items

## Admin Location

`/settings/hardware` - Hardware configuration page

## Printer Types

| Type | Use Case | Examples |
|------|----------|----------|
| `thermal` | Receipt printers | Epson TM-T88, Star TSP |
| `impact` | Kitchen printers | Epson TM-U220 |

## Printer Roles

| Role | Description |
|------|-------------|
| `receipt` | Customer receipts |
| `kitchen` | Kitchen/food prep tickets |
| `bar` | Bar tickets |

## Database Models

### Printer
```prisma
model Printer {
  id           String   @id @default(cuid())
  locationId   String
  name         String
  printerType  String   // 'thermal' | 'impact'
  printerRole  String   // 'receipt' | 'kitchen' | 'bar'
  ipAddress    String
  port         Int      @default(9100)
  paperWidth   Int      @default(80) // 80mm or 58mm
  supportsCut  Boolean  @default(true)
  isDefault    Boolean  @default(false)
  isActive     Boolean  @default(true)
  printSettings Json?   // PrinterSettings object
}
```

### PrinterSettings Type
```typescript
interface PrinterSettings {
  textSizing: {
    headerSize: 'normal' | 'large' | 'xlarge'
    itemNameSize: 'normal' | 'large' | 'xlarge'
    modifierSize: 'small' | 'normal' | 'large'
    notesSize: 'normal' | 'large'
  }
  ribbon: {
    hasRedRibbon: boolean
    useRedForResend: boolean
    useRedForNoItems: boolean
    useRedForAllergies: boolean
    useRedForNotes: boolean
    useRedForHeaders: boolean
  }
  formatting: {
    allCapsItems: boolean
    allCapsMods: boolean
    compactSpacing: boolean
    dividerStyle: 'dashes' | 'equals' | 'stars' | 'none'
  }
}
```

## ESC/POS Commands

### Text Sizing

**Thermal Printers (GS !):**
- `0x1d 0x21 0x11` - Double width + height
- `0x1d 0x21 0x01` - Double height only
- `0x1d 0x21 0x00` - Normal size

**Impact Printers (ESC !):**
- `0x1b 0x21 0x30` - Double width + height
- `0x1b 0x21 0x10` - Double height only
- `0x1b 0x21 0x00` - Normal size

### Two-Color (Red Ribbon)
- `0x1b 0x72 0x01` - Red color
- `0x1b 0x72 0x00` - Black color

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/hardware/printers?locationId=xxx` | List printers |
| POST | `/api/hardware/printers` | Create printer |
| PUT | `/api/hardware/printers/[id]` | Update printer |
| DELETE | `/api/hardware/printers/[id]` | Delete printer |
| POST | `/api/hardware/printers/[id]/test` | Test print |

## Test Print

The test print includes:
- Printer name and IP
- Paper width test
- Text sizing samples (Normal, Large, XLarge)
- Two-color test (if red ribbon enabled)
- Cut command

## Key Files

- `src/lib/escpos/commands.ts` - ESC/POS command constants
- `src/lib/escpos/document.ts` - Document building utilities
- `src/lib/printer-connection.ts` - TCP socket communication
- `src/app/api/hardware/printers/route.ts` - Printer CRUD API
- `src/types/printer-settings.ts` - PrinterSettings types
- `src/components/hardware/PrinterSettingsEditor.tsx` - Settings UI

## Troubleshooting

### Printer Not Responding
1. Verify IP address is correct
2. Check printer is powered on and connected to network
3. Ensure port 9100 is not blocked
4. Try test print from printer's web interface

### Text Wrapping Issues
- Use TALL (height only) instead of LARGE (width + height) for long text
- Double-width effectively halves available characters

### Impact Printer Commands Not Working
- TM-U220 uses ESC ! commands, not GS ! commands
- Check `printerType` is set to 'impact'
