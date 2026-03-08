const { GObject, St, Clutter, Gio, Soup, GLib } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const WEATHER_CODE_MAP = {
    0: { label: 'Clear sky', icon: 'weather-clear-symbolic', fullIcon: 'weather-clear', nightIcon: 'weather-clear-night-symbolic', nightFullIcon: 'weather-clear-night' },
    1: { label: 'Mainly clear', icon: 'weather-few-clouds-symbolic', fullIcon: 'weather-few-clouds', nightIcon: 'weather-few-clouds-night-symbolic', nightFullIcon: 'weather-few-clouds-night' },
    2: { label: 'Partly cloudy', icon: 'weather-few-clouds-symbolic', fullIcon: 'weather-few-clouds', nightIcon: 'weather-few-clouds-night-symbolic', nightFullIcon: 'weather-few-clouds-night' },
    3: { label: 'Overcast', icon: 'weather-overcast-symbolic', fullIcon: 'weather-overcast' },
    45: { label: 'Fog', icon: 'weather-fog-symbolic', fullIcon: 'weather-fog' },
    48: { label: 'Depositing rime fog', icon: 'weather-fog-symbolic', fullIcon: 'weather-fog' },
    51: { label: 'Drizzle: Light', icon: 'weather-showers-scattered-symbolic', fullIcon: 'weather-showers-scattered' },
    53: { label: 'Drizzle: Moderate', icon: 'weather-showers-scattered-symbolic', fullIcon: 'weather-showers-scattered' },
    55: { label: 'Drizzle: Dense', icon: 'weather-showers-scattered-symbolic', fullIcon: 'weather-showers-scattered' },
    61: { label: 'Rain: Slight', icon: 'weather-showers-symbolic', fullIcon: 'weather-showers' },
    63: { label: 'Rain: Moderate', icon: 'weather-showers-symbolic', fullIcon: 'weather-showers' },
    65: { label: 'Rain: Heavy', icon: 'weather-showers-symbolic', fullIcon: 'weather-showers' },
    71: { label: 'Snow fall: Slight', icon: 'weather-snow-symbolic', fullIcon: 'weather-snow' },
    73: { label: 'Snow fall: Moderate', icon: 'weather-snow-symbolic', fullIcon: 'weather-snow' },
    75: { label: 'Snow fall: Heavy', icon: 'weather-snow-symbolic', fullIcon: 'weather-snow' },
    95: { label: 'Thunderstorm', icon: 'weather-storm-symbolic', fullIcon: 'weather-storm' },
};

function getWeatherIcon(code, full = false, isDay = 1) {
    const item = WEATHER_CODE_MAP[code];
    if (isDay === 0) {
        if (full) return item?.nightFullIcon || item?.fullIcon || item?.icon || 'weather-clear-night';
        return item?.nightIcon || item?.icon || 'weather-clear-night-symbolic';
    }
    if (full) return item?.fullIcon || item?.icon || 'weather-few-clouds';
    return item?.icon || 'weather-few-clouds-symbolic';
}

function getWeatherLabel(code) {
    return WEATHER_CODE_MAP[code]?.label || 'Unknown';
}

function getWeatherClass(code, isDay = 1) {
    if (isDay === 0) {
        if (code === 0 || code === 1 || code === 2) return 'weather-night';
        if (code === 3) return 'weather-cloudy-night';
    }
    if (code === 0 || code === 1 || code === 2) return 'weather-sunny';
    if (code === 3) return 'weather-cloudy';
    if (code >= 51 && code <= 65) return 'weather-rainy';
    if (code >= 71 && code <= 75) return 'weather-snowy';
    if (code === 95) return 'weather-stormy';
    return '';
}

function getWindDirectionArrow(deg) {
    // Weather APIs give direction FROM (0 = North). 
    // We want the arrow to point TO, so we add 180 degrees.
    const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];
    const index = Math.round(deg / 45) % 8;
    return arrows[index];
}

// Basic Weather Service using Open-Meteo
class WeatherService {
    constructor() {
        this._httpSession = new Soup.Session();
        this._isSoup3 = Soup.get_major_version?.() === 3 || this._httpSession.send_and_read_async;
        log(`GWeather: Using Soup version ${this._isSoup3 ? '3.0' : '2.4'}`);
    }

    async getForecast(lat, lon) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&past_days=1`;

        log(`GWeather: Fetching from ${url}`);

        if (this._isSoup3) {
            // Soup 3.0
            try {
                const message = Soup.Message.new('GET', url);
                const bytes = await this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
                const decoder = new TextDecoder('utf-8');
                const data = JSON.parse(decoder.decode(bytes.get_data()));
                return data;
            } catch (e) {
                log(`GWeather: Soup 3.0 Error: ${e.message}`);
                logError(e);
                return null;
            }
        } else {
            // Soup 2.4
            const message = Soup.Message.new('GET', url);
            return new Promise((resolve) => {
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code !== 200) {
                        log(`GWeather: Soup 2.4 Error - Status: ${msg.status_code}, Reason: ${msg.reason_phrase}`);
                        resolve(null);
                        return;
                    }
                    try {
                        const data = JSON.parse(msg.response_body.data);
                        resolve(data);
                    } catch (e) {
                        log(`GWeather: Soup 2.4 Parse Error: ${e.message}`);
                        logError(e);
                        resolve(null);
                    }
                });
            });
        }
    }
}

const WeatherIndicator = GObject.registerClass(
    class WeatherIndicator extends PanelMenu.Button {
        _init() {
            super._init(0.0, 'GWeather');
            log('GWeather: Initializing extension...');

            this._weatherService = new WeatherService();
            this._currentDayIndex = 0;
            this._forecastData = null;

            // Icon in panel
            this._icon = new St.Icon({
                icon_name: 'weather-few-clouds-symbolic',
                style_class: 'system-status-icon',
            });

            this.add_child(this._icon);

            // Build the menu
            try {
                this._buildMenu();
            } catch (e) {
                logError(e);
            }

            // Initial update
            this._refresh().catch(logError);

            this.menu.connect('open-state-changed', (menu, isOpen) => {
                log(`GWeather: Menu open state changed: ${isOpen}`);
                if (isOpen) {
                    this._refresh().catch(logError);

                    // Slide-down animation
                    const menuActor = menu.box;
                    menuActor.translation_y = -20;
                    menuActor.opacity = 0;
                    menuActor.ease({
                        translation_y: 0,
                        opacity: 255,
                        duration: 500,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
            });
        }

        _buildMenu() {
            log('GWeather: Building menu...');
            this.menu.box.add_style_class_name('gweather-menu');

            // Main Container
            this._container = new St.BoxLayout({
                vertical: true,
                style_class: 'gweather-container',
                x_expand: true,
                y_expand: true,
            });

            this._loadingLabel = new St.Label({
                text: 'Loading forecast...',
                style_class: 'gweather-loading-label',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
            });
            this._container.add_child(this._loadingLabel);

            // Tabs Row
            this._tabsRow = new St.BoxLayout({
                style_class: 'gweather-tabs',
                x_expand: true,
                y_expand: false,
            });

            // Details Area
            this._detailsArea = new St.BoxLayout({
                vertical: true,
                style_class: 'gweather-details',
                x_expand: true,
                y_expand: true,
            });

            // Initially hidden
            this._tabsRow.hide();
            this._detailsArea.hide();

            this._container.add_child(this._tabsRow);
            this._container.add_child(this._detailsArea);

            let menuItem = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
            });

            // In GNOME 42, PopupBaseMenuItem is an St.BoxLayout.
            // We should make sure it expands to fill the menu width.
            menuItem.add_child(this._container);

            this.menu.addMenuItem(menuItem);
            log('GWeather: Menu built');
        }

        async _refresh() {
            log('GWeather: Refreshing forecast data...');
            const lat = 51.5074;
            const lon = -0.1278;

            try {
                const data = await this._weatherService.getForecast(lat, lon);
                if (data) {
                    log('GWeather: Data successfully received');
                    this._forecastData = data;
                    this._updateUI();
                } else {
                    log('GWeather: Data fetch returned null');
                    this._loadingLabel.text = 'Failed to load weather data';
                    this._loadingLabel.show();
                }
            } catch (e) {
                logError(e);
                this._loadingLabel.text = 'Error fetching data';
                this._loadingLabel.show();
            }
        }

        _updateUI() {
            if (!this._forecastData) {
                log('GWeather: No data to display in UI');
                return;
            }

            log('GWeather: Starting UI update...');

            try {
                this._loadingLabel.hide();
                this._tabsRow.show();
                this._detailsArea.show();

                // Current day/time for index sync
                const now = new Date();
                const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                const currentHour = now.getHours();
                const currentHourStr = `${todayStr}T${String(currentHour).padStart(2, '0')}:00`;

                // Find indices dynamically
                let hourlyCurrentIdx = this._forecastData.hourly.time.indexOf(currentHourStr);
                if (hourlyCurrentIdx === -1) hourlyCurrentIdx = 24 + currentHour; // fallback

                let dailyTodayIdx = this._forecastData.daily.time.indexOf(todayStr);
                if (dailyTodayIdx === -1) dailyTodayIdx = 1; // fallback

                // Find start of today in hourly data for offsets
                const hourlyTodayStartIdx = this._forecastData.hourly.time.indexOf(`${todayStr}T00:00`);

                // Update Panel Icon
                log(`GWeather: Setting panel icon (idx ${hourlyCurrentIdx})`);
                const currentCode = this._forecastData.hourly.weather_code[hourlyCurrentIdx];
                const currentIsDay = this._forecastData.hourly.is_day[hourlyCurrentIdx];
                this._icon.icon_name = getWeatherIcon(currentCode, false, currentIsDay);

                // Update Tabs
                log(`GWeather: Populating tabs starting from daily idx ${dailyTodayIdx}...`);
                this._tabsRow.destroy_all_children();
                for (let i = 0; i < 6; i++) {
                    const dataIdx = dailyTodayIdx + i;
                    const dateStr = this._forecastData.daily.time[dataIdx];
                    if (!dateStr) continue;

                    const parts = dateStr.split('-');
                    const date = new Date(parts[0], parts[1] - 1, parts[2]);

                    const dayName = i === 0 ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' });
                    const tempMax = Math.round(this._forecastData.daily.temperature_2m_max[dataIdx]);

                    // Calculate representative code for the tab
                    let code;
                    if (i === 0) {
                        code = currentCode; // Today matches current conditions
                    } else {
                        // For future days, find the most common weather code between 08:00 and 20:00
                        const dayStartIdx = (hourlyTodayStartIdx === -1 ? 24 : hourlyTodayStartIdx) + (i * 24);
                        const dayEndIdx = dayStartIdx + 24;
                        const dayCodes = this._forecastData.hourly.weather_code.slice(dayStartIdx + 8, dayStartIdx + 20); // Focus on daylight hours

                        const counts = {};
                        dayCodes.forEach(c => counts[c] = (counts[c] || 0) + 1);
                        code = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
                        code = parseInt(code);
                    }

                    const tabBox = new St.BoxLayout({ vertical: true });
                    tabBox.add_child(new St.Label({ text: dayName, x_align: Clutter.ActorAlign.CENTER }));
                    const iconClass = `tab-icon ${getWeatherClass(code)}`;
                    tabBox.add_child(new St.Icon({
                        icon_name: getWeatherIcon(code, true),
                        style_class: iconClass,
                        icon_size: 48
                    }));
                    tabBox.add_child(new St.Label({ text: `${tempMax}°`, style_class: 'gweather-temp-max', x_align: Clutter.ActorAlign.CENTER }));

                    const tab = new St.Button({
                        style_class: i === this._currentDayIndex ? 'gweather-tab-button gweather-tab-button-active' : 'gweather-tab-button',
                        can_focus: true,
                        x_expand: true,
                        child: tabBox
                    });

                    tab.connect('clicked', () => {
                        log(`GWeather: Tab ${i} clicked`);
                        this._currentDayIndex = i;
                        this._updateUI();
                    });

                    this._tabsRow.add_child(tab);
                }

                // Update Details
                log('GWeather: Populating details...');
                this._detailsArea.destroy_all_children();

                const scrollView = new St.ScrollView({
                    hscrollbar_policy: St.PolicyType.AUTOMATIC,
                    vscrollbar_policy: St.PolicyType.NEVER,
                    x_expand: true,
                    y_expand: true,
                    width: 600, // Constrain width to prevent going off-screen
                    style_class: 'gweather-details-scroll'
                });

                const hourlyBox = new St.BoxLayout({
                    vertical: false,
                    x_expand: true,
                    y_expand: true
                });

                // Find start of selected day in hourly data
                let startIdx = (hourlyTodayStartIdx === -1 ? 24 : hourlyTodayStartIdx) + (this._currentDayIndex * 24);

                if (this._currentDayIndex === 0) {
                    // Today starts 3 hours before current time
                    startIdx = Math.max(0, hourlyCurrentIdx - 3);
                }

                log(`GWeather: Populating hourly items (horizontal) from index ${startIdx}`);
                for (let i = startIdx; i < startIdx + 24; i++) {
                    if (i >= this._forecastData.hourly.time.length) break;

                    const timeStr = this._forecastData.hourly.time[i];
                    const hour = timeStr.split('T')[1];

                    const temp = Math.round(this._forecastData.hourly.temperature_2m[i]);
                    const code = this._forecastData.hourly.weather_code[i];
                    const isDay = this._forecastData.hourly.is_day[i];
                    const windSpeed = Math.round(this._forecastData.hourly.wind_speed_10m[i]);
                    const windDeg = this._forecastData.hourly.wind_direction_10m[i];

                    const col = new St.BoxLayout({
                        vertical: true,
                        style_class: 'gweather-hourly-col',
                    });

                    // Hour
                    col.add_child(new St.Label({
                        text: hour,
                        style_class: 'hourly-time',
                        x_align: Clutter.ActorAlign.CENTER
                    }));

                    // Icon
                    const iconClass = `detail-icon ${getWeatherClass(code, isDay)}`;
                    col.add_child(new St.Icon({
                        icon_name: getWeatherIcon(code, true, isDay),
                        style_class: iconClass,
                        icon_size: 32,
                        x_align: Clutter.ActorAlign.CENTER
                    }));

                    // Temp
                    col.add_child(new St.Label({
                        text: `${temp}°`,
                        style_class: 'hourly-temp',
                        x_align: Clutter.ActorAlign.CENTER
                    }));

                    // Summary
                    col.add_child(new St.Label({
                        text: getWeatherLabel(code),
                        style_class: 'hourly-label',
                        x_align: Clutter.ActorAlign.CENTER
                    }));

                    // Wind
                    const windBox = new St.BoxLayout({
                        style_class: 'hourly-wind-box',
                        x_align: Clutter.ActorAlign.CENTER
                    });
                    windBox.add_child(new St.Label({
                        text: `${getWindDirectionArrow(windDeg)}`,
                        style_class: 'wind-arrow'
                    }));
                    windBox.add_child(new St.Label({
                        text: `${windSpeed}`,
                        style_class: 'wind-speed'
                    }));
                    col.add_child(windBox);

                    hourlyBox.add_child(col);
                }

                scrollView.add_actor(hourlyBox);
                this._detailsArea.add_child(scrollView);
                log('GWeather: UI update complete');
            } catch (e) {
                log('GWeather: Error in _updateUI');
                logError(e);
                throw e; // Rethrow so _refresh catch block can catch it
            }
        }
    });

let _indicator;

function init() {
    // Initialization code
}

function enable() {
    _indicator = new WeatherIndicator();
    Main.panel.addToStatusArea('gweather-indicator', _indicator);
}

function disable() {
    if (_indicator) {
        _indicator.destroy();
        _indicator = null;
    }
}
