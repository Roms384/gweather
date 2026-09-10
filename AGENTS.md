# AGENTS.md

> Operational guide and codebase manual for AI agents and developers working on the **GWeather** GNOME Shell extension.

---

## 1. Project Overview & Target Platform

**GWeather** (`gweather@antigravity`) is a GNOME Shell extension that displays current weather conditions in the top panel and provides a rich dropdown menu with a 6-day daily forecast and a 24-hour horizontal scrollable hourly breakdown.

- **Target Shell Version:** GNOME Shell **42** (`shell-version: ["42"]` in [metadata.json](file:///home/roms/work/gweather/metadata.json)).
- **Runtime Environment:** GJS (GNOME JavaScript / SpiderMonkey) ~1.72 with Libadwaita (GTK4) for preferences.
- **Import Paradigm:** Classic GJS `imports.*` namespace (GNOME 42). **Do NOT use GNOME 45+ ESM `import ... from ...` statements**.
- **Settings Storage:** GSettings schema `org.gnome.shell.extensions.gweather`.

---

## 2. Architecture & Key Directories

### Directory Structure

```text
/home/roms/work/gweather/
├── metadata.json          # Extension metadata (UUID, name, shell-version, schema)
├── extension.js           # Main extension entrypoint & PanelMenu UI implementation
├── prefs.js               # GTK4 / Libadwaita preferences window
├── stylesheet.css         # Styling for panel button, popup menu, tabs, wind, weather colors
├── schemas/
│   ├── org.gnome.shell.extensions.gweather.gschema.xml  # GSettings schema definition
│   └── gschemas.compiled                               # Binary compiled GSettings schema
└── providers/
    ├── base.js            # BaseWeatherProvider abstract class & Soup 2/3 HTTP fetcher
    ├── index.js           # Provider registry (PROVIDERS_META) and factory functions
    ├── weatherCodeMap.js  # Mapping functions converting provider conditions to WMO codes
    ├── openMeteo.js       # Open-Meteo provider (free, default, no key needed)
    ├── metNo.js           # MET Norway / Yr.no provider (free, no key needed)
    ├── weatherApi.js      # WeatherAPI.com provider (free key required)
    ├── openWeatherMap.js  # OpenWeatherMap provider (free key required)
    └── pirateWeather.js   # Pirate Weather / Dark Sky provider (free key required)
```

### Component Architecture

#### 1. Extension Lifecycle ([extension.js](file:///home/roms/work/gweather/extension.js))
- `init()`: Required by GNOME 42 lifecycle; extension initialization.
- `enable()`: Instantiates `WeatherIndicator` and registers it in the panel status area via `Main.panel.addToStatusArea('gweather-indicator', _indicator)`.
- `disable()`: Tears down `_indicator` by calling its `.destroy()` method and resets the reference.
- `WeatherIndicator`: Subclasses `PanelMenu.Button` (`GObject.registerClass`).
  - **Panel Elements:** Horizontal box containing a condition icon (`St.Icon`) and current temperature (`St.Label`).
  - **Dropdown Menu:**
    - Header: Displays location name, humidity percentage, current provider label (clickable to open prefs), and settings button.
    - Day Tabs: 6 selectable buttons showing day name, representative weather icon, and max temperature.
    - Hourly Area: Horizontal `St.ScrollView` showing 24 hourly columns (hour, icon, temperature, condition description, and wind direction arrow + speed box).
  - **Periodic Refresh:** Uses `GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, ...)` to auto-refresh weather every 5 minutes.
  - **Dynamic Sizing:** Listens to `menu.connect('open-state-changed')` and dynamically sets menu width to `Main.layoutManager.getWorkAreaForMonitor(primaryIndex).width`.

#### 2. Multi-Provider Architecture ([providers/](file:///home/roms/work/gweather/providers/))
- All weather providers extend `BaseWeatherProvider` in [providers/base.js](file:///home/roms/work/gweather/providers/base.js).
- Provides a unified `fetchJson(url, customHeaders)` method compatible with both **Libsoup 3** (`send_and_read_async`) and **Libsoup 2** (`queue_message`).
- **Normalized Data Contract:** Every provider's `getForecast(lat, lon)` must return a Promise resolving to this exact schema:

```javascript
{
    current: {
        temp: Number,          // Celsius
        humidity: Number|null, // Integer percentage 0-100, or null
        weatherCode: Number,   // Canonical WMO weather code (0-95)
        isDay: Number,         // 1 = day, 0 = night
        windSpeed: Number,     // km/h (integer)
        windDirection: Number  // Degrees 0-360
    },
    daily: [
        {
            date: String,        // "YYYY-MM-DD"
            dayName: String,     // "Today" for index 0, otherwise short name e.g. "Mon"
            tempMax: Number,     // Rounded integer Celsius
            tempMin: Number,     // Rounded integer Celsius
            weatherCode: Number, // Canonical WMO weather code
            hourly: [
                {
                    time: String,        // "YYYY-MM-DDTHH:00"
                    hour: String,        // "HH:00"
                    temp: Number,        // Float Celsius
                    weatherCode: Number, // Canonical WMO weather code
                    isDay: Number,       // 1 = day, 0 = night
                    windSpeed: Number,   // km/h (integer)
                    windDirection: Number// Degrees 0-360
                },
                // ... 24 hourly items
            ]
        },
        // ... 6 daily items (Today + 5 future days)
    ]
}
```

#### 3. Canonical Weather Codes ([providers/weatherCodeMap.js](file:///home/roms/work/gweather/providers/weatherCodeMap.js))
- The extension normalizes all weather providers to the **WMO Weather Interpretation Codes**:
  - `0`: Clear sky
  - `1`: Mainly clear
  - `2`: Partly cloudy
  - `3`: Overcast
  - `45`, `48`: Fog / Depositing rime fog
  - `51`, `53`, `55`: Drizzle (light, moderate, dense)
  - `61`, `63`, `65`: Rain (slight, moderate, heavy)
  - `71`, `73`, `75`: Snow fall (slight, moderate, heavy)
  - `95`: Thunderstorm
- [weatherCodeMap.js](file:///home/roms/work/gweather/providers/weatherCodeMap.js) contains mapping functions for MET Norway symbol names, WeatherAPI condition codes, OpenWeatherMap condition IDs, and Pirate Weather icons.

#### 4. Preferences Window ([prefs.js](file:///home/roms/work/gweather/prefs.js))
- Built with GTK4 and Libadwaita (`Adw.PreferencesPage`, `Adw.PreferencesGroup`, `Adw.ActionRow`, `Adw.ComboRow`).
- **Location Page:** Searches for cities using Open-Meteo's geocoding API (`geocoding-api.open-meteo.com`), displays coordinates and population, and writes selected location/coordinates to GSettings.
- **Provider Page:** Allows switching providers and inputting API keys for services that require authentication (WeatherAPI, OpenWeatherMap, Pirate Weather), with direct sign-up links.

---

## 3. Build, Test, Lint, and Packaging Commands

Because this is a pure GJS GNOME Shell extension without a heavy node build step, commands are executed with native Linux tools:

### Syntax Checking & Linting

Verify JavaScript syntax across all files:
```bash
node -c extension.js prefs.js providers/*.js
```

Validate GSettings schema XML without compiling:
```bash
glib-compile-schemas --strict --dry-run schemas/
```

### Compiling GSettings Schema

Whenever [schemas/org.gnome.shell.extensions.gweather.gschema.xml](file:///home/roms/work/gweather/schemas/org.gnome.shell.extensions.gweather.gschema.xml) is edited:
```bash
glib-compile-schemas schemas/
```
*(Note: [schemas/gschemas.compiled](file:///home/roms/work/gweather/schemas/gschemas.compiled) is tracked in version control and must be kept up to date).*

### Bundling / Packaging Extension

To produce a production zip bundle ready for `extensions.gnome.org` or local testing:
```bash
gnome-extensions pack \
    --force \
    --extra-source=providers \
    --schema=schemas/org.gnome.shell.extensions.gweather.gschema.xml \
    --out-dir=.
```
> **Warning:** `--extra-source=providers` is mandatory. Without it, the `providers/` folder is omitted and the extension will fail to load at runtime.

### Local Installation & Testing

Install or sync current repository into local user extension directory:
```bash
mkdir -p ~/.local/share/gnome-shell/extensions/gweather@antigravity
rsync -av --exclude='.git' . ~/.local/share/gnome-shell/extensions/gweather@antigravity/
```

Enable / Disable:
```bash
gnome-extensions enable gweather@antigravity
gnome-extensions disable gweather@antigravity
```

Launch Preferences window:
```bash
gnome-extensions prefs gweather@antigravity
```

Run a nested GNOME Shell instance for isolated live testing (without restarting your session):
```bash
MUTTER_DEBUG_DUMMY_MODE_SPECS=1280x720 dbus-run-session -- gnome-shell --nested --wayland
```

### Viewing Logs

Monitor live extension logs via `journalctl`:
```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i GWeather
```

### GSettings CLI Commands

Inspect or modify settings directly from terminal:
```bash
# Read current provider
gsettings --schemadir schemas/ get org.gnome.shell.extensions.gweather weather-provider

# Switch provider
gsettings --schemadir schemas/ set org.gnome.shell.extensions.gweather weather-provider 'open-meteo'

# Set location
gsettings --schemadir schemas/ set org.gnome.shell.extensions.gweather location-name 'Paris, France'
gsettings --schemadir schemas/ set org.gnome.shell.extensions.gweather latitude 48.8566
gsettings --schemadir schemas/ set org.gnome.shell.extensions.gweather longitude 2.3522
```

---

## 4. Code Style & Conventions

- **Standard:** ECMAScript 2020 / modern ES6 supported by GJS 1.72 (GNOME 42).
- **Pragma:** Always start files with `'use strict';`.
- **Indentation:** 4 spaces (no tabs).
- **Semicolons:** Required at the end of statements.
- **Quotes:** Single quotes `'string'` for string literals; template literals for formatting.
- **Trailing Commas:** Use trailing commas in multi-line object and array literals.
- **Imports:**
  - Standard GNOME libraries: `const { GObject, St, Clutter, Gio, Soup, GLib } = imports.gi;`
  - Shell internals: `const Main = imports.ui.main; const PanelMenu = imports.ui.panelMenu;`
  - Extension modules:
    ```javascript
    const ExtensionUtils = imports.misc.extensionUtils;
    const Me = ExtensionUtils.getCurrentExtension();
    const { getWeatherProvider } = Me.imports.providers.index;
    ```
- **Classes:**
  - GObject-derived classes (widgets, panel buttons): Use `GObject.registerClass(class ClassName extends ParentClass { ... });`.
  - Service / Utility classes (providers): Use `var ClassName = class ClassName { ... };` (or standard ES6 `class`). Export to the global scope using `var` or properties on exports so classic GJS import can read them.
- **Naming Conventions:**
  - Private methods and properties: Prefix with underscore (e.g. `this._refreshTimerId`, `this._buildMenu()`).
  - Constants: `UPPER_SNAKE_CASE` (e.g. `WEATHER_CODE_MAP`, `PROVIDERS_META`).
  - Variables & functions: `camelCase`.
  - Classes: `PascalCase`.
- **Resource Cleanup:** Every event listener (`connect`) and GLib timer (`GLib.timeout_add_*`) MUST have its ID stored and disconnected/removed in the class `destroy()` or `disable()` function to prevent memory leaks or crashes on extension reload.

---

## 5. Non-Obvious Gotchas & Critical Pitfalls

### 1. GNOME 42 vs GNOME 45+ ESM
- GNOME 45 replaced classic GJS imports with ES Modules (`import St from 'gi://St'`) and introduced class-based extension entrypoints (`Extension.enable()`).
- **This codebase is built for GNOME 42**. Do NOT refactor `imports.gi` or `Me.imports` to ESM syntax unless the project officially bumps compatibility to GNOME 45+.

### 2. Libsoup 3.0 API Constraints
- GNOME 42 introduced Libsoup 3.0, but some Soup methods commonly used in Soup 3.4+ **do not exist** in Soup 3.0:
  - `msg.get_status()` does not exist in Soup 3.0 $\rightarrow$ Use `message.status_code`.
  - `msg.get_request_headers()` does not exist in Soup 3.0 $\rightarrow$ Use `message.request_headers`.
- See [providers/base.js:31-43](file:///home/roms/work/gweather/providers/base.js#L31-L43) for reference implementation.

### 3. MET Norway Provider Requirements
- MET Norway (`api.met.no`) strictly enforces API policies:
  - **User-Agent:** MET Norway blocks requests without a custom `User-Agent` header containing contact info or repository URL. The header is set in [providers/metNo.js](file:///home/roms/work/gweather/providers/metNo.js#L25).
  - **Coordinate Decimals:** Coordinates must be truncated or formatted to a maximum of 4 decimal places (`Number(lat).toFixed(4)`), otherwise MET Norway returns 400 or throttles due to cache invalidation.
  - **Wind Speed Units:** MET Norway returns wind speed in `m/s`. The normalized schema requires `km/h`, so it must be converted via `(wind_speed * 3.6)`.

### 4. Hourly Window Calculation
- For "Today" (index 0), the hourly list starts 3 hours before current time (to provide recent context) and spans 24 hours into the day.
- Open-Meteo requests `&past_days=1` so that early morning hours of "Today" can still look back 3 hours without index out-of-bounds errors.

### 5. GSettings Schema Compilation
- If you add or change keys in [schemas/org.gnome.shell.extensions.gweather.gschema.xml](file:///home/roms/work/gweather/schemas/org.gnome.shell.extensions.gweather.gschema.xml), GNOME Shell and GSettings will not see them until `glib-compile-schemas schemas/` is run.
- Don't forget to add new keys to the `monitoredKeys` list in `_init()` within [extension.js](file:///home/roms/work/gweather/extension.js) if changes should trigger an automatic UI refresh.

### 6. Dynamic Work Area Menu Width
- The extension dynamically resizes the popup menu width to match the primary monitor work area (`Main.layoutManager.getWorkAreaForMonitor(monitorIndex).width`).
- Because `PopupMenu.PopupBaseMenuItem` is an `St.BoxLayout` in GNOME 42, children must specify `x_expand: true` to prevent content from collapsing.
