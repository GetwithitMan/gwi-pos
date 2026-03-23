# SmartTab Installer Analysis — 172.16.1.60 (2026-03-23)

## Installer #1: SmartTab Launcher

### Delivery
- **Binary:** `installer.run` (55MB self-extracting archive)
- **Runtime:** Bundled Oracle JRE 8 (jdk1.8.0_201) — ships its own Java
- **UI:** JavaFX app (`SmartTabInstallAppController` / `DeployerProviderService`)
- **Download:** `https://pos-builds.s3.amazonaws.com/prod-global/launcher/smarttab-launcher-1.0.0.8359c6e-prod.zip` (~52MB)
- **Provisioning:** Ansible playbooks (per Ubuntu version: 12, 18, 24)

### Install Flow
1. `installer.run` extracts JRE + `installer.jar` to `/tmp/tmp.XXXXXXXX/`
2. JavaFX UI launches, downloads launcher zip from S3 (progress bar)
3. Unzips to `/tmp/.../SmartTabLauncher/`
4. Runs `setup/initial_install.sh` with sudo (password passed as CLI arg)
5. `initial_install.sh`:
   - Ensures `ansible` package installed via apt
   - Runs `sudo_playbook.yml` → sets passwordless sudo
   - Creates `~/.smarttab/launcher/app/`
   - Copies launcher files there
   - Runs `start.sh`
6. `start.sh` checks for `ready_for_ui` flag → if missing, runs `setup/setup.sh`
7. `setup.sh`:
   - Installs `community.general` Ansible Galaxy collection
   - Detects Ubuntu version (noble → ubuntu24)
   - Runs full `ansible-playbook` with all roles
   - Creates `setup_is_done` flag on success
8. `start.sh` then launches JavaFX launcher UI in `xterm -maximized -iconic`

### Launcher Runtime
- **Process chain:** `konsole -e start.sh` → `xterm` → `start_launcher.sh` → `java -jar launcher.jar`
- Java opts: `-Dcom.sun.javafx.virtualKeyboard=javafx`
- **Auto-restart loop:** If launcher crashes, waits 5s and restarts. Only stops on clean exit (0) or signal (≥128)
- Logs to `start_launcher.sh.log`

### Directory Structure
```
~/.smarttab/
└── launcher/
    └── app/
        ├── launcher.jar          # JavaFX launcher app
        ├── start.sh              # Entry point (checks setup, launches xterm)
        ├── start_launcher.sh     # Java process manager (restart loop)
        └── setup/
            ├── initial_install.sh
            ├── setup.sh
            ├── vars               # SMARTTAB_FOLDER, LAUNCHER_FOLDER paths
            ├── lib/               # ensure_package_installed.sh, is_package_installed.sh, etc.
            └── ansible/
                ├── inventory      # [pos] localhost ansible_connection=local
                ├── roles/
                └── ubuntu24/      # Playbooks + roles for Ubuntu 24.04
```

### Ansible Roles (Ubuntu 24 — execution order)

#### 1. install_ubuntu_packages
- **Packages:** `openssh-server`, `mc`, `curl`, `axel`, `xterm`, `net-tools`
- Only installs what's missing (checks `dpkg-query` first)

#### 2. setup_teamviewer
- Purges legacy `teamviewer:i386` and `teamviewer-host` packages
- Adds official TeamViewer apt repo (`https://linux.teamviewer.com/deb`) with signed GPG keyring
- Installs latest `teamviewer` (amd64) from official repo
- Enables `teamviewerd.service`
- Creates autostart entry (`~/.config/autostart/teamviewer.desktop`) with custom start script
- Creates desktop shortcut

#### 3. java8-oracle-install
- Downloads Oracle JDK 1.8.0_201 from S3: `dependency-files-for-deploy.s3.us-west-2.amazonaws.com/prod-global/1582812105508-jdk1.8.0_201.zip`
- Uses `axel` (7 connections) for fast download
- Installs to `/usr/lib/jvm/jdk1.8.0_201/`
- Creates symlink `/usr/lib/jvm/default-java`
- Sets as system default via `update-alternatives`
- Sets `POS_JAVA_OPTS="-XX:+UseG1GC"` in `/etc/environment`
- Sets `reboot_required` flag if Java env not already configured

#### 4. launcher_can_run_gui
- Creates `ready_for_ui` flag file in setup folder
- Signals to `start.sh` that setup is far enough to launch the GUI

#### 5. setup_launcher_autostart
- Creates `~/.config/autostart/pos-launcher-autostart.desktop`
- Exec: `konsole -e /home/gwipos/.smarttab/launcher/app/start.sh`
- Runs on every KDE login

#### 6. install_kde
- Removes heavy `kubuntu-desktop` meta-package
- Installs `kde-plasma-desktop` (lighter)
- Sets `XSession=plasma` in `/var/lib/AccountsService/users/<user>`
- **Triggers reboot** if KDE was just installed (needs login to create config files)
- After reboot, autostart resumes the setup automatically

#### 7. setup_autologin
- Creates `/etc/sddm.conf.d/autologin.conf`:
  ```
  [Autologin]
  User=gwipos
  Session=plasma.desktop
  ```

#### 8. disable_kde_restore_session
- Sets `loginMode=emptySession` in `~/.config/ksmserverrc`
- Prevents KDE from reopening apps from previous session on boot

#### 9. set_smarttab_link_path_to_launcher_folder
- Creates symlink: `/usr/bin/SmartTAB → ~/.smarttab/launcher/app/start.sh`

#### 10. thermal_printer_drivers
- Checks CUPS for Epson TM receipt printer PPDs (`tm-ba-thermal-rastertotmt.ppd.gz`, `tm-ba-thermal-rastertotmtr-180.ppd`)
- If missing, downloads from S3: `dependency-files-for-deploy.s3.us-west-2.amazonaws.com/prod-global/1652959222752-Thermal_Receipt.zip`
- Runs `install.sh` from the zip
- Creates bash aliases: `lpinfo="sudo lpinfo"`, `lpadmin="sudo lpadmin"`

#### 11. customize_os_view
- **Boot splash:** Installs SmartTab Plymouth theme → `update-alternatives --set`, `update-initramfs -u`
- **KDE wallpaper:** Copies SmartTab wallpaper to `/usr/share/wallpapers/SmartTab/`, applies via D-Bus
- **KDE splash screen:** Copies `SmartTabLogoKdePlasmaSplashScreen` to `/usr/share/plasma/look-and-feel/`, sets in `/etc/xdg/ksplashrc`
- **Disable notifications:** Removes `deja-dup`, `update-notifier`, `update-manager`, `gnome-software`, `plasma-discover`, `plasma-discover-notifier`, `plasma-discover-backends`, `plasma-discover-snap-backend`, `ubuntu-advantage-desktop-daemon`. Removes `snapd-desktop-integration` snap. Blanks all `Action=` lines in `*.notifyrc` files.

#### 12. disable_sleep_hibernate
- Masks systemd targets: `sleep.target`, `suspend.target`, `hibernate.target`, `hybrid-sleep.target`
- Masks `plasma-powerdevil.service` (KDE power manager)

#### 13. customize_screen_fade_behavior
- Disables screen lock in `~/.config/kscreenlockerrc`:
  - `Autolock=false`
  - `Timeout=0`
  - `LockOnResume=false`

#### 14. configure_touchscreen (conditional)
- Detects touchscreen via `ID_INPUT_TOUCHSCREEN=1` in udev
- If present:
  - Disables right-click via `/etc/libinput/local-overrides.quirks` (MatchUdevType=touchscreen, AttrEventCodeDisable=BTN_RIGHT)
  - Installs eGTouch driver for eGalax USB touchscreens (from S3, `eGTouch_v2.5.13219.L-x.7z`)
  - Installs `onboard` on-screen keyboard, sets input source to GTK, creates desktop shortcut
- On this NUC: **skipped** (no touchscreen detected)

#### 15. magtek_integration
- Installs packages: `libjsoncpp-dev`, `libcurl4-openssl-dev`, `libtool`, `libusb-1.0-0-dev`, `libssl-dev`, `libstdc++6`
- Creates udev rule `/etc/udev/rules.d/99-dyno-flex-2-go-device.rules`:
  ```
  SUBSYSTEM=="usb", ATTR{idVendor}=="0801", ATTR{idProduct}=="2024", MODE="0666"
  ```
- For MagTek Dyno-Flex 2 Go payment device

#### 16. reboot_system_if_reboot_flag_is_set
- If any previous role set `reboot_required=true`, runs `sudo reboot`

### Sudo Playbook (runs before main playbook)
- Sets `%sudo ALL=(ALL:ALL) NOPASSWD: ALL` in `/etc/sudoers`

### Conditional Roles (not triggered on this NUC)
- **setup_ELO_device** — Only if `dmidecode` detects ELO hardware. Installs Intel graphics drivers, ELO USB touch drivers, disables beep, configures touch calibration.
- **berg_integration** — Commented out in playbook. Would add user to `dialout` group and upgrade kernel for serial device support.

### External Dependencies (S3 downloads during install)
| What | URL |
|------|-----|
| Launcher zip | `pos-builds.s3.amazonaws.com/prod-global/launcher/smarttab-launcher-1.0.0.8359c6e-prod.zip` |
| Oracle JDK | `dependency-files-for-deploy.s3.us-west-2.amazonaws.com/prod-global/1582812105508-jdk1.8.0_201.zip` |
| Thermal printer drivers | `dependency-files-for-deploy.s3.us-west-2.amazonaws.com/prod-global/1652959222752-Thermal_Receipt.zip` |
| eGTouch driver | `dependency-files-for-deploy.s3.us-west-2.amazonaws.com/test-global/1746421985602-eGTouch_v2.5.13219.L-x.7z` |
| TeamViewer | `linux.teamviewer.com/deb` (apt repo) |

### Ansible Galaxy Dependencies
- `community.general >= 10.6.0` (for `update-alternatives` module)

### Multi-OS Support
The installer ships playbooks for 3 Ubuntu versions:
- **ubuntu12** (precise) — Legacy, fixes old repos, uses LightDM
- **ubuntu18** (bionic) — LightDM, additional lightdm configuration
- **ubuntu24** (noble) — SDDM, current production target

### Observed Behavior on 172.16.1.60
- Total install time: ~3 minutes
- One reboot triggered by KDE install
- Setup auto-resumed after reboot via autostart desktop entry
- All roles completed successfully
- Launcher JavaFX app running in xterm after completion

---

## Installer #2: SmartTab Launcher Self-Update (v1.0.0.95 → v2.0.0.3)

### What Happened
This was NOT a separate installer binary. The SmartTab Launcher (installed by #1) **self-updated**:
1. Launcher v1.0.0.95 detected a newer version available
2. Backed up current app to `~/.smarttab/launcher/data/backups/app_2026-03-23_101207.823/`
3. Downloaded and replaced with v2.0.0.3 (build `dfa794f`, Jenkins build #3, `2025-08-04`)
4. Deleted the `setup_is_done` flag to force re-provisioning
5. Re-ran the full `setup.sh` → `ansible-playbook` with the **new** playbook

### Version Details
| | Old (v1.0.0.95) | New (v2.0.0.3) |
|---|---|---|
| Build version | 1.0.0.95 | 2.0.0.3 |
| Git commit | 8359c6e | dfa794f |
| Build date | 2026-01-13 | 2025-08-04 |
| Jenkins build | #95 | #3 |
| Build type | prod | prod |

### Playbook Changes (v2.0.0.3 vs v1.0.0.95)

**Roles ADDED:**
- `install_java21fx_liberica` — Replaces Oracle JDK 8 with Liberica JRE 21 (with JavaFX)

**Roles REMOVED from playbook:**
- `thermal_printer_drivers` — No longer installed by launcher (likely moved to POS installer)
- `magtek_integration` — No longer installed by launcher (likely moved to POS installer)
- `java8-oracle-install` — Commented out, replaced by `install_java21fx_liberica`

**Roles CHANGED:**
- `setup_teamviewer` — Simplified/regressed: now targets TeamViewer 12 (i386) specifically instead of latest native amd64. Downloads TV12 .deb directly + i386 dependencies

**Roles UNCHANGED:**
- `install_ubuntu_packages`, `launcher_can_run_gui`, `setup_launcher_autostart`, `install_kde`, `setup_autologin`, `disable_kde_restore_session`, `set_smarttab_link_path_to_launcher_folder`, `customize_os_view`, `disable_sleep_hibernate`, `customize_screen_fade_behavior`, `configure_touchscreen`, `reboot_system_if_reboot_flag_is_set`

### New Role: install_java21fx_liberica

**Purpose:** Install Liberica JRE 21.0.2 with full JavaFX support (replaces Oracle JDK 8)

**Details:**
- **Architecture-aware:** Detects `x86_64` vs `aarch64` and downloads the correct build
- **x64 URL:** `dependency-files-for-deploy.s3.us-west-2.amazonaws.com/test-global/1709047147202-bellsoft-jre21.0.2+14-linux-amd64-full.tar.gz`
- **arm64 URL:** `dependency-files-for-deploy.s3.us-west-2.amazonaws.com/test-global/1709047120590-bellsoft-jre21.0.2+14-linux-aarch64-full.tar.gz`
- Downloads via `curl -C -` (resumable)
- Installs to `/usr/lib/jvm/jre-21.0.2.fx-liberica/`
- Creates symlink `/usr/lib/jvm/default-java → jre-21.0.2.fx-liberica`
- Sets as system default via `update-alternatives` (priority 100)
- **Does NOT remove JDK 8** — both remain on disk (`jdk1.8.0_201` + `jre-21.0.2.fx-liberica`)
- **No `POS_JAVA_OPTS` set** (unlike JDK 8 role which set `-XX:+UseG1GC`)

### TeamViewer Role Regression (v2.0.0.3)
The new TeamViewer role is actually an **older/simpler version**:
- Wants TeamViewer **12.0** specifically (i386 package)
- Downloads `.deb` directly via `wget`
- Installs `i386` architecture + 18 i386 dependency libraries (`libc6:i386`, `libasound2:i386`, etc.)
- If any other TV version is found, removes it first
- No GPG key management, no apt repo setup
- On this NUC: The v1.0.0.95 installer had already installed native amd64 TeamViewer (latest). The v2.0.0.3 role detected TV was already present at `/usr/bin/teamviewer` and kept it.

### Self-Update Mechanism
The launcher has a built-in update system:
1. On startup, launcher checks S3 for newer versions
2. If found, downloads new launcher zip
3. Backs up current `app/` directory to `data/backups/app_<timestamp>/`
4. Extracts new version over `app/`
5. Removes `setup_is_done` flag (forces Ansible re-run)
6. Restarts itself
7. New version's `start.sh` sees no `setup_is_done` → runs `setup.sh` → full Ansible provisioning with new playbook

### Final State After Installer #2
| Item | Value |
|------|-------|
| Launcher version | 2.0.0.3 |
| Java (system default) | Liberica JRE 21.0.2+14 (OpenJDK) |
| Java 8 (still on disk) | Oracle JDK 1.8.0_201 at `/usr/lib/jvm/jdk1.8.0_201/` |
| TeamViewer | 12.0.259197 (i386, kept from prior install) |
| New services | None (same as after #1) |
| New ports | None (same as after #1) |

### Key Observations
1. **The launcher is a self-updating deployment agent** — it manages its own lifecycle and can re-provision the entire machine on update
2. **Ansible is idempotent** — most roles detected no changes needed (KDE, packages, autologin already configured) and skipped
3. **JDK 8 is not cleaned up** — both Java 8 and 21 coexist in `/usr/lib/jvm/`
4. **The backup system preserves rollback capability** — old version kept in `data/backups/`
5. **v2.0.0.3 strips hardware-specific roles** (thermal printers, MagTek) from the launcher playbook — these likely moved to a separate POS-level installer

---

## Installer #2B: SmartTab POS App (deployed by Launcher v2.0.0.3)

After the launcher self-updated and re-provisioned, it entered POS setup mode. This is the actual POS application installation.

### Launcher → POS Deployment Flow
1. Launcher checks `https://api.smarttab.com/build/launcher?venueChainId=...` for version updates
2. Launcher uses **Flyway** migrations on a local **SQLite** database (`deployer.sqlite`) for its own state:
   - `V1_01__Create_table_SetupConfig.sql`
   - `V1_02__Create_table_InstallationState.sql`
   - `V1_03__Create_table_Message.sql`
   - `V1_04__Drop_liquibase_migrations_table_if_exists.sql`
   - `V1_05__Add_posName_column_to_SetupConfig.sql`
   - `V1_06__Add_is_pos_auth_key_valid_column_to_SetupConfig.sql`
3. Launcher reads `SetupConfig` for venue identity (pre-configured):
   - **venueChainId:** `5655b283-8e8e-9afc-708c-0e1b9579eeb6`
   - **venueChainApiUrl:** `https://api-greenpigpub.smarttab.com/`
   - **merchantId:** `d578fa3c-3398-83aa-4684-322ea18aed16`
   - **authKey:** `vge10KWI1rmPTcRQyD9vAgwJYuhFzqoR`
   - **posName:** `Green Pig Pub-main`
4. Prompts user for **POS role** (screen select)
5. Downloads POS app zip from S3
6. Extracts to `~/.smarttab/pos/app/`
7. Runs POS `setup/setup.sh` (its own Ansible playbook — separate from launcher's)
8. Starts POS app via `start_pos.sh`

### POS App Details
- **Version:** 4.1.7.8 (commit `a05bb07`, prod build)
- **Main jar:** `bin/SmartTAB.jar` — Java application (NOT a web app)
- **Framework:** JavaFX for UI, Hazelcast for clustering (port 5701)
- **Entry point:** `com.smart_tab.Main`
- **JVM options:**
  - `--add-opens java.base/java.lang=ALL-UNNAMED`
  - `-DvirtualKeyboardEnabled=true`
  - `-XX:+UseG1GC`
  - `-XX:+HeapDumpOnOutOfMemoryError`
  - `-XX:MaxRAMPercentage=80` (if system has ≥4.5GB RAM)
- **Kiosk mode:** `--kiosk-mode` flag
- **Data path:** `~/.smarttab/pos/data/`
- **Log files:** `smarttab.log`, `payments.log`, `magtek.log`, `mobile.log`, `json.log`, `perf.log`, `qa_console.log`, `domainSignals.log`, `hz.log`, `hz_diagnostics.log`

### POS App Native Libraries
| File | Purpose |
|------|---------|
| `bin/SmartTAB.jar` | Main POS application |
| `bin/lib/*` | Java dependency jars (classpath) |
| `bin/cashDrawerBridge` | Native binary for cash drawer control |
| `libmtmms.so` | MagTek MMS (Magensa Management System) library |
| `libmtscra.so` | MagTek SCRA (Secure Card Reader Authenticator) library |

### POS Ansible Playbook (7 roles)

#### 1. dp-uareu-uninstall
- **Purpose:** Uninstall old Digital Persona U.are.U fingerprint reader kernel module (`mod_usbdpfp`)
- Downloads DP-UareU-RTE-2.2.3 from S3, uses `expect` to automate the uninstaller
- Verifies kernel module is removed after uninstall
- **Conditional:** Only runs if `mod_usbdpfp` kernel module is loaded

#### 2. cm-uareu-320
- **Purpose:** Install Crossmatch U.are.U 320 fingerprint scanner driver v3.2.0
- Downloads `CM-UareU-RTE-3.2.0-1.20190226_1701.tar.gz` from S3
- Uses `expect` to automate the interactive installer (accepts license agreement)
- Installs to `/opt/Crossmatch/`
- Creates version marker: `/opt/Crossmatch/3_2_0.ver`
- **Ubuntu 24 fix:** Copies symlinks from `/usr/lib64` to `/usr/lib/x86_64-linux-gnu` (installer puts .so libs in wrong dir)
- Runs `ldconfig` to refresh linker cache
- Restarts USB subsystem after install
- Installs `expect` package as dependency

#### 3. setup_ntp
- **Purpose:** Install and configure NTP time synchronization
- Installs `ntp` and `ntpdate` packages
- NTP servers: `time.nist.gov`, `ntp.ubuntu.com`
- Syncs time immediately, then enables NTP service

#### 4. setup_GoChip
- **Purpose:** Install ID TECH GoChip (EMV chip reader) USB drivers and libraries
- Installs `libusb-1.0-0-dev`
- Creates `/usr/lib/smarttab/GoChip/LIBS/IDTECH/` directory
- Extracts `IDTECH.zip` (bundled with installer) containing native libraries
- Creates `/etc/ld.so.conf.d/idtech.conf` pointing to IDTECH lib path
- Creates **permissive USB udev rule:** `/etc/udev/rules.d/usb.rules` with `SUBSYSTEM=="usb", MODE="0666"` (ALL USB devices world-readable/writable)
- Runs `ldconfig`

#### 5. thermal_printer_drivers
- Same as Installer #1's role (now moved here from launcher)
- Epson TM receipt printer PPD drivers from S3
- Creates bash aliases for `lpinfo`/`lpadmin`

#### 6. magtek_integration
- Same as Installer #1's role (now moved here from launcher) PLUS:
- **New: libssl1.1 compatibility fix for Ubuntu 24**
  - `libMTAESDUKPTJ.so` (MagTek encryption library) is compiled against OpenSSL 1.1
  - Ubuntu 24 only ships OpenSSL 3
  - Downloads `libssl1.1_1.1.1f-1ubuntu2.24_amd64.deb` from Ubuntu security repo and installs it
- MagTek Dyno-Flex 2 Go udev rule (vendor 0801, product 2024)
- Required packages: `libjsoncpp-dev`, `libcurl4-openssl-dev`, `libtool`, `libusb-1.0-0-dev`, `libssl-dev`, `libstdc++6`

#### 7. berg_integration
- **Purpose:** Enable Berg serial device support
- Adds current user to `dialout` group (serial port access)
- Note in code: Ubuntu 24 kernel module `pl2303` already supports Berg device natively (no udev rules needed, unlike Ubuntu 18)

### POS Directory Structure
```
~/.smarttab/pos/
├── app/
│   ├── bin/
│   │   ├── SmartTAB.jar          # Main POS application
│   │   ├── lib/                   # Java dependency jars
│   │   └── cashDrawerBridge       # Native cash drawer binary
│   ├── libmtmms.so               # MagTek MMS native lib
│   ├── libmtscra.so              # MagTek SCRA native lib
│   ├── start_pos.sh              # POS startup script
│   ├── build_version             # "4.1.7.8"
│   ├── jar_hash.md5              # Integrity check
│   ├── logs/                     # Runtime logs
│   └── setup/
│       ├── setup.sh
│       └── ansible/ubuntu24/     # POS-specific ansible roles
└── data/
    ├── cash-drawers.json          # Cash drawer config
    ├── images/permanent/          # Menu item images
    └── logs/
        └── smarttab.log           # Main POS log
```

### Network
- **Port 5701:** Hazelcast cluster port (Java POS app)
- **API endpoint:** `https://api-greenpigpub.smarttab.com/`
- **Auth:** Base64-encoded credentials passed via `--server-auth-string-base64`

### Hardware Integrations Summary (POS Level)
| Hardware | Driver/Integration | Source |
|----------|-------------------|--------|
| **Crossmatch U.are.U 320** | Fingerprint scanner | `/opt/Crossmatch/` (S3 download) |
| **ID TECH GoChip** | EMV chip reader | `/usr/lib/smarttab/GoChip/LIBS/IDTECH/` (bundled zip) |
| **MagTek Dyno-Flex 2 Go** | Card swipe reader | udev rule + native `.so` libs in app dir |
| **MagTek SCRA** | Secure card reader | `libmtscra.so` in app dir |
| **Epson TM receipt printer** | Thermal printer | CUPS PPD drivers (S3 download) |
| **Berg serial device** | Serial device | `dialout` group membership |
| **Cash drawer** | Cash drawer | `cashDrawerBridge` native binary |
| **Digital Persona U.are.U** | Old fingerprint reader | Uninstalled if present |

### Global API Endpoints Observed
| Endpoint | Purpose |
|----------|---------|
| `https://api.smarttab.com/build/launcher` | Launcher version check |
| `https://api-greenpigpub.smarttab.com/` | Venue-specific POS API |
| `https://pos-builds.s3.amazonaws.com/prod-global/` | Build artifact downloads |
| `https://dependency-files-for-deploy.s3.us-west-2.amazonaws.com/` | Driver/dependency downloads |

### Background Services (Launcher)
After POS starts, the launcher runs background services:
- **PosAppBackgroundService** — Monitors POS process health, auto-restarts on crash
- **SendMessageService** — Message queue processing
- **InstallUpdatesService** — Periodic check for POS app updates
- POS xterm shows `tail -F` of `smarttab.log`

---

## Complete Installation Timeline

| Time | Event |
|------|-------|
| 10:03:26 | Installer #1 starts (installer.run) |
| 10:03:26 | Downloads launcher zip from S3 (52MB) |
| 10:03:28 | initial_install.sh runs, creates ~/.smarttab |
| 10:03:30 | Ansible starts: packages, TeamViewer, JDK 8 |
| 10:04:22 | TeamViewer configured, JDK 8 installed |
| 10:04:35 | KDE install triggers reboot |
| 10:05:00 | System reboots, auto-login, setup resumes |
| 10:06:00 | Ansible completes remaining roles (sleep, touchscreen, etc.) |
| 10:06:44 | setup_is_done flag created |
| 10:07:00 | Launcher v1.0.0.95 starts, detects v2.0.0.3 available |
| 10:12:07 | Launcher self-updates: backs up v1.0.0.95, installs v2.0.0.3 |
| 10:12:30 | Re-runs Ansible with new playbook (JDK 21 Liberica replaces JDK 8) |
| 10:13:00 | Ansible completes, launcher starts in POS setup mode |
| 10:13:41 | Flyway migrations on SQLite, venue config loaded |
| 10:13:42 | User selects POS role |
| 10:15:00 | POS app downloaded (SmartTAB-4.1.7.8) |
| 10:15:21 | POS Ansible runs: fingerprint, NTP, GoChip, printers, MagTek, Berg |
| 10:15:55 | POS app starts: `java ... SmartTAB.jar --kiosk-mode` |
| 10:15:56 | Port 5701 (Hazelcast) listening, POS operational |

## Security Observations

1. **Passwordless sudo** — `%sudo ALL=(ALL:ALL) NOPASSWD: ALL` for all sudo group members
2. **USB world-writable** — `/etc/udev/rules.d/usb.rules` sets `MODE="0666"` on ALL USB devices
3. **Auth key in plaintext** — Venue auth key passed as CLI argument (visible in `ps aux`)
4. **Base64 credentials** — Server auth string passed as base64 CLI arg (not encrypted)
5. **S3 downloads over HTTPS** — All dependency downloads use HTTPS (good)
6. **No integrity verification** — Downloaded archives are not checksum-verified before extraction
7. **libssl1.1 from Ubuntu repo** — Legacy OpenSSL installed for MagTek compatibility (potential security concern)
8. **Oracle JDK 8 remains on disk** — Not cleaned up after JDK 21 install

---

## Appendix: SmartTab Data Model (201 SQLite tables)

Full schema dump saved to: `docs/smarttab-sqlite-schema-dump.txt`

### Data Model Comparison: SmartTab (201 tables) vs GWI POS (183 models)

**Similar size but fundamentally different architecture:**
- SmartTab: SQLite (single-file, single-writer, no replication, no concurrent access)
- GWI POS: PostgreSQL 17 (multi-writer, streaming replication, full SQL, Neon cloud sync)

### Domain-by-Domain Comparison

| Domain | SmartTab Tables | GWI POS Models | Notes |
|--------|----------------|----------------|-------|
| **Orders/Tickets** | `ticket`, `ticket_aggregate`, `ticket_read_model`, `products_in_ticket`, `mods_in_ticket`, `ghostticket`, `ghost_product_in_ticket`, `ticket_invoice_pay_amount` | `Order`, `OrderItem`, `OrderItemModifier`, `OrderEvent`, `OrderSnapshot`, `OrderItemSnapshot`, `OrderDiscount`, `OrderItemDiscount`, `OrderCard`, `OrderOwnership`, `OrderOwnershipEntry` | GWI has event-sourced orders with snapshots. SmartTab has read models (CQRS-lite) |
| **Tabs** | `tab`, `tab_details`, `tab_history_item`, `tab_history_read_model`, `tab_2_shift`, `tab_authorization`, `tab_authorization_read_model`, `tab_destination_identity`, `tab_payment_operations` | `Order` (type=tab), `OrderCard`, `TipAdjustment` | SmartTab has dedicated tab tables. GWI uses Order with tab type |
| **Payments** | `cash_payment`, `credit_card`, `credit_transaction`, `creditpayment`, `payment_2_shift`, `payment_in_progress`, `payment_request`, `payment_request_2_payment`, `payment_signature`, `postponed_payment`, `postponed_payment_actualization`, `postponed_payment_saga`, `pre_authorisation`, `pre_authorisation_request`, `pre_authorization_operation`, `gateway_request`, `gateway_request_2_transaction`, `invoice`, `invoice_payment_refund`, `invoice_payment_result` | `Payment`, `PaymentReader`, `PaymentReaderLog`, `RefundLog`, `WalkoutRetry`, `CardProfile` | SmartTab has ~20 payment tables (saga pattern, multiple gateways). GWI is simpler (Datacap-only) |
| **Tips** | `gratuity_in_tab`, `gratuity_state`, `tips_type_for_payment`, `bulk_tip_entry_counters_read_model`, `bulk_tip_entry_item` | `TipAdjustment`, `TipDebt`, `TipGroup`, `TipGroupMembership`, `TipGroupSegment`, `TipGroupTemplate`, `TipLedger`, `TipLedgerEntry`, `TipOutRule`, `TipPool`, `TipShare`, `TipTransaction`, `CashTipDeclaration` | GWI has far more sophisticated tip management (13 tables vs 5) |
| **Employees/Shifts** | `web_employee`, `web_employee_role`, `web_role`, `web_privilege_role_employee`, `web_shift`, `shift_statistics`, `employee_last_activity_time` | `Employee`, `EmployeeRole`, `EmployeePermissionOverride`, `Role`, `Shift`, `TimeClockEntry`, `Break`, `Schedule`, `ScheduledShift`, `ShiftSwapRequest` | GWI has scheduling, time clock, breaks, shift swaps. SmartTab doesn't |
| **Menu** | `web_product`, `web_category`, `web_category_item`, `web_category_order`, `web_classification`, `web_sub_class`, `web_food_type`, `web_menu_product_photo_details`, `web_product_prep_note`, `eighty_six_product` | `MenuItem`, `Category`, `ItemBarcode`, `PricingOption`, `PricingOptionGroup`, `QuickBarDefault`, `QuickBarPreference`, `DailyPrepCount`, `DailyPrepCountItem`, `DailyPrepCountTransaction`, `PrepItem`, `PrepItemIngredient`, `PrepStation`, `PrepTrayConfig` | GWI has prep management, barcode support, pricing options. SmartTab has 86'd products |
| **Modifiers** | `web_modifier`, `web_modifier_category`, `web_modifier_category_item`, `web_forced_modifier`, `web_forced_modifier_category`, `web_forced_modifier_group`, `web_pre_modifier` | `Modifier`, `ModifierGroup`, `ModifierGroupTemplate`, `ModifierTemplate`, `ModifierInventoryLink` | SmartTab has forced modifiers + pre-modifiers. GWI has templates + inventory links |
| **Inventory** | `web_ingredient`, `web_ingredient_type`, `web_recipe_item`, `web_measure`, `ingredient_in_product_list`, `web_settings_remaining_product` | `Ingredient`, `IngredientCategory`, `IngredientCostHistory`, `IngredientRecipe`, `IngredientStockAdjustment`, `IngredientSwapGroup`, `InventoryCount`, `InventoryCountEntry`, `InventoryCountItem`, `InventoryItem`, `InventoryItemStorage`, `InventoryItemTransaction`, `InventorySettings`, `InventoryTransaction`, `RecipeIngredient`, `StockAlert`, `StorageLocation`, `Vendor`, `VendorOrder`, `VendorOrderLineItem`, `WasteLog`, `WasteLogEntry` | **GWI dominates** — 22 inventory tables vs 6. Full vendor ordering, stock alerts, waste tracking, cost history, storage locations |
| **KDS/Kitchen** | `kds_orders`, `kds_screens`, `kds_settings`, `kitchen_round_info`, `coursing_snapshot`, `no_make_marker` | `KDSScreen`, `KDSScreenLink`, `KDSScreenStation`, `CourseConfig`, `FulfillmentEvent` | Both handle KDS. SmartTab has kitchen rounds + no-make markers |
| **Events/Entertainment** | `event_context`, `event_read_model`, `event_admission_statistics_read_model`, `web_venue_event`, `web_event_image`, `web_event_purchase_order`, `web_event_ticket`, `web_event_ticket_type_settings`, `admitted_customer_read_model`, `pass_holder_read_model`, `pit_fragment`, `pit_fragment_counter`, `redeem_read_model_details`, `redeem_ticket_saga_state`, `cancel_event_saga_state` | `Event`, `EventPricingTier`, `EventTableConfig`, `EntertainmentWaitlist`, `TimedSession` | SmartTab has more event tables (ticketing, admission, redemption sagas). GWI has timed sessions + waitlist |
| **Floor Plan** | `web_room`, `web_tables`, `seat` | `FloorPlanElement`, `Table`, `Section`, `SectionAssignment`, `Seat`, `Station` | GWI has sections + stations. SmartTab is simpler |
| **Settings** | `web_settings_global`, `web_settings_venue`, `web_settings_receipt`, `web_settings_tips`, `web_settings_business_hours`, `web_settings_address`, `web_settings_admission`, `web_settings_berg`, `web_settings_customer_facing_terminal`, `web_settings_gift_local`, `web_settings_360_payments`, `web_settings_magensa`, `web_settings_synergy`, `web_settings_suggested_tip`, `web_settings_remaining_product`, `web_setting_credit_card`, `web_setting_tax`, `web_custom_tax`, `web_custom_tender`, `web_uhll_settings`, `settings_deliverect`, `signals_configuration`, `fee_settings`, `kds_settings` | `Location` (settings JSON), `CfdSettings`, `InventorySettings`, `PayrollSettings`, `PizzaConfig`, `TaxRule`, `DiscountRule` | SmartTab has 24 separate settings tables. GWI consolidates most into Location JSON fields |
| **Customers** | `customer`, `customer_photo_collection`, `customer_product_in_ticket_photo`, `account`, `phone_verification`, `driver_license`, `driver_license_read_model`, `signed_agreement`, `signature_customer_photo` | `Customer` | SmartTab has more customer features (driver license scanning, photo collection, phone verification, signed agreements) |
| **Happy Hour/Pricing** | `web_happy_hour_rule`, `web_happy_hour_2_product`, `happy_hour_rule_note`, `business_day_meal_period`, `web_meal_period` | `DiscountRule` (type=happy_hour), `PricingOption`, `PricingOptionGroup` | Different approaches — SmartTab uses dedicated tables, GWI uses polymorphic rules |
| **Gift Cards** | `gift_card_operation` | `GiftCard`, `GiftCardTransaction` | GWI has full gift card ledger. SmartTab has operations only |
| **Delivery** | `delivery_details`, `deliverect_order`, `deliverect_order_model`, `pickup_details`, `to_go_marker` | (delivery models in code, not Prisma schema yet) | SmartTab integrates with Deliverect. GWI has in-house delivery |
| **Printing** | `web_printer_group`, `web_expo_printer` | `Printer`, `PrintJob`, `PrintRoute`, `PrintRule` | GWI has configurable print routing rules. SmartTab has printer groups + expo |
| **Sync/Infrastructure** | `entity_last_update_time`, `pending_message`, `hub_signals`, `release_info`, `health_tracker` | `SyncWatermark`, `SyncAuditEntry`, `GwiSyncState`, `GwiMigrations`, `CloudEventQueue`, `OutageQueueEntry`, `SocketEventLog`, `BridgeCheckpoint` | GWI has full bidirectional sync infrastructure. SmartTab has simple entity timestamps |
| **Discounts** | `web_discount_group` | `DiscountRule`, `OrderDiscount`, `OrderItemDiscount`, `CompReason` | GWI tracks discounts at order + item level with comp reasons |
| **Voids** | `void_item`, `web_void_reason` | `VoidLog`, `VoidReason`, `RemoteVoidApproval` | GWI has remote void approval workflow |
| **Hardware** | `terminal`, `terminal_to_pos_binding`, `pos`, `paired_mobile_pos_card_reader`, `batch_required_terminal_flag` | `Terminal`, `RegisteredDevice`, `HardwareCommand`, `Scale`, `Printer`, `PaymentReader` | Different hardware models |
| **Berg/Beverages** | `third_party_berg_plu`, `web_settings_berg` | `BergDevice`, `BergDispenseEvent`, `BergPluMapping` | Both integrate with Berg ECU beverage dispensers |
| **Pizza** | (none) | `PizzaConfig`, `PizzaCheese`, `PizzaCrust`, `PizzaSauce`, `PizzaSize`, `PizzaSpecialty`, `PizzaTopping`, `OrderItemPizza` | **GWI only** — full pizza builder |
| **Combos** | (none) | `ComboTemplate`, `ComboComponent`, `ComboComponentOption` | **GWI only** |
| **Reservations** | (none) | `Reservation`, `ReservationBlock`, `ReservationDeposit`, `ReservationDepositToken`, `ReservationEvent`, `ReservationIdempotencyKey`, `ReservationTable` | **GWI only** — full reservation engine |
| **Bottle Service** | (none) | `BottleProduct`, `BottleServiceTier` | **GWI only** |
| **House Accounts** | (none) | `HouseAccount`, `HouseAccountTransaction` | **GWI only** |
| **Chargebacks** | (none) | `ChargebackCase` | **GWI only** |
| **Audit** | (none) | `AuditLog`, `VenueLog` | **GWI only** — full audit trail |
| **Payroll** | (none) | `PayrollPeriod`, `PayrollSettings`, `PayStub`, `PendingDeduction`, `DeductionRun` | **GWI only** — full payroll |
| **Coupons** | (none) | `Coupon`, `CouponRedemption` | **GWI only** |
| **Spirits/Liquor** | (none) | `SpiritCategory`, `SpiritModifierGroup`, `SpiritUpsellEvent` | **GWI only** — liquor builder |
| **Integrations** | `settings_deliverect`, `web_settings_synergy`, `web_magensa_merchant` | `MarginEdgeProductMapping`, `SevenShiftsDailySalesPush`, `PmsChargeAttempt` | SmartTab: Deliverect, Synergy, Magensa. GWI: MarginEdge, 7shifts, Oracle PMS |

### Features Only SmartTab Has (that we don't)
- **Fingerprint scanning** — `finger_scan_data` table + Crossmatch U.are.U driver
- **Driver license scanning** — `driver_license`, `driver_license_read_model`
- **Signed agreements** — `signed_agreement`, `signature_customer_photo`
- **Phone verification** — `phone_verification` table
- **Deliverect integration** — `deliverect_order`, `deliverect_order_model`, `settings_deliverect`
- **Synergy integration** — `web_settings_synergy`
- **Mobile POS card reader pairing** — `paired_mobile_pos_card_reader`
- **Event saga state machines** — `cancel_event_saga_state`, `cancel_ticket_saga_state`, `redeem_ticket_saga_state`, `order_invoice_saga_state`, `postponed_payment_saga`

### Features Only GWI POS Has (that they don't)
- **Pizza builder** (8 tables)
- **Combos** (3 tables)
- **Full reservation engine** (7 tables)
- **Bottle service** (2 tables)
- **House accounts** (2 tables)
- **Chargebacks** (1 table)
- **Full audit trail** (2 tables)
- **Full payroll** (5 tables)
- **Coupons/promo codes** (2 tables)
- **Liquor/spirit builder** (3 tables)
- **Full inventory management** (22 tables vs 6)
- **Full tip management** (13 tables vs 5)
- **Scheduling/time clock** (5 tables)
- **Print routing rules** (4 tables)
- **Remote void approval** (1 table)
- **Bidirectional cloud sync infrastructure** (8 tables)
- **Event-sourced orders with snapshots**
- **Outage queue for offline resilience**

### Sync Architecture Comparison
| Aspect | SmartTab | GWI POS |
|--------|----------|---------|
| **Sync direction** | Cloud → Local (polling every 20s) | Bidirectional (NUC ↔ Neon, 5s) |
| **Sync method** | HTTP polling via OkHttp | WebSocket push + HTTP fallback |
| **Offline capability** | None — cloud-dependent | Full — local PG is primary, queues writes during outage |
| **Conflict resolution** | Last-write-wins (cloud authoritative) | Neon-wins (cloud authoritative) with outage queue replay |
| **Data freshness** | 20 seconds (polling interval) | <500ms (WebSocket push) |
| **Local storage** | SQLite (single-writer, no replication) | PostgreSQL 17 (multi-writer, streaming replication) |

### Payment Architecture Comparison
| Aspect | SmartTab | GWI POS |
|--------|----------|---------|
| **Processors** | WorldNet TPS, SPIn POS, 360 Payments, Braintree, Magensa | Datacap only |
| **Payment tables** | ~20 (saga pattern for each flow) | 6 (simpler, single processor) |
| **Card readers** | MagTek Dyno-Flex, IDTech GoChip, mobile paired readers | Datacap EMV (PAX A6650) |
| **Pre-auth** | 3 tables (request, operation, authorization) | Via Datacap API directly |
| **Offline payments** | None observed | Store-and-forward (SAF) |
