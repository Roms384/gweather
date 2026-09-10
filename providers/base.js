'use strict';

const { Soup, GLib } = imports.gi;

/**
 * Base abstract class for weather providers.
 */
var BaseWeatherProvider = class BaseWeatherProvider {
    constructor(settings) {
        this._settings = settings;
        this._httpSession = new Soup.Session();
        this._isSoup3 = Soup.get_major_version?.() === 3 || Boolean(this._httpSession.send_and_read_async);
    }

    get name() {
        return 'BaseProvider';
    }

    /**
     * Common HTTP JSON fetcher supporting Soup 3 and Soup 2.
     * @param {string} url
     * @param {Object.<string, string>} [customHeaders]
     * @returns {Promise<Object>}
     */
    async fetchJson(url, customHeaders = null) {
        log(`GWeather [${this.name}]: Fetching from ${url}`);

        if (this._isSoup3) {
            const message = Soup.Message.new('GET', url);
            if (customHeaders) {
                // .request_headers property (Soup 3.0 compat; get_request_headers() is Soup 3.4+)
                for (const [key, val] of Object.entries(customHeaders)) {
                    message.request_headers.append(key, val);
                }
            }

            try {
                const bytes = await this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
                // Use .status_code property (compatible with Soup 3.0 on GNOME 42;
                // get_status() only exists in Soup 3.4+)
                const statusCode = message.status_code;
                if (statusCode < 200 || statusCode >= 300) {
                    throw new Error(`HTTP ${statusCode} ${message.reason_phrase || ''}`);
                }
                const decoder = new TextDecoder('utf-8');
                return JSON.parse(decoder.decode(bytes.get_data()));
            } catch (e) {
                log(`GWeather [${this.name}] Soup 3 Error: ${e.message}`);
                throw e;
            }
        } else {
            const message = Soup.Message.new('GET', url);
            if (customHeaders) {
                for (const [key, val] of Object.entries(customHeaders)) {
                    message.request_headers.append(key, val);
                }
            }

            return new Promise((resolve, reject) => {
                this._httpSession.queue_message(message, (session, msg) => {
                    if (msg.status_code < 200 || msg.status_code >= 300) {
                        log(`GWeather [${this.name}] Soup 2 Error: Status ${msg.status_code} - ${msg.reason_phrase}`);
                        reject(new Error(`HTTP ${msg.status_code}: ${msg.reason_phrase}`));
                        return;
                    }
                    try {
                        const data = JSON.parse(msg.response_body.data);
                        resolve(data);
                    } catch (e) {
                        log(`GWeather [${this.name}] Soup 2 Parse Error: ${e.message}`);
                        reject(e);
                    }
                });
            });
        }
    }

    /**
     * Calculates the most frequent weather code in an array.
     */
    computeDominantWeatherCode(codes, defaultCode = 0) {
        if (!codes || codes.length === 0) return defaultCode;
        const counts = {};
        for (const c of codes) {
            counts[c] = (counts[c] || 0) + 1;
        }
        let bestCode = codes[0];
        let maxCount = 0;
        for (const [codeStr, count] of Object.entries(counts)) {
            if (count > maxCount) {
                maxCount = count;
                bestCode = parseInt(codeStr, 10);
            }
        }
        return bestCode;
    }

    /**
     * Subclasses must implement this.
     * @param {number} lat
     * @param {number} lon
     * @returns {Promise<NormalizedWeatherData>}
     */
    async getForecast(lat, lon) {
        throw new Error('getForecast must be implemented by subclass');
    }
};
