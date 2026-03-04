# SPEC-480: Softies — Datacap SureTap SoftPOS Android App

## Overview
Standalone Android app that turns any NFC-enabled Android 9+ phone into a contactless payment
terminal using Datacap SureTap dsiEMVAndroid v3.17. Supports Apple Pay, Google Pay, and
contactless cards via Android semi-integrated Intent system. No external hardware required.

**Repo:** `/Users/brianlewis/Documents/My websites/GWI-POS FULL/SoftPOS-Suretap/softies/`
**Package:** `com.gwi.softies`
**Reference doc:** `SoftPOS-Suretap/Softpos docs_.txt`

---

## Tech Stack
| Item | Value |
|------|-------|
| Kotlin | 2.3.0 |
| AGP | 9.0.1 |
| Compose BOM | 2026.02.01 |
| Hilt | 2.59.2 |
| Security-Crypto | 1.1.0-alpha06 |
| dsiEMVAndroid | v3.17 (local .aar — download from Datacap portal, place at `app/libs/`) |
| minSdk | 28 (Android 9) |
| compileSdk | 36 |
| Java | 17 |

---

## Sandbox Credentials (CERT only — do NOT hardcode in source)
- **MerchantID:** `DEMODCHAL5GP`
- **POSPackageID:** `SureTap:1.3`
- **SoftPosUserId:** `0b5206e6af02e7bb6a5a2c58cf102797` (32-char hex — stored in EncryptedSharedPreferences only)
- **OperationMode:** `CERT`

---

## Build Flavors
| Flavor | applicationId | SURETAP_PACKAGE | DEFAULT_OPERATION_MODE |
|--------|--------------|-----------------|----------------------|
| `cert` | `com.gwi.softies.cert` | `com.datacap.suretap.cert` | `CERT` |
| `live` | `com.gwi.softies` | `com.datacap.suretap` | `LIVE` |

Build variants: `certDebug`, `certRelease`, `liveDebug`, `liveRelease`

---

## Package Structure
```
com.gwi.softies/
├── SoftiesApp.kt                          @HiltAndroidApp
├── data/
│   └── ConfigStore.kt                     EncryptedSharedPreferences — all config + staffName + seqNo
├── payment/
│   ├── SureTapManager.kt                  @Singleton — Mutex-guarded, CompletableDeferred bridge
│   ├── SureTapXmlBuilder.kt               Builds TStream XML (5 transactions)
│   ├── SureTapXmlParser.kt                Parses RStream XML — BigDecimal cents, Canceled mapping
│   └── model/
│       ├── TransactionResult.kt           sealed: Approved / Declined / Canceled / Error
│       ├── TransactionConfig.kt
│       ├── TransactionRecord.kt
│       ├── TipChip.kt
│       ├── ServiceType.kt
│       └── OperationMode.kt
├── di/
│   ├── AppModule.kt
│   └── PaymentModule.kt
└── ui/
    ├── MainActivity.kt                    @AndroidEntryPoint — onActivityCreate/Destroy lifecycle
    ├── navigation/
    │   ├── AppNavigation.kt               Persists staffName to ConfigStore on login
    │   └── Screen.kt
    ├── setup/
    │   ├── SetupScreen.kt
    │   └── SetupViewModel.kt
    ├── login/
    │   ├── LoginScreen.kt
    │   └── LoginViewModel.kt
    ├── charge/
    │   ├── ChargeScreen.kt
    │   ├── ChargeViewModel.kt
    │   ├── ChargeUiState.kt
    │   └── components/
    │       ├── AmountInputCard.kt         LaunchedEffect(amountCents) for external sync
    │       ├── QuickAmountChips.kt
    │       ├── ServiceTypeSelector.kt
    │       ├── TipSelectorRow.kt
    │       ├── ChargeButton.kt
    │       ├── ApprovedOverlay.kt         Spring bounce, 1.8s auto-dismiss
    │       ├── DeclinedOverlay.kt         Shake animation, tap to dismiss
    │       └── NfcStatusBar.kt            READY/DISABLED/NOT_AVAILABLE pill
    ├── tools/
    │   ├── TransactionToolsScreen.kt      Manager PIN gate, Void/Return/Reset
    │   └── TransactionToolsViewModel.kt
    ├── settings/
    │   ├── SettingsScreen.kt              Kiosk toggle, tip visibility, manager PIN
    │   └── SettingsViewModel.kt
    ├── theme/
    │   ├── Color.kt                       GWI PosColors palette
    │   ├── Theme.kt
    │   └── Type.kt
    └── util/
        ├── MoneyTextFieldState.kt         Strict cents-based input (setCents for external sync)
        └── MoneyUtils.kt
```

---

## 5 Supported Transactions
| TranCode | Method | Notes |
|----------|--------|-------|
| `EMVParamDownload` | `paramDownload()` | First-run SSO; silent background |
| `EMVSale` | `sale(amountCents, tipCents, config)` | Main payment |
| `VoidSaleByRecordNo` | `voidByRecordNo(recordNo, config)` | Requires RecordNo from Approved result |
| `ReturnByRecordNo` | `returnByRecordNo(recordNo, amountCents, config)` | Partial returns supported |
| `EMVPadReset` | `padReset(config)` | Device reset |

**Monetary rule:** All internal values `Long` cents. XML output: `String.format("%.2f", cents / 100.0)`.
**Tip math:** `<Purchase>` = base only; `<Gratuity>` = tip only. SureTap handles total.

---

## Key Architecture Decisions

### SureTapManager Lifecycle Bridge
```kotlin
// onCreate (MUST be before setContent):
sureTapManager.onActivityCreate(this)

// onDestroy:
sureTapManager.onActivityDestroy()
```
When real .aar is wired: uncomment `control = dsiEMVAndroid(activity)` and all
`control?.ProcessTransaction(xml)` calls. Remove `simulateTransaction()`.

### Mutex-Guarded Transaction Execution
```kotlin
private val transactionMutex = Mutex()

private suspend fun executeTransaction(block: suspend () -> Unit): TransactionResult {
    if (!transactionMutex.tryLock()) return TransactionResult.Error("Transaction already in progress")
    val deferred = CompletableDeferred<TransactionResult>()
    pendingResult = deferred
    return try {
        block()
        withTimeoutOrNull(120_000L) { deferred.await() } ?: TransactionResult.Error("Timeout")
    } catch (e: Exception) {
        TransactionResult.Error("Exception: ${e.message}")
    } finally {
        pendingResult = null
        pendingSequenceNo = null
        transactionMutex.unlock()
    }
}
```

### Staff Name Flow
1. Login → `configStore.setStaffName(staffName)` in `AppNavigation.onLoginSuccess`
2. `ChargeViewModel.init` reads from ConfigStore immediately
3. `ChargeViewModel.initialize()` falls back to ConfigStore when passed blank string

### AmountInputCard External Sync
```kotlin
val state = remember { MoneyTextFieldState(0L) }
LaunchedEffect(amountCents) {
    if ((state.cents ?: 0L) != amountCents) state.setCents(amountCents)
}
```
Guard prevents feedback loop when user is typing.

### SequenceNo
`ConfigStore.nextSequenceNo()` → 10-digit string, range `1_000_000_000..9_999_999_999`, `.padStart(10, '0')` defensive.

---

## TransactionResult Mapping
| CmdStatus (lowercase) | Result |
|----------------------|--------|
| `success` | `Approved(amountCents via BigDecimal, recordNo, authCode, textResponse)` |
| `decline` / `declined` | `Declined(textResponse)` |
| `cancel` / `cancelled` / `canceled` | `Canceled` (neutral UX — NOT red) |
| anything else | `Error(textResponse, dsiXReturnCode)` |
| no response / timeout | `Error("Timeout")` |

---

## Simulation Mode (until .aar is wired)
`simulateTransaction()` in `SureTapManager` directly completes the `CompletableDeferred` with
`TransactionResult.Approved(...)` after 1.5s delay — bypasses XML parser entirely.
Look for `// TODO: control?.ProcessTransaction(xml)` comments to know exactly where to wire real calls.

---

## AGP 9.0.1 Build Notes
- **No** `alias(libs.plugins.kotlin.android)` — Kotlin is built-in to AGP 9.0
- **No** `kotlinOptions { jvmTarget = "17" }` block — also removed in AGP 9.0
- Minimum Gradle wrapper: **9.1.0**
- `gradle.properties`: `-Xmx4g -XX:MaxMetaspaceSize=512m` to prevent OOM during KSP
- Theme parent: `Theme.AppCompat.NoActionBar` (requires `appcompat:1.7.0`)

---

## ProGuard (release builds)
```
-keep class com.datacap.android.** { *; }
-dontwarn com.datacap.android.**
```

---

## Phase 0 (manual — before first build)
1. Download `dsiEMVAndroid-3.17.aar` from Datacap portal → place at `app/libs/`
2. Download SureTap sandbox APK v5.0.6 → `adb install suretap-sandbox-v5.0.6.apk`
3. Confirm SureTap cert package name: `aapt dump badging suretap-sandbox-v5.0.6.apk | grep package`
   - If not `com.datacap.suretap.cert`, update `build.gradle.kts` SURETAP_PACKAGE for cert flavor

---

## MVP Definition of Done
1. `EMVParamDownload` works end-to-end; SSO config persists in EncryptedSharedPreferences
2. `EMVSale` approved → green overlay; declined → red overlay; canceled → neutral (NOT red)
3. Rotation mid-idle: no crashes
4. Rotation mid-transaction: pending state visible, "payment in progress" banner
5. Kill + relaunch: can transact immediately
6. "Transaction already in progress" impossible from UI (Mutex + button disabled)
7. SureTap missing → inline Install CTA (not modal), Charge disabled
8. NFC disabled → inline Settings CTA, Charge disabled
9. Release build (certRelease + liveRelease): SDK not stripped by R8
10. No secrets in Logcat or crash reports
11. All 5 transactions pass sandbox test checklist
