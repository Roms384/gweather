'use strict';

let Me;
try {
    const ExtensionUtils = imports.misc.extensionUtils;
    Me = ExtensionUtils.getCurrentExtension();
} catch (e) {
    Me = { imports: imports };
}
const { BaseWeatherProvider } = Me.imports.providers.base;
const { metNoSymbolToWmo } = Me.imports.providers.weatherCodeMap;

var MetNoProvider = class MetNoProvider extends BaseWeatherProvider {
    get name() {
        return 'MET Norway';
    }

    async getForecast(lat, lon) {
        // MET Norway requires 4 decimal digits maximum for optimal caching
        const formattedLat = Number(lat).toFixed(4);
        const formattedLon = Number(lon).toFixed(4);
        const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${formattedLat}&lon=${formattedLon}`;

        const headers = {
            'User-Agent': 'GWeatherExtension/1.0 (https://github.com/Roms384/gweather)',
        };

        const raw = await this.fetchJson(url, headers);
        const timeseries = raw?.properties?.timeseries;
        if (!timeseries || timeseries.length === 0) {
            throw new Error('Invalid response from MET Norway');
        }

        // Group timeseries items by local date string YYYY-MM-DD
        const daysMap = new Map();
        const now = new Date();

        for (const item of timeseries) {
            const dateObj = new Date(item.time);
            const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
            const hourStr = `${String(dateObj.getHours()).padStart(2, '0')}:00`;

            const details = item.data.instant?.details || {};
            const summary1 = item.data.next_1_hours?.summary?.symbol_code;
            const summary6 = item.data.next_6_hours?.summary?.symbol_code;
            const summary12 = item.data.next_12_hours?.summary?.symbol_code;
            const symbol = summary1 || summary6 || summary12 || 'cloudy';

            const weatherCode = metNoSymbolToWmo(symbol);
            const isDay = symbol.includes('night') ? 0 : 1;
            const temp = details.air_temperature ?? 0;
            const humidity = details.relative_humidity ?? null;
            // MET Norway returns wind speed in m/s; convert to km/h
            const windSpeed = Math.round((details.wind_speed ?? 0) * 3.6);
            const windDirection = details.wind_from_direction ?? 0;

            const normalizedHour = {
                time: `${dateStr}T${hourStr}`,
                hour: hourStr,
                temp: temp,
                humidity: humidity,
                weatherCode: weatherCode,
                isDay: isDay,
                windSpeed: windSpeed,
                windDirection: windDirection,
                timestamp: dateObj.getTime(),
            };

            if (!daysMap.has(dateStr)) {
                daysMap.set(dateStr, []);
            }
            daysMap.get(dateStr).push(normalizedHour);
        }

        // Current condition: take closest point to current time
        let currentItem = timeseries[0];
        let minDiff = Infinity;
        const nowMs = now.getTime();
        for (const item of timeseries) {
            const diff = Math.abs(new Date(item.time).getTime() - nowMs);
            if (diff < minDiff) {
                minDiff = diff;
                currentItem = item;
            }
        }

        const curDetails = currentItem.data.instant?.details || {};
        const curSymbol = currentItem.data.next_1_hours?.summary?.symbol_code ||
                          currentItem.data.next_6_hours?.summary?.symbol_code ||
                          currentItem.data.next_12_hours?.summary?.symbol_code || 'cloudy';

        const current = {
            temp: curDetails.air_temperature ?? 0,
            humidity: curDetails.relative_humidity != null ? Math.round(curDetails.relative_humidity) : null,
            weatherCode: metNoSymbolToWmo(curSymbol),
            isDay: curSymbol.includes('night') ? 0 : 1,
            windSpeed: Math.round((curDetails.wind_speed ?? 0) * 3.6),
            windDirection: curDetails.wind_from_direction ?? 0,
        };

        const daily = [];
        const sortedDates = Array.from(daysMap.keys()).sort();
        const maxDays = Math.min(6, sortedDates.length);

        for (let i = 0; i < maxDays; i++) {
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

            // For today, if we have previous hours, include them starting up to 3h ago
            let hourlyForDay = hours;
            if (i === 0) {
                const threeHoursAgo = nowMs - (3 * 3600 * 1000);
                hourlyForDay = hours.filter(h => h.timestamp >= threeHoursAgo);
                if (hourlyForDay.length === 0) hourlyForDay = hours;
            }

            daily.push({
                date: dateStr,
                dayName: dayName,
                tempMax: Math.round(tempMax),
                tempMin: Math.round(tempMin),
                weatherCode: weatherCode,
                hourly: hourlyForDay,
            });
        }

        return { current, daily };
    }
};
