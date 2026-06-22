const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = 3000;

const API_KEY = process.env.API_KEY;

// Allow frontend files
app.use(express.static("."));

// WMO weather code -> OpenWeatherMap-style icon id + main name.
// Lets us reuse the existing `getWeatherIcon` mapping in script.js without
// touching the frontend's icon assets.
function wmoToOwm(code) {
    if (code === 0) return { id: 800, main: "Clear" };
    if (code === 1) return { id: 801, main: "Clouds" };
    if (code === 2) return { id: 802, main: "Clouds" };
    if (code === 3) return { id: 804, main: "Clouds" };
    if (code === 45 || code === 48) return { id: 701, main: "Atmosphere" };
    if (code >= 51 && code <= 57) return { id: 300, main: "Drizzle" };
    if (code >= 61 && code <= 65) return { id: 500, main: "Rain" };
    if (code === 66 || code === 67) return { id: 511, main: "Rain" };
    if (code >= 71 && code <= 77) return { id: 600, main: "Snow" };
    if (code >= 80 && code <= 82) return { id: 500, main: "Rain" };
    if (code >= 85 && code <= 86) return { id: 600, main: "Snow" };
    if (code >= 95 && code <= 99) return { id: 200, main: "Thunderstorm" };
    return { id: 800, main: "Clear" };
}

// Open-Meteo's `daily` arrays -> array of entries shaped like the OpenWeatherMap
// legacy daily endpoint so the existing frontend code can render them directly.
function mapOpenMeteoDaily(omDaily) {
    if (!omDaily || !Array.isArray(omDaily.time)) return null;
    const out = [];
    for (let i = 0; i < omDaily.time.length; i++) {
        const iso = omDaily.time[i];
        // Parse the local-date ISO at noon UTC so the date doesn't drift across
        // timezones in the front-end `toLocaleDateString` formatter.
        const dt = Math.floor(new Date(iso + "T12:00:00Z").getTime() / 1000);
        const max = Number(omDaily.temperature_2m_max?.[i] ?? 0);
        const min = Number(omDaily.temperature_2m_min?.[i] ?? 0);
        const code = Number(omDaily.weathercode?.[i] ?? 0);
        const { id, main } = wmoToOwm(code);
        out.push({
            dt,
            // Ship the raw ISO local-date so the client can label the weekday
            // without re-localizing (avoids a +1 day shift for users in
            // UTC+12+ timezones when they query any city).
            isoDate: iso,
            temp: {
                max,
                min,
                day: (max + min) / 2,
                night: min,
            },
            weather: [{ id, main }],
        });
    }
    return out;
}

// Look up a city's state/region through OpenWeatherMap's geocoding API.
// Returns a trimmed string (or "" if unavailable) — best-effort only; failures
// here are silent because the secondary line in the UI gracefully degrades
// from "State, Country" to just "Country" when we have no state.
async function lookupRegion(cityQuery) {
    if (!API_KEY) return "";
    try {
        const query = String(cityQuery ?? "").trim();
        if (!query) return "";
        const geoRes = await fetch(
            `https://api.openweathermap.org/geo/1.0/direct` +
            `?q=${encodeURIComponent(query)}` +
            `&limit=5` +
            `&appid=${API_KEY}`
        );
        const data = await geoRes.json();
        if (!Array.isArray(data) || data.length === 0) return "";

        // For bare-name queries (e.g. "Rupnagar") OWM may return several matches
        // across countries/states. Prefer the entry whose name exactly matches
        // the leading token of the query, so we don't accidentally pick a
        // different state's result over the canonical one.
        const norm = (s) => String(s ?? "").toLowerCase().trim();
        const target = norm(query.split(",")[0]);
        const exact = data.find((g) => norm(g.name) === target);
        const picked = exact || data[0];
        return picked.state || "";
    } catch (_) {
        return "";
    }
}

// Weather endpoint
app.get("/weather", async (req, res) => {
    const city = req.query.city;

    if (!city) {
        return res.status(400).json({ cod: "400", message: "City is required" });
    }

    if (!API_KEY) {
        return res.status(500).json({ cod: "500", message: "API key is missing" });
    }

    const weatherUrl =
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric`;

    const forecastUrl =
        `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric`;

    try {
        const [weatherRes, forecastRes, stateName] = await Promise.all([
            fetch(weatherUrl),
            fetch(forecastUrl),
            lookupRegion(city)
        ]);

        const weather = await weatherRes.json();
        const forecast = await forecastRes.json();

        if (weather.cod != 200) {
            return res.status(weatherRes.status || 404).json(weather);
        }

        // 10-day forecast pipeline:
        //   1. Open-Meteo (no key, free for non-commercial use, up to 16 days) —
        //      primary source because OpenWeatherMap's `forecast/daily?cnt=10`
        //      and One Call 3.0 require paid plans on free API keys.
        //   2. (frontend fallback) collapse the OpenWeatherMap 5-day / 3-hour
        //      forecast into ~5 day buckets in renderForecast.
        const { coord: { lat, lon } } = weather;
        let forecastDaily = null;
        try {
            const omUrl =
                `https://api.open-meteo.com/v1/forecast` +
                `?latitude=${lat}&longitude=${lon}` +
                `&daily=weathercode,temperature_2m_max,temperature_2m_min` +
                `&timezone=auto` +
                `&forecast_days=10`;
            const omRes = await fetch(omUrl);
            if (omRes.ok) {
                const omData = await omRes.json();
                forecastDaily = mapOpenMeteoDaily(omData.daily);
            }
        } catch (_) {
            // Open-Meteo is optional — the frontend will fall back to the
            // 5-day / 3-hour forecast if this doesn't resolve.
        }

        res.json({ weather, forecast, forecastDaily, region: { state: stateName } });

    } catch (error) {
        res.status(500).json({ error: "Something went wrong" });
    }
});

// Geocoding endpoint used by the autocomplete dropdown. Wraps OpenWeatherMap's
// free-text geocoding API so the caller gets up to `limit` matching places
// for a given query string. Returns an empty array on missing/short queries
// so the front-end can treat it as "no suggestions" without special-casing.
app.get("/geo", async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 10);

    if (q.length < 2) {
        return res.json([]);
    }
    if (!API_KEY) {
        return res.status(500).json({ cod: "500", message: "API key is missing" });
    }

    const geoUrl =
        `https://api.openweathermap.org/geo/1.0/direct` +
        `?q=${encodeURIComponent(q)}` +
        `&limit=${limit}` +
        `&appid=${API_KEY}`;

    try {
        const response = await fetch(geoUrl);
        const data = await response.json();
        if (!Array.isArray(data)) {
            return res.json([]);
        }
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Geocoding failed" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});