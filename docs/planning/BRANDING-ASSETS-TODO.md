# Branding Assets — TODO

## Required from Design Team

These assets are needed to replace the placeholders in the baseline enforcement system.
Placeholders are fine for testing — real assets needed before customer-facing deployment.

### 1. Boot Splash (Plymouth)
- **Deliver to:** `installer/assets/plymouth/gwi-pos/splash.png`
- **Replace:** `splash.png.placeholder`
- **Resolution:** 1920x1080 (or 1024x768 for max compatibility)
- **Format:** PNG with transparency
- **Content:** GWI POS logo centered on transparent/dark background

### 2. Desktop Wallpaper
- **Deliver to:** `installer/roles/branding/files/gwi-wallpaper.png`
- **Replace:** `gwi-wallpaper.png.placeholder`
- **Resolution:** 1920x1080
- **Format:** PNG
- **Content:** Dark branded wallpaper with subtle GWI POS logo

### 3. Login Screen Logo
- **Deliver to:** `installer/roles/branding/files/gwi-logo.png`
- **Replace:** `gwi-logo.png.placeholder`
- **Resolution:** 256x256
- **Format:** PNG with transparency
- **Content:** GWI POS logo for SDDM/GDM3 login screen

## Notes
- The branding Ansible role (`installer/roles/branding/`) is fully implemented
- It handles both KDE (SDDM) and GNOME (GDM3) desktops
- Plymouth theme script (boot animation) is done — just needs the image
- Legal/consent banner (MOTD + /etc/issue.net) is already in place
- Branding role is classified as **optional** — missing assets don't block install
