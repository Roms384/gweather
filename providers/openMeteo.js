'use strict';

let Me;
try {
    const ExtensionUtils = imports.misc.extensionUtils;
    Me = ExtensionUtils.getCurrentExtension();
} catch (e) {
    Me = { imports: imports };
}
const { BaseWeatherProvider } = Me.imports.providers.base;

var OpenMeteoProvider = class OpenMeteoProvider extends BaseWeatherProvider {
    get name() {
        return 'Open-Meteo';
    }

    async getForecast(lat, lon) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=relative_humidity_2m&hourly=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&past_days=1`;
        const raw = await this.fetchJson(url);
        if (!raw || !raw.hourly || !raw.daily) {
            throw new Error('Incomplete data from Open-Meteo');
        }

        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const currentHour = now.getHours();
        const currentHourStr = `${todayStr}T${String(currentHour).padStart(2, '0')}:00`;

        let hourlyCurrentIdx = raw.hourly.time.indexOf(currentHourStr);
        if (hourlyCurrentIdx === -1) {
            hourlyCurrentIdx = Math.min(24 + currentHour, raw.hourly.time.length - 1);
        }

        let dailyTodayIdx = raw.daily.time.indexOf(todayStr);
        if (dailyTodayIdx === -1) dailyTodayIdx = 1;

        const current = {
            temp: raw.hourly.temperature_2m[hourlyCurrentIdx],
            humidity: raw.current && raw.current.relative_humidity_2m != null ? raw.current.relative_humidity_2m : null,
            weatherCode: raw.hourly.weather_code[hourlyCurrentIdx],
            isDay: raw.hourly.is_day[hourlyCurrentIdx],
            windSpeed: Math.round(raw.hourly.wind_speed_10m[hourlyCurrentIdx]),
            windDirection: raw.hourly.wind_direction_10m[hourlyCurrentIdx],
        };

        const daily = [];
        for (let i = 0; i < 6; i++) {
            const dataIdx = dailyTodayIdx + i;
            if (dataIdx >= raw.daily.time.length) break;

            const dateStr = raw.daily.time[dataIdx];
            const parts = dateStr.split('-');
            const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
            const dayName = i === 0 ? 'Today' : dateObj.toLocaleDateString(undefined, { weekday: 'short' });

            const tempMax = Math.round(raw.daily.temperature_2m_max[dataIdx]);
            const tempMin = Math.round(raw.daily.temperature_2m_min[dataIdx]);

            // Calculate representative code
            let weatherCode;
            if (i === 0) {
                weatherCode = current.weatherCode;
            } else {
                const dayStartStr = `${dateStr}T00:00`;
                let dayStartIdx = raw.hourly.time.indexOf(dayStartStr);
                if (dayStartIdx === -1) dayStartIdx = 24 * (i + 1);
                const dayCodes = raw.hourly.weather_code.slice(dayStartIdx + 8, dayStartIdx + 20);
                weatherCode = this.computeDominantWeatherCode(dayCodes, raw.daily.weather_code[dataIdx]);
            }

            // Build hourly items for this day
            const hourlyItems = [];
            let hStartIdx;
            let hEndIdx;

            if (i === 0) {
                // Today: show 24 hours starting from 3 hours before current time
                hStartIdx = Math.max(0, hourlyCurrentIdx - 3);
                hEndIdx = Math.min(hStartIdx + 24, raw.hourly.time.length);
            } else {
                const dayStartStr = `${dateStr}T00:00`;
                hStartIdx = raw.hourly.time.indexOf(dayStartStr);
                if (hStartIdx === -1) hStartIdx = (dailyTodayIdx + i) * 24;
                hEndIdx = Math.min(hStartIdx + 24, raw.hourly.time.length);
            }

            for (let h = hStartIdx; h < hEndIdx; h++) {
                const timeStr = raw.hourly.time[h];
                const hourPart = timeStr.split('T')[1] || '';
                hourlyItems.push({
                    time: timeStr,
                    hour: hourPart,
                    temp: raw.hourly.temperature_2m[h],
                    weatherCode: raw.hourly.weather_code[h],
                    isDay: raw.hourly.is_day[h],
                    windSpeed: Math.round(raw.hourly.wind_speed_10m[h]),
                    windDirection: raw.hourly.wind_direction_10m[h],
                });
            }

            daily.push({
                date: dateStr,
                dayName: dayName,
                tempMax: tempMax,
                tempMin: tempMin,
                weatherCode: weatherCode,
                hourly: hourlyItems,
            });
        }

        return { current, daily };
    }
};
