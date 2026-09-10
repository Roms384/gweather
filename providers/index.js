'use strict';

let Me;
try {
    const ExtensionUtils = imports.misc.extensionUtils;
    Me = ExtensionUtils.getCurrentExtension();
} catch (e) {
    Me = { imports: imports };
}

const { OpenMeteoProvider } = Me.imports.providers.openMeteo;
const { MetNoProvider } = Me.imports.providers.metNo;
const { WeatherApiProvider } = Me.imports.providers.weatherApi;
const { OpenWeatherMapProvider } = Me.imports.providers.openWeatherMap;
const { PirateWeatherProvider } = Me.imports.providers.pirateWeather;

var PROVIDERS_META = [
    {
        id: 'open-meteo',
        name: 'Open-Meteo',
        description: 'Free open-source weather API (no API key needed)',
        requiresKey: false,
    },
    {
        id: 'met-no',
        name: 'MET Norway',
        description: 'Norwegian Meteorological Institute (no API key needed)',
        requiresKey: false,
    },
    {
        id: 'weatherapi',
        name: 'WeatherAPI.com',
        description: 'Worldwide weather data (free API key required)',
        requiresKey: true,
        keySetting: 'api-key-weatherapi',
        keyUrl: 'https://www.weatherapi.com/signup.aspx',
    },
    {
        id: 'openweathermap',
        name: 'OpenWeatherMap',
        description: 'Popular weather platform (free API key required)',
        requiresKey: true,
        keySetting: 'api-key-openweathermap',
        keyUrl: 'https://home.openweathermap.org/users/sign_up',
    },
    {
        id: 'pirateweather',
        name: 'Pirate Weather',
        description: 'Dark Sky compatible API (free API key required)',
        requiresKey: true,
        keySetting: 'api-key-pirateweather',
        keyUrl: 'https://pirateweather.net/en/latest/API/',
    },
];

function createProvider(providerId, settings) {
    switch (providerId) {
        case 'met-no':
            return new MetNoProvider(settings);
        case 'weatherapi':
            return new WeatherApiProvider(settings);
        case 'openweathermap':
            return new OpenWeatherMapProvider(settings);
        case 'pirateweather':
            return new PirateWeatherProvider(settings);
        case 'open-meteo':
        default:
            return new OpenMeteoProvider(settings);
    }
}

function getWeatherProvider(settings) {
    const providerId = settings.get_string('weather-provider') || 'open-meteo';
    return createProvider(providerId, settings);
}
