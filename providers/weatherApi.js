'use strict';

let Me;
try {
    const ExtensionUtils = imports.misc.extensionUtils;
    Me = ExtensionUtils.getCurrentExtension();
} catch (e) {
    Me = { imports: imports };
}
const { BaseWeatherProvider } = Me.imports.providers.base;
const { weatherApiCodeToWmo } = Me.imports.providers.weatherCodeMap;

var WeatherApiProvider = class WeatherApiProvider extends BaseWeatherProvider {
    get name() {
        return 'WeatherAPI.com';
    }

    async getForecast(lat, lon) {
        const apiKey = this._settings.get_string('api-key-weatherapi')?.trim();
        if (!apiKey) {
            throw new Error('WeatherAPI.com API key is missing. Please configure it in extension preferences.');
        }

        const url = `https://api.weatherapi.com/v1/forecast.json?key=${encodeURIComponent(apiKey)}&q=${lat},${lon}&days=6&aqi=no&alerts=no`;
        const raw = await this.fetchJson(url);

        if (!raw || !raw.current || !raw.forecast || !raw.forecast.forecastday) {
            throw new Error('Invalid response from WeatherAPI.com');
        }

        const current = {
            temp: raw.current.temp_c ?? 0,
            humidity: raw.current.humidity != null ? raw.current.humidity : null,
            weatherCode: weatherApiCodeToWmo(raw.current.condition?.code),
            isDay: raw.current.is_day === 0 ? 0 : 1,
            windSpeed: Math.round(raw.current.wind_kph ?? 0),
            windDirection: raw.current.wind_degree ?? 0,
        };

        const now = new Date();
        const daily = [];

        for (let i = 0; i < raw.forecast.forecastday.length; i++) {
            const dayData = raw.forecast.forecastday[i];
            const dateStr = dayData.date; // YYYY-MM-DD
            const parts = dateStr.split('-');
            const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
            const dayName = i === 0 ? 'Today' : dateObj.toLocaleDateString(undefined, { weekday: 'short' });

            const tempMax = Math.round(dayData.day?.maxtemp_c ?? 0);
            const tempMin = Math.round(dayData.day?.mintemp_c ?? 0);
            const weatherCode = i === 0 ? current.weatherCode : weatherApiCodeToWmo(dayData.day?.condition?.code);

            const hourlyItems = [];
            const rawHours = dayData.hour || [];

            let hStart = 0;
            if (i === 0) {
                // Today starts 3 hours before current time
                const currentHour = now.getHours();
                hStart = Math.max(0, currentHour - 3);
            }

            for (let h = hStart; h < rawHours.length; h++) {
                const hourObj = rawHours[h];
                const timeStr = hourObj.time || ''; // "YYYY-MM-DD HH:00"
                const hourPart = timeStr.includes(' ') ? timeStr.split(' ')[1] : timeStr.split('T')[1] || '';

                hourlyItems.push({
                    time: timeStr.replace(' ', 'T'),
                    hour: hourPart,
                    temp: hourObj.temp_c ?? 0,
                    weatherCode: weatherApiCodeToWmo(hourObj.condition?.code),
                    isDay: hourObj.is_day === 0 ? 0 : 1,
                    windSpeed: Math.round(hourObj.wind_kph ?? 0),
                    windDirection: hourObj.wind_degree ?? 0,
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
