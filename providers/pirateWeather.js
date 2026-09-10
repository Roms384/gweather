'use strict';

let Me;
try {
    const ExtensionUtils = imports.misc.extensionUtils;
    Me = ExtensionUtils.getCurrentExtension();
} catch (e) {
    Me = { imports: imports };
}
const { BaseWeatherProvider } = Me.imports.providers.base;
const { pirateWeatherIconToWmo } = Me.imports.providers.weatherCodeMap;

var PirateWeatherProvider = class PirateWeatherProvider extends BaseWeatherProvider {
    get name() {
        return 'Pirate Weather';
    }

    async getForecast(lat, lon) {
        const apiKey = this._settings.get_string('api-key-pirateweather')?.trim();
        if (!apiKey) {
            throw new Error('Pirate Weather API key is missing. Please configure it in extension preferences.');
        }

        const url = `https://api.pirateweather.net/forecast/${encodeURIComponent(apiKey)}/${lat},${lon}?units=ca&exclude=minutely,alerts`;
        const raw = await this.fetchJson(url);

        if (!raw || !raw.currently || !raw.daily || !raw.daily.data) {
            throw new Error('Invalid response from Pirate Weather');
        }

        const cur = raw.currently;
        const current = {
            temp: cur.temperature ?? 0,
            humidity: cur.humidity != null ? Math.round(cur.humidity * 100) : null,
            weatherCode: pirateWeatherIconToWmo(cur.icon),
            isDay: cur.icon?.includes('night') ? 0 : 1,
            windSpeed: Math.round(cur.windSpeed ?? 0),
            windDirection: cur.windBearing ?? 0,
        };

        // Group hourly data by YYYY-MM-DD
        const hourlyByDate = new Map();
        if (raw.hourly && raw.hourly.data) {
            for (const h of raw.hourly.data) {
                const dateObj = new Date(h.time * 1000);
                const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
                const hourStr = `${String(dateObj.getHours()).padStart(2, '0')}:00`;

                const hourItem = {
                    time: `${dateStr}T${hourStr}`,
                    hour: hourStr,
                    temp: h.temperature ?? 0,
                    weatherCode: pirateWeatherIconToWmo(h.icon),
                    isDay: h.icon?.includes('night') ? 0 : 1,
                    windSpeed: Math.round(h.windSpeed ?? 0),
                    windDirection: h.windBearing ?? 0,
                };

                if (!hourlyByDate.has(dateStr)) {
                    hourlyByDate.set(dateStr, []);
                }
                hourlyByDate.get(dateStr).push(hourItem);
            }
        }

        const daily = [];
        const maxDays = Math.min(6, raw.daily.data.length);

        for (let i = 0; i < maxDays; i++) {
            const d = raw.daily.data[i];
            const dateObj = new Date(d.time * 1000);
            const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
            const dayName = i === 0 ? 'Today' : dateObj.toLocaleDateString(undefined, { weekday: 'short' });

            const tempMax = Math.round(d.temperatureHigh ?? d.temperatureMax ?? current.temp);
            const tempMin = Math.round(d.temperatureLow ?? d.temperatureMin ?? current.temp);
            const weatherCode = i === 0 ? current.weatherCode : pirateWeatherIconToWmo(d.icon);

            daily.push({
                date: dateStr,
                dayName: dayName,
                tempMax: tempMax,
                tempMin: tempMin,
                weatherCode: weatherCode,
                hourly: hourlyByDate.get(dateStr) || [],
            });
        }

        return { current, daily };
    }
};
