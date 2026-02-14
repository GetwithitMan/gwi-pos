# Troubleshooting

Common issues and solutions for GWI POS.

## Quick Fixes

### "Try turning it off and on again"
```bash
# Restart dev server
Ctrl+C
npm run dev
```

### Regenerate Prisma Client
```bash
npx prisma generate
```

### Clear Next.js Cache
```bash
rm -rf .next
npm run dev
```

## Common Issues

### Database Issues

#### "Table does not exist"
**Cause:** Schema out of sync with database
**Fix:**
```bash
npx prisma db push
```

#### "Unique constraint failed"
**Cause:** Duplicate data (e.g., same PIN, same slug)
**Fix:** Check for duplicates, use unique values

#### "Foreign key constraint failed"
**Cause:** Referenced record doesn't exist
**Fix:** Ensure parent record exists first

#### Database Locked
**Cause:** Multiple connections or crashed process
**Fix:**
```bash
# Kill any hanging processes
pkill -f "prisma"
# Restart server
npm run dev
```

### API Issues

#### 500 Internal Server Error
**Check:**
1. Server console for error message
2. Database connection
3. Missing environment variables

**Debug:**
```bash
# Check server logs
npm run dev
# Look for red error messages
```

#### 404 Not Found
**Cause:** Route doesn't exist or wrong method
**Fix:** Check URL and HTTP method (GET vs POST)

#### 401 Unauthorized
**Cause:** Not logged in or session expired
**Fix:** Login again, check auth store

### UI Issues

#### Items Not Showing
**Check:**
1. Category has items?
2. Items marked as available?
3. Schedule restrictions?
4. Correct locationId?

**Debug:**
```bash
# Check API directly
curl "http://localhost:3000/api/menu?locationId=loc-1"
```

#### Order Types Not Showing
**Check:**
1. Order types exist for location?
2. Order types marked active?
3. API returning data?

**Debug:**
```bash
curl "http://localhost:3000/api/order-types?locationId=loc-1"
```

#### Styles Broken
**Cause:** Tailwind not building
**Fix:**
```bash
rm -rf .next
npm run dev
```

### Login Issues

#### PIN Not Working
**Check:**
1. Correct PIN?
2. Employee active?
3. Correct location?

**Debug:**
```bash
# Check employee in database
psql $DATABASE_URL -c "SELECT * FROM \"Employee\" WHERE pin='1234';"
```

#### Session Keeps Logging Out
**Cause:** localStorage issue or expired session
**Fix:** Clear localStorage, login again

### Payment Issues

#### Payment Not Processing
**Check:**
1. Payment processor configured?
2. API keys correct?
3. Test mode vs live mode?

#### Pre-Auth Not Capturing
**Check:**
1. Pre-auth not expired?
2. Sufficient funds?
3. Correct order linked?

### KDS Issues

#### Orders Not Appearing
**Check:**
1. KDS connected to correct location?
2. Order sent to kitchen?
3. Order type shows on KDS?

**Debug:**
```bash
curl "http://localhost:3000/api/kds?locationId=loc-1"
```

#### Items Already Completed
**Check:** Order status, item completion status

### Print Issues

#### Receipt Not Printing
**Check:**
1. Printer configured?
2. Printer online?
3. Correct printer IP?

#### Kitchen Ticket Missing Items
**Check:** Category routing, printer assignment

## Debugging Tools

### Database Studio
```bash
npm run db:studio
```
Opens visual database browser at localhost:5555

### API Testing
```bash
# Test API endpoints directly
curl -X GET "http://localhost:3000/api/menu?locationId=loc-1"
curl -X POST "http://localhost:3000/api/orders" -H "Content-Type: application/json" -d '{...}'
```

### Browser DevTools
- Network tab: Check API calls
- Console: JavaScript errors
- Application: localStorage/session

### Server Logs
- Watch terminal running `npm run dev`
- Look for red error messages
- Stack traces show file locations

## Reset Procedures

### Soft Reset
```bash
# Restart server
Ctrl+C
npm run dev
```

### Clear Cache
```bash
rm -rf .next
npm run dev
```

### Regenerate Client
```bash
npx prisma generate
npm run dev
```

### Full Reset (DESTRUCTIVE)
```bash
# WARNING: Deletes all data!
npm run db:backup  # Backup first!
npm run reset
```

## Getting Help

### Before Asking
1. Check this troubleshooting guide
2. Read error message carefully
3. Check server logs
4. Try quick fixes above

### Information to Provide
- Exact error message
- Steps to reproduce
- Server log output
- Browser console errors
- What you already tried

## Key Files for Debugging

| Issue | Check File |
|-------|------------|
| API errors | `src/app/api/*/route.ts` |
| Auth issues | `src/stores/auth-store.ts` |
| Order issues | `src/stores/order-store.ts` |
| Database | `prisma/schema.prisma` |
| Styling | `tailwind.config.ts` |
