'use strict';

/**
 * Maps MET Norway symbol codes (e.g. 'partlycloudy_day', 'heavyrain') to canonical WMO codes.
 */
function metNoSymbolToWmo(symbol) {
    if (!symbol) return 0;
    const base = symbol.replace(/_(day|night|polartwilight)$/, '');

    switch (base) {
        case 'clearsky': return 0;
        case 'fair': return 1;
        case 'partlycloudy': return 2;
        case 'cloudy': return 3;
        case 'fog': return 45;
        case 'lightrainshowers':
        case 'lightrain': return 61;
        case 'rainshowers':
        case 'rain': return 63;
        case 'heavyrainshowers':
        case 'heavyrain': return 65;
        case 'lightrainandthunder':
        case 'rainandthunder':
        case 'heavyrainandthunder':
        case 'lightrainshowersandthunder':
        case 'rainshowersandthunder':
        case 'heavyrainshowersandthunder':
        case 'thunderstorm': return 95;
        case 'lightsnowshowers':
        case 'lightsnow': return 71;
        case 'snowshowers':
        case 'snow': return 73;
        case 'heavysnowshowers':
        case 'heavysnow': return 75;
        case 'lightsnowandthunder':
        case 'snowandthunder':
        case 'heavysnowandthunder':
        case 'lightsnowshowersandthunder':
        case 'snowshowersandthunder':
        case 'heavysnowshowersandthunder': return 95;
        case 'lightsleet':
        case 'lightsleetshowers': return 61;
        case 'sleet':
        case 'sleetshowers': return 63;
        case 'heavysleet':
        case 'heavysleetshowers': return 65;
        case 'lightsleetandthunder':
        case 'sleetandthunder':
        case 'heavysleetandthunder': return 95;
        default: return 2;
    }
}

/**
 * Maps WeatherAPI.com condition codes to canonical WMO codes.
 */
function weatherApiCodeToWmo(code) {
    if (!code) return 0;
    switch (code) {
        case 1000: return 0;  // Sunny / Clear
        case 1003: return 2;  // Partly cloudy
        case 1006:
        case 1009: return 3;  // Cloudy / Overcast
        case 1030:
        case 1135:
        case 1147: return 45; // Mist / Fog / Freezing fog
        case 1150:
        case 1153:
        case 1168: return 51; // Patchy / Light drizzle
        case 1171: return 55; // Heavy freezing drizzle
        case 1063:
        case 1180:
        case 1183:
        case 1240: return 61; // Patchy / Light rain
        case 1186:
        case 1189:
        case 1243: return 63; // Moderate rain
        case 1192:
        case 1195:
        case 1246: return 65; // Heavy rain
        case 1066:
        case 1210:
        case 1213:
        case 1255: return 71; // Patchy / Light snow
        case 1216:
        case 1219:
        case 1258: return 73; // Moderate snow
        case 1222:
        case 1225:
        case 1261: return 75; // Heavy snow
        case 1087:
        case 1273:
        case 1276:
        case 1279:
        case 1282: return 95; // Thundery outbreaks / Thunderstorm
        case 1069:
        case 1072:
        case 1198:
        case 1201:
        case 1204:
        case 1207:
        case 1237:
        case 1249:
        case 1252:
        case 1264: return 61; // Sleet / Ice pellets
        default: return 2;
    }
}

/**
 * Maps OpenWeatherMap weather IDs to canonical WMO codes.
 */
function owmCodeToWmo(code) {
    if (!code) return 0;
    if (code >= 200 && code < 300) return 95; // Thunderstorm
    if (code >= 300 && code < 400) {
        if (code === 300 || code === 301 || code === 310) return 51; // Light drizzle
        if (code === 302 || code === 311 || code === 313) return 53; // Moderate drizzle
        return 55; // Heavy drizzle
    }
    if (code >= 500 && code < 600) {
        if (code === 500 || code === 520) return 61; // Light rain
        if (code === 501 || code === 521) return 63; // Moderate rain
        return 65; // Heavy rain
    }
    if (code >= 600 && code < 700) {
        if (code === 600 || code === 620) return 71; // Light snow
        if (code === 601 || code === 621) return 73; // Moderate snow
        return 75; // Heavy snow
    }
    if (code >= 700 && code < 800) return 45; // Atmosphere: Fog, Mist, Haze
    if (code === 800) return 0; // Clear
    if (code === 801) return 1; // Few clouds
    if (code === 802) return 2; // Scattered clouds
    if (code === 803 || code === 804) return 3; // Broken / Overcast
    return 2;
}

/**
 * Maps Pirate Weather / Dark Sky icon strings to canonical WMO codes.
 */
function pirateWeatherIconToWmo(icon) {
    if (!icon) return 0;
    switch (icon) {
        case 'clear-day':
        case 'clear-night': return 0;
        case 'partly-cloudy-day':
        case 'partly-cloudy-night': return 2;
        case 'cloudy': return 3;
        case 'fog': return 45;
        case 'rain': return 63;
        case 'snow': return 73;
        case 'sleet': return 61;
        case 'wind': return 2;
        case 'thunderstorm': return 95;
        default: return 2;
    }
}
