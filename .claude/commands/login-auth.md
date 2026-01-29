# Login & Authentication

PIN-based login system for POS access.

## Overview

GWI POS uses PIN-based authentication for fast employee login without passwords. Each employee has a unique 4-6 digit PIN.

## Login Flow

### PIN Entry
1. Navigate to `/login`
2. Enter 4-6 digit PIN
3. System validates PIN
4. Redirects to POS (`/orders`)

### PIN Validation
- PIN must be unique per location
- 4-6 digits required
- No letters or special characters
- Stored securely (hashed)

## Session Management

### Session Creation
- On successful login:
  - Employee record loaded
  - Role & permissions loaded
  - Location context set
  - Session token created

### Session Storage
```typescript
// Auth store (Zustand)
{
  employee: {
    id: "emp-123",
    firstName: "John",
    lastName: "Doe",
    displayName: "John D.",
    role: { name: "Server", permissions: [...] },
    location: { id: "loc-1", name: "Main" }
  },
  isAuthenticated: true
}
```

### Session Persistence
- Stored in localStorage
- Survives page refresh
- Clears on logout

## Logout

### Manual Logout
1. Click user menu (top right)
2. Select "Logout"
3. Session cleared
4. Redirect to login

### Auto Logout
- Configurable timeout (optional)
- After X minutes of inactivity
- Requires re-login

## Shift Integration

### Clock In Check
On login, system checks:
1. Is employee clocked in?
2. If no, prompt to start shift
3. If yes, show shift status

### Shift Required
- Can require clock-in before POS access
- Configurable per location

## Multiple Employees

### Quick Switch
1. Click user name
2. Select "Switch User"
3. Enter new PIN
4. Previous session ends

### Shared Device
- Multiple employees use same terminal
- Each logs in with own PIN
- Orders tied to logged-in employee

## Permissions

### On Login
- Permissions loaded from role
- Stored in session
- Checked on each action

### Permission Check
```typescript
const canVoid = employee.permissions.includes('void_items')
const isManager = employee.role.name === 'Manager'
```

## Security

### PIN Requirements
- Minimum 4 digits
- Maximum 6 digits
- Must be unique in location
- No sequential (1234) - optional

### Failed Attempts
- Track failed login attempts
- Lock after X failures (optional)
- Manager can unlock

### Audit Trail
- All logins logged
- IP address recorded
- Timestamp recorded

## Demo Credentials

| Role | PIN | Description |
|------|-----|-------------|
| Manager | 1234 | Full admin access |
| Server | 2345 | Server permissions |
| Bartender | 3456 | Bar permissions |

## API Endpoints

### Login
```
POST /api/auth/login
{
  "pin": "1234",
  "locationId": "loc-1"
}

Response:
{
  "employee": {...},
  "token": "xxx"
}
```

### Validate Session
```
GET /api/auth/session
Authorization: Bearer xxx
```

### Logout
```
POST /api/auth/logout
```

## Auth Store

### Zustand Store
```typescript
interface AuthState {
  employee: Employee | null
  isAuthenticated: boolean
  login: (pin: string) => Promise<boolean>
  logout: () => void
  checkSession: () => Promise<void>
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(auth)/login/page.tsx` | Login page |
| `src/stores/auth-store.ts` | Auth state management |
| `src/app/api/auth/login/route.ts` | Login API |
| `src/middleware.ts` | Route protection |
| `src/components/auth/PinPad.tsx` | PIN entry component |
