const cityInput = document.querySelector('.city-input')
const searchBtn = document.querySelector('.search-btn')

const weatherInfoSection = document.querySelector('.weather-info')
const notFoundSection = document.querySelector('.not-found')
const searchCitySection = document.querySelector('.search-city')

const countryTxt = document.querySelector('.country-txt')
const tempTxt = document.querySelector('.temp-txt')
const conditionTxt = document.querySelector('.condition-txt')
const humidityValueTxt = document.querySelector('.humidity-value-txt')
const windValueTxt = document.querySelector('.wind-value-txt')
const weatherSummaryImg = document.querySelector('.weather-summary-img')
const currentDateTxt = document.querySelector('.current-date-txt')

const forecastItemsContainer = document.querySelector('.forecast-items-container')

const suggestionsList = document.querySelector('.suggestions-list')
const countryNameEl = document.querySelector('.country-name')

const homeBtn = document.querySelector('.home-btn')
const forecastToggleBtn = document.querySelector('.forecast-toggle-btn')
const mainContainerEl = document.querySelector('.main-container')

// --- Autocomplete state ---
let activeSuggestionIndex = -1
let currentSuggestions = []
let abortController = null
let debounceId = null
let lastFetchedQuery = ''

// Resolve a country code to a readable country name. Falls back to the raw
// code if the browser's Intl.DisplayNames doesn't know about the code.
function getCountryName(code) {
    if (!code) return ''
    try {
        return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code
    } catch {
        return code
    }
}

searchBtn.addEventListener('click', () => {
    if (cityInput.value.trim() != '') {
        updateWeatherInfo(cityInput.value)
        cityInput.value = ''
        cityInput.blur()
        hideSuggestions()
    }
})

cityInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
        if (currentSuggestions.length > 0) {
            event.preventDefault()
            const next = activeSuggestionIndex < currentSuggestions.length - 1
                ? activeSuggestionIndex + 1
                : 0
            setActiveSuggestion(next)
        }
    } else if (event.key === 'ArrowUp') {
        if (currentSuggestions.length > 0) {
            event.preventDefault()
            const next = activeSuggestionIndex > 0
                ? activeSuggestionIndex - 1
                : currentSuggestions.length - 1
            setActiveSuggestion(next)
        }
    } else if (event.key === 'Enter') {
        if (activeSuggestionIndex >= 0 && currentSuggestions[activeSuggestionIndex]) {
            event.preventDefault()
            selectSuggestion(activeSuggestionIndex)
        } else if (cityInput.value.trim() != '') {
            event.preventDefault()
            updateWeatherInfo(cityInput.value)
            cityInput.value = ''
            cityInput.blur()
            hideSuggestions()
        }
    } else if (event.key === 'Escape') {
        if (!suggestionsList.hidden) {
            hideSuggestions()
            event.preventDefault()
        }
    } else if (event.key === 'Tab') {
        hideSuggestions()
    }
})

cityInput.addEventListener('input', () => {
    clearTimeout(debounceId)
    const query = cityInput.value.trim()
    if (query.length < 2) {
        currentSuggestions = []
        if (abortController) abortController.abort()
        hideSuggestions()
        return
    }
    debounceId = setTimeout(() => fetchSuggestions(query), 220)
})

cityInput.addEventListener('focus', () => {
    if (currentSuggestions.length > 0 && lastFetchedQuery) {
        renderSuggestions(lastFetchedQuery)
    }
})

// Close dropdown when clicking outside the input + the dropdown.
document.addEventListener('mousedown', (e) => {
    if (!suggestionsList.contains(e.target) && e.target !== cityInput) {
        hideSuggestions()
    }
})

function showSuggestions() {
    suggestionsList.hidden = false
    cityInput.setAttribute('aria-expanded', 'true')
}

function hideSuggestions() {
    suggestionsList.hidden = true
    activeSuggestionIndex = -1
    cityInput.setAttribute('aria-expanded', 'false')
    cityInput.removeAttribute('aria-activedescendant')
    suggestionsList.querySelectorAll('.suggestion-item').forEach((el) => {
        el.classList.remove('active')
        el.setAttribute('aria-selected', 'false')
    })
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]))
}

function highlightMatch(text, query) {
    if (!query) return escapeHtml(text)
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return escapeHtml(text)
    return escapeHtml(text.slice(0, idx)) +
        '<mark>' + escapeHtml(text.slice(idx, idx + query.length)) + '</mark>' +
        escapeHtml(text.slice(idx + query.length))
}

function renderSuggestions(query) {
    if (currentSuggestions.length === 0) {
        hideSuggestions()
        return
    }
    suggestionsList.innerHTML = ''
    currentSuggestions.forEach((sugg, idx) => {
        const li = document.createElement('li')
        li.className = 'suggestion-item'
        li.setAttribute('role', 'option')
        li.setAttribute('id', `suggestion-${idx}`)
        li.setAttribute('aria-selected', 'false')
        li.dataset.index = String(idx)

        const nameEl = document.createElement('span')
        nameEl.className = 'suggestion-name'
        nameEl.innerHTML = highlightMatch(sugg.name, query)
        li.appendChild(nameEl)

        const regionEl = document.createElement('span')
        regionEl.className = 'suggestion-region'
        const state = sugg.state ? `${sugg.state}, ` : ''
        regionEl.textContent = `${state}${getCountryName(sugg.country) || sugg.country}`
        li.appendChild(regionEl)

        // Use mousedown (not click) so the input doesn't blur before we read
        // the selection — input blur would race with the click handler.
        li.addEventListener('mousedown', (e) => {
            e.preventDefault()
            selectSuggestion(idx)
        })
        li.addEventListener('mouseenter', () => setActiveSuggestion(idx))

        suggestionsList.appendChild(li)
    })
    showSuggestions()
}

function setActiveSuggestion(idx) {
    suggestionsList.querySelectorAll('.suggestion-item').forEach((item, i) => {
        const isActive = i === idx
        item.classList.toggle('active', isActive)
        item.setAttribute('aria-selected', String(isActive))
    })
    activeSuggestionIndex = idx
    const active = suggestionsList.querySelector('.suggestion-item.active')
    if (active) active.scrollIntoView({ block: 'nearest' })
    cityInput.setAttribute('aria-activedescendant', idx >= 0 ? `suggestion-${idx}` : '')
}

async function fetchSuggestions(query) {
    if (abortController) abortController.abort()
    const ctl = new AbortController()
    abortController = ctl
    try {
        const res = await fetch(
            `http://localhost:3000/geo?q=${encodeURIComponent(query)}&limit=5`,
            { signal: ctl.signal }
        )
        const data = await res.json()
        if (ctl.signal.aborted) return
        currentSuggestions = Array.isArray(data) ? data : []
        lastFetchedQuery = query
        activeSuggestionIndex = -1
        renderSuggestions(query)
    } catch (err) {
        if (err.name === 'AbortError') return
        currentSuggestions = []
        hideSuggestions()
    }
}

function selectSuggestion(idx) {
    const sugg = currentSuggestions[idx]
    if (!sugg) return
    // OpenWeatherMap accepts "Name, countryCode" and resolves disambiguates
    // when multiple places share a name (e.g. "Malton, CA" vs "Malton, GB").
    const searchString = `${sugg.name}, ${sugg.country}`
    cityInput.value = searchString
    hideSuggestions()
    cityInput.blur()
    // Pass the state we already fetched via /geo straight through to the
    // weather handler so we don't have to depend on the server's secondary
    // region lookup succeeding (the dropdown's geocode result is the
    // authoritative source).
    updateWeatherInfo(searchString, sugg.state)
    cityInput.value = ''
}

async function getFetchData(city) {
    const apiUrl = `http://localhost:3000/weather?city=${encodeURIComponent(city)}`
    const response = await fetch(apiUrl)
    return response.json()
}

// Evening/night helper. Returns true if "now" falls inside either the
// golden-hour/twilight window or the post-evening pre-sunrise window.
// One source of truth so the icon and the background stay in lock-step.
function isEveningOrNight(sunrise, sunset) {
    if (!(sunrise > 0 && sunset > 0)) return false
    const HOUR = 3600
    const now = Math.floor(Date.now() / 1000)
    // "Evening" = 30 min before sunset through 2 hr after sunset.
    const eveningStart = sunset - 0.5 * HOUR
    const eveningEnd = sunset + 2 * HOUR
    if (now >= eveningStart && now < eveningEnd) return true
    // "Night" = after evening through sunrise + 30 min (pre-dawn dim light).
    const morningEnd = sunrise + 0.5 * HOUR
    if (now >= eveningEnd || now < morningEnd) return true
    return false
}

// Pick the SVG icon for a given OpenWeatherMap condition id. When
// `isEveningOrNight` is true and the weather isn't actively wet
// (rain/drizzle/thunderstorm), fall back to the night icon — the
// time-of-day mood reads stronger than the weather detail at night.
function getWeatherIcon(id, isEveNight = false) {
    if (isEveNight) {
        // Rain and thunderstorm stay prominent at night — they're the
        // dominant story even on a dark sky. Everything else becomes the
        // night icon.
        if (id <= 232) return 'thunderstorm.svg'
        if (id <= 321) return 'drizzle.svg'
        if (id <= 531) return 'rain.svg'
        return 'night.svg'
    }
    // Daytime: existing mapping unchanged.
    if (id <= 232) return 'thunderstorm.svg'
    if (id <= 321) return 'drizzle.svg'
    if (id <= 531) return 'rain.svg'
    if (id <= 622) return 'snow.svg'
    if (id <= 781) return 'atmosphere.svg'
    if (id <= 800) return 'clear.svg'
    else return 'clouds.svg'
}

// Map the current weather (and time of day) to one of the new background
// jpgs in assets/weather/. Time-of-day takes priority so the card reads
// consistently as "night" or "evening" even if it's actively raining —
// visually, a rainy night and a starry night share the same dark mood.
function getWeatherBackground(id, sunrise, sunset) {
    const HOUR = 3600
    const now = Math.floor(Date.now() / 1000)

    // Only consult sunrise/sunset when both look like real Unix timestamps.
    if (sunrise > 0 && sunset > 0) {
        // "Evening" covers the golden-hour window: from 30 min before sunset
        // (the warm-light stretch) through the first 2 hours after sunset
        // (twilight), before the sky fully darkens into night.
        const eveningStart = sunset - 0.5 * HOUR
        const eveningEnd = sunset + 2 * HOUR
        if (now >= eveningStart && now < eveningEnd) return 'evening.jpg'
        // "Night" runs from end-of-evening through sunrise — and a few
        // minutes past sunrise so we keep the dark card into the pre-dawn
        // dim light instead of flipping too early.
        const morningEnd = sunrise + 0.5 * HOUR
        if (now >= eveningEnd || now < morningEnd) return 'night.jpg'
    }

    // Daytime: pick by OpenWeatherMap condition id. Note: OWM condition IDs
    // jump straight from 781 (Tornado) to 800 (Clear) — there is no code in
    // 782-799, so the `<= 800` branch only ever fires for id === 800.
    if (id <= 232) return 'thunderstorm.jpg'
    if (id <= 321) return 'drizzle.jpg'
    if (id <= 531) return 'rain.jpg'
    if (id <= 622) return 'snow.jpg'
    if (id <= 781) return 'atmosphere.jpg'
    if (id <= 800) return 'sunny.jpg'   // id 800 = clear sky → sunny
    // 801-804 (cloud variants). assets/weather has no clouds.jpg, so the
    // closest neutral is clear.jpg — see README/asset list for context.
    if (id <= 804) return 'clear.jpg'
    return 'clear.jpg'
}

// Apply the weather background to the card. Layers a dimming gradient
// over the chosen jpg so white text stays readable on bright skies
// (snow / sunny) without crushing the image's colors on darker ones.
function applyWeatherBackground(weatherData) {
    if (!mainContainerEl) return
    const id = weatherData?.weather?.[0]?.id ?? 800
    const sunrise = Number(weatherData?.sys?.sunrise) || 0
    const sunset = Number(weatherData?.sys?.sunset) || 0
    const bgFile = getWeatherBackground(id, sunrise, sunset)
    // Heavier top stop so the city/date row stays readable on sunny.jpg
    // and snow.jpg, while the bottom can darken more aggressively to
    // anchor the temperature block.
    const overlay = 'linear-gradient(to top, rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0.45))'
    mainContainerEl.style.backgroundImage = `${overlay}, url('assets/weather/${bgFile}')`
    mainContainerEl.style.backgroundSize = 'cover'
    mainContainerEl.style.backgroundPosition = 'center'
    mainContainerEl.style.backgroundRepeat = 'no-repeat'
}

function clearWeatherBackground() {
    if (!mainContainerEl) return
    mainContainerEl.style.backgroundImage = ''
    mainContainerEl.style.backgroundSize = ''
    mainContainerEl.style.backgroundPosition = ''
    mainContainerEl.style.backgroundRepeat = ''
}

function getCurrentDate() {
    // Format: "June 21, 5:35 PM" — Google's weather UI style
    const now = new Date()
    const month = now.toLocaleDateString('en-US', { month: 'long' })
    const day = now.getDate()
    let hours = now.getHours()
    const minutes = now.getMinutes().toString().padStart(2, '0')
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12 || 12
    return `${month} ${day}, ${hours}:${minutes} ${ampm}`
}

function getShortDay(entry, index) {
    // First forecast card = today
    if (index === 0) return 'Today'
    // Prefer the ISO local-date from the server so the weekday label matches
    // the forecast's own calendar day, regardless of the user's timezone.
    // (Formatting it in UTC avoids a +1 day shift for users in UTC+12+.)
    if (entry.isoDate) {
        return new Date(entry.isoDate + 'T12:00:00Z').toLocaleDateString('en-US', {
            weekday: 'short',
            timeZone: 'UTC'
        })
    }
    return new Date(entry.dt * 1000).toLocaleDateString('en-US', { weekday: 'short' })
}

// Target number of forecast cards to display.
const FORECAST_DAYS = 10

/**
 * Fallback: collapse the 5-day / 3-hour forecast into one bucket per
 * local day so we still get something meaningful if the daily endpoint
 * is unavailable (different API key tier).
 */
function collapseForecastList(forecastList) {
    if (!Array.isArray(forecastList)) return []
    const buckets = new Map()
    for (const entry of forecastList) {
        const localDate = new Date(entry.dt * 1000)
        const key = localDate.toLocaleDateString('en-CA') // YYYY-MM-DD
        if (!buckets.has(key)) {
            buckets.set(key, {
                dt: entry.dt,
                temps: [],
                icons: [],
                descs: []
            })
        }
        const bucket = buckets.get(key)
        bucket.temps.push(entry.main.temp)
        bucket.icons.push(entry.weather[0]?.id ?? 800)
        bucket.descs.push(entry.weather[0]?.main ?? '')
    }
    // Only collapse into days that actually have 3-hour buckets — no padding.
    return [...buckets.values()].slice(0, FORECAST_DAYS).map((b) => {
        const max = Math.max(...b.temps)
        const min = Math.min(...b.temps)
        // Pick the icon closest to local noon for a representative daytime icon
        const noonIndex = Math.min(Math.floor(b.icons.length / 2), b.icons.length - 1)
        return {
            dt: b.dt,
            temp: { max, min, day: Math.round((max + min) / 2), night: min },
            weather: [{ id: b.icons[noonIndex], main: b.descs[noonIndex] }]
        }
    })
}

function renderForecast(data) {
    forecastItemsContainer.innerHTML = ''

    // Daily source preference:
    //   1. server-provided `forecastDaily` (Open-Meteo, 10 days)
    //   2. collapse the OpenWeatherMap 5-day / 3-hour forecast (~5 days)
    const dailyEntries = Array.isArray(data?.forecastDaily) && data.forecastDaily.length > 0
        ? data.forecastDaily.slice(0, FORECAST_DAYS)
        : collapseForecastList(data?.forecast?.list)

    if (dailyEntries.length === 0) return

    const header = document.querySelector('.forecast-header h4')
    if (header) {
        header.textContent =
            dailyEntries.length === FORECAST_DAYS
                ? `${FORECAST_DAYS}-Day Forecast`
                : `${dailyEntries.length}-Day Forecast`
    }

    // Reset the visual state through the canonical helper so there's one
    // source of truth for the toggle.
    if (forecastToggleBtn) {
        forecastToggleBtn.setAttribute('aria-expanded', 'true')
    }
    setForecastVisible(true)

    dailyEntries.forEach((entry, index) => {
        const id = entry.weather?.[0]?.id ?? 800
        const condition = entry.weather?.[0]?.main ?? ''
        const dayTemp = Math.round(entry.temp?.day ?? entry.temp?.max ?? 0)
        const nightTemp = Math.round(entry.temp?.night ?? entry.temp?.min ?? 0)

        const item = document.createElement('div')
        item.className = 'forecast-item'

        const dateEl = document.createElement('h5')
        dateEl.className = 'forecast-item-date regular-txt'
        if (index === 0) dateEl.classList.add('bold')
        dateEl.textContent = getShortDay(entry, index)
        item.appendChild(dateEl)

        const imgEl = document.createElement('img')
        imgEl.src = `assets/weather/${getWeatherIcon(id)}`
        imgEl.className = 'forecast-item-img'
        imgEl.alt = condition
        item.appendChild(imgEl)

        const descEl = document.createElement('h5')
        descEl.className = 'forecast-item-desc regular-txt'
        descEl.textContent = condition
        descEl.title = condition
        item.appendChild(descEl)

        const tempsEl = document.createElement('div')
        tempsEl.className = 'forecast-item-temps'

        const highEl = document.createElement('span')
        highEl.className = 'forecast-item-temp-high'
        highEl.textContent = `${dayTemp}°`
        tempsEl.appendChild(highEl)

        const lowEl = document.createElement('span')
        lowEl.className = 'forecast-item-temp-low'
        lowEl.textContent = `${nightTemp}°`
        tempsEl.appendChild(lowEl)

        item.appendChild(tempsEl)
        forecastItemsContainer.appendChild(item)
    })
}

async function updateWeatherInfo(city, stateFromSelection) {
    const data = await getFetchData(city)

    if (!data?.weather || data.weather.cod != 200) {
        showDisplaySection(notFoundSection)
        return
    }

    const weatherData = data.weather
    const {
        name: country,
        main: { temp, humidity, temp_min, temp_max },
        weather: [{ id, main }],
        wind: { speed }
    } = weatherData

    countryTxt.textContent = country
    // Build the secondary line as "State, Country" when a state is available.
    // Priority order:
    //   1. `stateFromSelection` — passed in from the dropdown, where the
    //      /geo response already gave us the canonical state.
    //   2. `data.region.state` — the server's enrichment fallback for
    //      free-text searches (best-effort, may be empty).
    //   3. just the country name if neither is present (e.g. Singapore).
    const countryName = getCountryName(weatherData?.sys?.country || '')
    const stateName = (stateFromSelection || data?.region?.state || '').trim()
    const regionText = stateName ? `${stateName}, ${countryName}` : countryName
    if (countryNameEl) countryNameEl.textContent = regionText
    tempTxt.textContent = Math.round(temp) + ' °C'
    conditionTxt.textContent = main
    humidityValueTxt.textContent = humidity + '%'
    windValueTxt.textContent = speed + ' M/s'

    currentDateTxt.textContent = getCurrentDate()

    // Compute time-of-day once so the icon and the background pick the
    // same evening/night mood consistently.
    const sunrise = Number(weatherData?.sys?.sunrise) || 0
    const sunset = Number(weatherData?.sys?.sunset) || 0
    const eveNight = isEveningOrNight(sunrise, sunset)
    weatherSummaryImg.src = `assets/weather/${getWeatherIcon(id, eveNight)}`

    // Swap the card's background to the weather/time-of-day jpg.
    applyWeatherBackground(weatherData)

    // Compose the day's high / low (Google-style day/night pill).
    // Fall back to the first forecastDaily entry if the current-weather
    // response didn't supply temp_min/temp_max.
    const todayFallback = Array.isArray(data?.forecastDaily) ? data.forecastDaily[0] : null
    let dayHigh = Math.round(Number.isFinite(temp_max) ? temp_max : (todayFallback?.temp?.max ?? 0))
    let nightLow = Math.round(Number.isFinite(temp_min) ? temp_min : (todayFallback?.temp?.min ?? 0))
    document.querySelector('.temp-day-txt').textContent = `${dayHigh}°`
    document.querySelector('.temp-night-txt').textContent = `${nightLow}°`

    renderForecast(data)

    showDisplaySection(weatherInfoSection)
}

function showDisplaySection(section) {
    [weatherInfoSection, searchCitySection, notFoundSection]
        .forEach(sec => sec.style.display = 'none')

    // Only the weather card owns the dynamic background. The search /
    // not-found states fall back to the default glassmorphism (gradient
    // overlay over the body's bg.jpg).
    if (section !== weatherInfoSection) {
        clearWeatherBackground()
    }

    section.style.display = 'flex'
}

// --- Forecast toggle (show/hide the 10-day forecast list) ---
// We fade the list out via a CSS opacity transition, then set `display:none`
// after the transition completes so the layout collapses and a future mascot
// or extra card has the room to render fully.
let forecastHideTimeout = null

function setForecastVisible(visible) {
    if (forecastHideTimeout) {
        clearTimeout(forecastHideTimeout)
        forecastHideTimeout = null
    }

    if (visible) {
        // Show: restore display first (so the opacity transition has a
        // element to animate on), then drop the collapsed class.
        forecastItemsContainer.style.display = ''
        forecastItemsContainer.classList.remove('is-collapsed')
    } else {
        // Hide: add the collapsed class to fade out, then drop display after
        // the transition so the section shrinks out of the layout.
        forecastItemsContainer.classList.add('is-collapsed')
        forecastHideTimeout = setTimeout(() => {
            if (forecastItemsContainer.classList.contains('is-collapsed')) {
                forecastItemsContainer.style.display = 'none'
            }
            forecastHideTimeout = null
        }, 260)
    }
}

if (forecastToggleBtn) {
    forecastToggleBtn.addEventListener('click', () => {
        const isExpanded = forecastToggleBtn.getAttribute('aria-expanded') === 'true'
        const willExpand = !isExpanded
        forecastToggleBtn.setAttribute('aria-expanded', String(willExpand))
        setForecastVisible(willExpand)
    })
}

// --- Home button (return to the search-city welcome screen) ---
if (homeBtn) {
    homeBtn.addEventListener('click', () => {
        showDisplaySection(searchCitySection)

        // Reset the search input + dropdown so a stale query doesn't linger.
        cityInput.value = ''
        currentSuggestions = []
        hideSuggestions()

        // Reset the forecast toggle so a fresh search lands in the expanded
        // state regardless of what the user did last.
        if (forecastToggleBtn) {
            forecastToggleBtn.setAttribute('aria-expanded', 'true')
            setForecastVisible(true)
        }
    })
}