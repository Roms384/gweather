const { GObject, St, Clutter, Gio, Soup, GLib } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { getWeatherProvider } = Me.imports.providers.index;

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

const WeatherIndicator = GObject.registerClass(
    class WeatherIndicator extends PanelMenu.Button {
        _init() {
            super._init(0.0, 'GWeather');
            log('GWeather: Initializing extension...');

            this._settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.gweather');
            this._currentDayIndex = 0;
            this._forecastData = null;

            // Auto-refresh when location or provider settings change in preferences
            this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
                const monitoredKeys = [
                    'latitude',
                    'longitude',
                    'location-name',
                    'weather-provider',
                    'api-key-weatherapi',
                    'api-key-openweathermap',
                    'api-key-pirateweather',
                ];
                if (monitoredKeys.includes(key)) {
                    log(`GWeather: Setting '${key}' changed, refreshing...`);
                    this._refresh().catch(logError);
                }
            });

            // Icon in panel
            this._panelBox = new St.BoxLayout({
                style_class: 'panel-status-menu-box',
                style: 'spacing: 4px;',
            });

            this._icon = new St.Icon({
                icon_name: 'weather-few-clouds-symbolic',
                style_class: 'system-status-icon',
                style: 'padding: 0; margin: 0;',
            });

            this._tempLabel = new St.Label({
                text: '',
                y_align: Clutter.ActorAlign.CENTER,
                style: 'padding: 0; margin: 0;',
            });

            this._panelBox.add_child(this._icon);
            this._panelBox.add_child(this._tempLabel);

            this.add_child(this._panelBox);

            // Build the menu
            try {
                this._buildMenu();
            } catch (e) {
                logError(e);
            }

            // Initial update
            this._refresh().catch(logError);

            // Auto-refresh every 5 minutes (300 seconds)
            this._refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, () => {
                log('GWeather: Auto-refresh triggered');
                this._refresh().catch(logError);
                return GLib.SOURCE_CONTINUE;
            });

            this.menu.connect('open-state-changed', (menu, isOpen) => {
                log(`GWeather: Menu open state changed: ${isOpen}`);
                if (isOpen) {
                    // Dynamically set menu width based on available work area
                    const monitorIndex = Main.layoutManager.primaryIndex;
                    const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
                    if (workArea) {
                        menu.box.set_width(workArea.width);
                        log(`GWeather: Set menu width to ${workArea.width}px (work area excludes dock/panels)`);
                    }

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

            // Header Row (location + settings)
            this._headerRow = new St.BoxLayout({
                style_class: 'gweather-header',
                x_expand: true,
                y_expand: false,
            });

            const locationName = this._settings.get_string('location-name') || 'Unknown';

            const locationBox = new St.BoxLayout({
                style_class: 'gweather-location-box',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const locationIcon = new St.Icon({
                icon_name: 'find-location-symbolic',
                style_class: 'gweather-location-icon',
                icon_size: 14,
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._locationLabel = new St.Label({
                text: locationName,
                style_class: 'gweather-location-label',
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._humidityLabel = new St.Label({
                text: '',
                style_class: 'gweather-humidity-label',
                y_align: Clutter.ActorAlign.CENTER,
            });

            locationBox.add_child(locationIcon);
            locationBox.add_child(this._locationLabel);
            locationBox.add_child(this._humidityLabel);

            const rightBox = new St.BoxLayout({
                style_class: 'gweather-header-right',
                style: 'spacing: 8px;',
                y_align: Clutter.ActorAlign.CENTER,
            });

            this._providerLabel = new St.Label({
                text: '',
                style_class: 'gweather-provider-label',
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
                track_hover: true,
            });

            const initialProvider = getWeatherProvider(this._settings);
            this._providerLabel.text = initialProvider.name;

            this._providerLabel.connect('button-press-event', () => {
                this.menu.close();
                ExtensionUtils.openPrefs();
                return Clutter.EVENT_STOP;
            });

            const settingsButton = new St.Button({
                style_class: 'gweather-settings-button',
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({
                    icon_name: 'emblem-system-symbolic',
                    style_class: 'gweather-settings-icon',
                    icon_size: 16,
                }),
            });

            settingsButton.connect('clicked', () => {
                this.menu.close();
                ExtensionUtils.openPrefs();
            });

            rightBox.add_child(this._providerLabel);
            rightBox.add_child(settingsButton);

            this._headerRow.add_child(locationBox);
            this._headerRow.add_child(rightBox);

            // Initially hidden (shown after data loads)
            this._headerRow.hide();

            this._container.add_child(this._headerRow);

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
            const lat = this._settings.get_double('latitude');
            const lon = this._settings.get_double('longitude');
            const locationName = this._settings.get_string('location-name');
            log(`GWeather: Location: ${locationName} (${lat}, ${lon})`);

            try {
                const provider = getWeatherProvider(this._settings);
                log(`GWeather: Using provider '${provider.name}'`);
                if (this._providerLabel) {
                    this._providerLabel.text = provider.name;
                }
                const data = await provider.getForecast(lat, lon);
                if (data && data.daily && data.daily.length > 0) {
                    log('GWeather: Data successfully received');
                    this._forecastData = data;
                    this._updateUI();
                } else {
                    log('GWeather: Data fetch returned empty/invalid forecast');
                    this._loadingLabel.text = 'Failed to load weather data';
                    this._loadingLabel.show();
                }
            } catch (e) {
                logError(e);
                this._loadingLabel.text = e.message || 'Error fetching data';
                this._loadingLabel.show();
            }
        }

        _updateUI() {
            if (!this._forecastData || !this._forecastData.daily) {
                log('GWeather: No data to display in UI');
                return;
            }

            log('GWeather: Starting UI update...');

            try {
                this._loadingLabel.hide();
                this._headerRow.show();
                this._tabsRow.show();
                this._detailsArea.show();

                // Update location label
                const locationName = this._settings.get_string('location-name') || 'Unknown';
                this._locationLabel.text = locationName;

                // Update provider label
                const provider = getWeatherProvider(this._settings);
                if (this._providerLabel) {
                    this._providerLabel.text = provider.name;
                }

                const { current, daily } = this._forecastData;

                // Update Panel Icon & Temperature
                log(`GWeather: Setting panel icon and temp (${current.temp}°)`);
                this._icon.icon_name = getWeatherIcon(current.weatherCode, false, current.isDay);
                this._tempLabel.text = `${current.temp.toFixed(1)}°`;

                // Update humidity label
                if (current.humidity != null) {
                    this._humidityLabel.text = `💧 ${current.humidity}%`;
                } else {
                    this._humidityLabel.text = '';
                }

                // Update Tabs
                log('GWeather: Populating tabs...');
                this._tabsRow.destroy_all_children();

                for (let i = 0; i < daily.length; i++) {
                    const day = daily[i];
                    const tabBox = new St.BoxLayout({ vertical: true });
                    tabBox.add_child(new St.Label({ text: day.dayName, x_align: Clutter.ActorAlign.CENTER }));

                    const iconClass = `tab-icon ${getWeatherClass(day.weatherCode)}`;
                    tabBox.add_child(new St.Icon({
                        icon_name: getWeatherIcon(day.weatherCode, true),
                        style_class: iconClass,
                        icon_size: 48,
                    }));
                    tabBox.add_child(new St.Label({ text: `${day.tempMax}°`, style_class: 'gweather-temp-max', x_align: Clutter.ActorAlign.CENTER }));

                    const tab = new St.Button({
                        style_class: i === this._currentDayIndex ? 'gweather-tab-button gweather-tab-button-active' : 'gweather-tab-button',
                        can_focus: true,
                        x_expand: true,
                        child: tabBox,
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
                    style_class: 'gweather-details-scroll',
                });

                const hourlyBox = new St.BoxLayout({
                    vertical: false,
                    x_expand: true,
                    y_expand: true,
                });

                const selectedDay = daily[this._currentDayIndex] || daily[0];
                const hourlyItems = selectedDay?.hourly || [];

                for (const item of hourlyItems) {
                    const col = new St.BoxLayout({
                        vertical: true,
                        style_class: 'gweather-hourly-col',
                    });

                    // Hour
                    col.add_child(new St.Label({
                        text: item.hour,
                        style_class: 'hourly-time',
                        x_align: Clutter.ActorAlign.CENTER,
                    }));

                    // Icon
                    const iconClass = `detail-icon ${getWeatherClass(item.weatherCode, item.isDay)}`;
                    col.add_child(new St.Icon({
                        icon_name: getWeatherIcon(item.weatherCode, true, item.isDay),
                        style_class: iconClass,
                        icon_size: 32,
                        x_align: Clutter.ActorAlign.CENTER,
                    }));

                    // Temp
                    col.add_child(new St.Label({
                        text: `${item.temp.toFixed(1)}°`,
                        style_class: 'hourly-temp',
                        x_align: Clutter.ActorAlign.CENTER,
                    }));

                    // Summary
                    col.add_child(new St.Label({
                        text: getWeatherLabel(item.weatherCode),
                        style_class: 'hourly-label',
                        x_align: Clutter.ActorAlign.CENTER,
                    }));

                    // Wind
                    let windClass = 'wind-low';
                    if (item.windSpeed >= 20) {
                        windClass = 'wind-high';
                    } else if (item.windSpeed >= 10) {
                        windClass = 'wind-medium';
                    }

                    const windBox = new St.Bin({
                        style_class: `hourly-wind-box ${windClass}`,
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                        x_expand: true,
                    });

                    const innerBox = new St.BoxLayout({
                        vertical: false,
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    const windArrow = new St.Label({
                        text: `${getWindDirectionArrow(item.windDirection)}`,
                        style_class: 'wind-arrow',
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    const windSpeedLabel = new St.Label({
                        text: `${item.windSpeed}`,
                        style_class: 'wind-speed',
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    innerBox.add_child(windArrow);
                    innerBox.add_child(windSpeedLabel);

                    windBox.set_child(innerBox);
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

        destroy() {
            if (this._refreshTimerId) {
                GLib.source_remove(this._refreshTimerId);
                this._refreshTimerId = null;
            }
            if (this._settingsChangedId) {
                this._settings.disconnect(this._settingsChangedId);
                this._settingsChangedId = null;
            }
            super.destroy();
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
