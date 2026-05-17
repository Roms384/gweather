'use strict';

const { Adw, Gtk, Gio, GLib, Soup } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;

function init() {
    // Nothing to do here
}

function fillPreferencesWindow(window) {
    const settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.gweather');

    // Window setup
    window.set_default_size(500, 600);
    window.search_enabled = false;

    // ── Page ──────────────────────────────────────────────────────
    const page = new Adw.PreferencesPage({
        title: 'Location',
        icon_name: 'find-location-symbolic',
    });
    window.add(page);

    // ── Current Location Group ───────────────────────────────────
    const currentGroup = new Adw.PreferencesGroup({
        title: 'Current Location',
        description: 'The location used for weather forecasts',
    });
    page.add(currentGroup);

    const currentRow = new Adw.ActionRow({
        title: settings.get_string('location-name') || 'London',
        subtitle: _formatCoords(settings.get_double('latitude'), settings.get_double('longitude')),
    });
    currentRow.add_prefix(new Gtk.Image({
        icon_name: 'weather-few-clouds-symbolic',
        pixel_size: 24,
    }));
    currentGroup.add(currentRow);

    // Keep the display row in sync with settings changes
    settings.connect('changed::location-name', () => {
        currentRow.set_title(settings.get_string('location-name'));
    });
    settings.connect('changed::latitude', () => {
        currentRow.set_subtitle(_formatCoords(settings.get_double('latitude'), settings.get_double('longitude')));
    });
    settings.connect('changed::longitude', () => {
        currentRow.set_subtitle(_formatCoords(settings.get_double('latitude'), settings.get_double('longitude')));
    });

    // ── Search Group ─────────────────────────────────────────────
    const searchGroup = new Adw.PreferencesGroup({
        title: 'Search Location',
        description: 'Type a city name and press Enter or click Search',
    });
    page.add(searchGroup);

    // Search entry row
    const searchEntry = new Gtk.Entry({
        placeholder_text: 'e.g. Paris, Tokyo, New York…',
        hexpand: true,
        valign: Gtk.Align.CENTER,
    });

    const searchButton = new Gtk.Button({
        icon_name: 'system-search-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['suggested-action'],
    });

    const searchBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        margin_start: 12,
        margin_end: 12,
        margin_top: 8,
        margin_bottom: 8,
    });
    searchBox.append(searchEntry);
    searchBox.append(searchButton);

    searchGroup.add(searchBox);

    // ── Results Group ────────────────────────────────────────────
    const resultsGroup = new Adw.PreferencesGroup({
        title: 'Results',
    });
    page.add(resultsGroup);

    // Spinner for loading state
    const spinner = new Gtk.Spinner({
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        margin_top: 12,
        margin_bottom: 12,
    });

    const statusRow = new Adw.ActionRow({
        title: 'Search for a location above',
        subtitle: 'Results will appear here',
    });
    statusRow.add_prefix(new Gtk.Image({
        icon_name: 'dialog-information-symbolic',
        pixel_size: 20,
    }));
    resultsGroup.add(statusRow);

    // ── HTTP Session ─────────────────────────────────────────────
    const httpSession = new Soup.Session();
    const isSoup3 = Soup.get_major_version?.() === 3 || httpSession.send_and_read_async;

    // ── Search Logic ─────────────────────────────────────────────
    let resultRows = [];

    function clearResults() {
        for (const row of resultRows) {
            resultsGroup.remove(row);
        }
        resultRows = [];
    }

    function doSearch() {
        const query = searchEntry.get_text().trim();
        if (query.length < 2) {
            statusRow.set_title('Please enter at least 2 characters');
            statusRow.set_subtitle('');
            statusRow.show();
            return;
        }

        clearResults();
        statusRow.set_title('Searching…');
        statusRow.set_subtitle('');
        statusRow.show();

        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=en&format=json`;

        if (isSoup3) {
            _searchSoup3(httpSession, url, resultsGroup, statusRow, resultRows, settings, currentRow);
        } else {
            _searchSoup2(httpSession, url, resultsGroup, statusRow, resultRows, settings, currentRow);
        }
    }

    searchButton.connect('clicked', doSearch);
    searchEntry.connect('activate', doSearch);
}

// ── Helpers ──────────────────────────────────────────────────────

function _formatCoords(lat, lon) {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}

function _buildResultRow(item) {
    const parts = [item.name];
    if (item.admin1) parts.push(item.admin1);
    if (item.country) parts.push(item.country);
    const subtitle = `${_formatCoords(item.latitude, item.longitude)}` +
        (item.population ? `  •  Pop. ${item.population.toLocaleString()}` : '');

    const row = new Adw.ActionRow({
        title: parts.join(', '),
        subtitle: subtitle,
        activatable: true,
    });

    row.add_prefix(new Gtk.Image({
        icon_name: 'mark-location-symbolic',
        pixel_size: 20,
    }));

    row.add_suffix(new Gtk.Image({
        icon_name: 'go-next-symbolic',
        pixel_size: 16,
    }));

    return row;
}

function _handleResults(jsonStr, resultsGroup, statusRow, resultRows, settings, currentRow) {
    try {
        const data = JSON.parse(jsonStr);
        if (!data.results || data.results.length === 0) {
            statusRow.set_title('No locations found');
            statusRow.set_subtitle('Try a different search term');
            statusRow.show();
            return;
        }

        statusRow.hide();

        for (const item of data.results) {
            const row = _buildResultRow(item);

            row.connect('activated', () => {
                settings.set_string('location-name', item.name + (item.country ? `, ${item.country}` : ''));
                settings.set_double('latitude', item.latitude);
                settings.set_double('longitude', item.longitude);

                currentRow.set_title(settings.get_string('location-name'));
                currentRow.set_subtitle(_formatCoords(item.latitude, item.longitude));

                // Flash the row to show it was selected
                row.add_css_class('success');
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
                    row.remove_css_class('success');
                    return GLib.SOURCE_REMOVE;
                });
            });

            resultsGroup.add(row);
            resultRows.push(row);
        }
    } catch (e) {
        statusRow.set_title('Error parsing results');
        statusRow.set_subtitle(e.message);
        statusRow.show();
        log(`GWeather Prefs: Parse error: ${e.message}`);
    }
}

function _searchSoup3(httpSession, url, resultsGroup, statusRow, resultRows, settings, currentRow) {
    const message = Soup.Message.new('GET', url);
    httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
        try {
            const bytes = session.send_and_read_finish(result);
            const decoder = new TextDecoder('utf-8');
            const jsonStr = decoder.decode(bytes.get_data());
            _handleResults(jsonStr, resultsGroup, statusRow, resultRows, settings, currentRow);
        } catch (e) {
            statusRow.set_title('Network error');
            statusRow.set_subtitle(e.message);
            statusRow.show();
            log(`GWeather Prefs: Soup3 error: ${e.message}`);
        }
    });
}

function _searchSoup2(httpSession, url, resultsGroup, statusRow, resultRows, settings, currentRow) {
    const message = Soup.Message.new('GET', url);
    httpSession.queue_message(message, (session, msg) => {
        if (msg.status_code !== 200) {
            statusRow.set_title('Network error');
            statusRow.set_subtitle(`Status: ${msg.status_code}`);
            statusRow.show();
            return;
        }
        _handleResults(msg.response_body.data, resultsGroup, statusRow, resultRows, settings, currentRow);
    });
}
