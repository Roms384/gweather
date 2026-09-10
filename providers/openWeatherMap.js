'use strict';

let Me;
try {
    const ExtensionUtils = imports.misc.extensionUtils;
    Me = ExtensionUtils.getCurrentExtension();
} catch (e) {
    Me = { imports: imports };
}
const { BaseWeatherProvider } = Me.imports.providers.base;
const { owmCodeToWmo } = Me.imports.providers.weatherCodeMap;

var OpenWeatherMapProvider = class OpenWeatherMapProvider extends BaseWeatherProvider {
    get name() {
        return 'OpenWeatherMap';
    }

    async getForecast(lat, lon) {
        const apiKey = this._settings.get_string('api-key-openweathermap')?.trim();
        if (!apiKey) {
            throw new Error('OpenWeatherMap API key is missing. Please configure it in extension preferences.');
        }

        const currentWeatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${encodeURIComponent(apiKey)}&units=metric`;
        const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${encodeURIComponent(apiKey)}&units=metric`;

        const [curRaw, fcastRaw] = await Promise.all([
            this.fetchJson(currentWeatherUrl),
            this.fetchJson(forecastUrl),
        ]);

        if (!curRaw || !fcastRaw || !fcastRaw.list) {
            throw new Error('Invalid response from OpenWeatherMap');
        }

        const curIcon = curRaw.weather?.[0]?.icon || '01d';
        const curIsDay = curIcon.endsWith('d') ? 1 : 0;
        const current = {
            temp: curRaw.main?.temp ?? 0,
            humidity: curRaw.main?.humidity != null ? curRaw.main.humidity : null,
            weatherCode: owmCodeToWmo(curRaw.weather?.[0]?.id),
            isDay: curIsDay,
            windSpeed: Math.round((curRaw.wind?.speed ?? 0) * 3.6),
            windDirection: curRaw.wind?.deg ?? 0,
        };

        // Group forecast entries by YYYY-MM-DD
        const daysMap = new Map();
        for (const item of fcastRaw.list) {
            const dateObj = new Date(item.dt * 1000);
            const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
            const hourStr = `${String(dateObj.getHours()).padStart(2, '0')}:00`;
            const isDay = item.sys?.pod === 'd' ? 1 : 0;

            const hourData = {
                time: `${dateStr}T${hourStr}`,
                hour: hourStr,
                temp: item.main?.temp ?? 0,
                weatherCode: owmCodeToWmo(item.weather?.[0]?.id),
                isDay: isDay,
                windSpeed: Math.round((item.wind?.speed ?? 0) * 3.6),
                windDirection: item.wind?.deg ?? 0,
            };

            if (!daysMap.has(dateStr)) {
                daysMap.set(dateStr, []);
            }
            daysMap.get(dateStr).push(hourData);
        }

        const daily = [];
        const sortedDates = Array.from(daysMap.keys()).sort();

        for (let i = 0; i < sortedDates.length && i < 6; i++) {
            const dateStr = sortedDates[i];
            const hours = daysMap.get(dateStr);
            const parts = dateStr.split('-');
            const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
            const dayName = i === 0 ? 'Today' : dateObj.toLocaleDateString(undefined, { weekday: 'short' });

            let tempMax = -Infinity;
            let tempMin = Infinity;
            const codes = [];

            for (const h of hours) {
                if (h.temp > tempMax) tempMax = h.temp;
                if (h.temp < tempMin) tempMin = h.temp;
                codes.push(h.weatherCode);
            }

            const weatherCode = i === 0 ? current.weatherCode : this.computeDominantWeatherCode(codes, 0);

            daily.push({
                date: dateStr,
                dayName: dayName,
                tempMax: Math.round(tempMax === -Infinity ? current.temp : tempMax),
                tempMin: Math.round(tempMin === Infinity ? current.temp : tempMin),
                weatherCode: weatherCode,
                hourly: hours,
            });
        }

        return { current, daily };
    }
};
