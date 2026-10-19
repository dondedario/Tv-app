// Ambient TV dashboard: clock, weather and reminders, driven by a TV remote.
(function () {
  'use strict';

  var STORE_KEY = 'ambient-tv';
  var WEATHER_REFRESH_MS = 15 * 60 * 1000;
  var DRIFT_MS = 2 * 60 * 1000;
  // Back buttons: Escape (browsers), 461 (LG webOS), 10009 (Samsung Tizen).
  var BACK_KEYS = ['Escape', 'GoBack', 'BrowserBack'];
  var BACK_CODES = [461, 10009];

  var $ = function (id) { return document.getElementById(id); };

  // ---- Storage ----

  var state = load();

  function load() {
    var fallback = { reminders: [], settings: { city: '', lat: null, lon: null, units: 'celsius' } };
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (saved && saved.settings) return saved;
    } catch (e) { /* storage unavailable or corrupt */ }
    return fallback;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---- Clock and sky ----

  // Sky gradient [top, bottom] by hour of day.
  var SKIES = [
    [0, '#05070f', '#111a2e'],
    [5, '#1b2140', '#6b4a6e'],
    [7, '#2c5b8a', '#e3a96b'],
    [10, '#1f5f99', '#5c9bd1'],
    [16, '#2a4f86', '#c98a5a'],
    [19, '#1a1d3d', '#5a3557'],
    [21, '#070b1a', '#16213a']
  ];

  function tickClock() {
    var now = new Date();
    // Show AM/PM (where the locale uses it) as a small suffix so the clock stays on one line.
    var parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).formatToParts(now);
    var main = '', period = '';
    parts.forEach(function (p) { if (p.type === 'dayPeriod') period = p.value; else main += p.value; });
    $('time').innerHTML = '';
    $('time').appendChild(document.createTextNode(main.trim()));
    if (period) {
      var small = document.createElement('span');
      small.className = 'period';
      small.textContent = period;
      $('time').appendChild(small);
    }
    $('date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

    var h = now.getHours();
    $('greeting').textContent = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

    var sky = SKIES[0];
    for (var i = 0; i < SKIES.length; i++) if (h >= SKIES[i][0]) sky = SKIES[i];
    document.documentElement.style.setProperty('--sky-top', sky[1]);
    document.documentElement.style.setProperty('--sky-bottom', sky[2]);
  }

  function drift() {
    var x = (Math.random() * 2 - 1) * 1.5;
    var y = (Math.random() * 2 - 1) * 1.5;
    $('stage').style.transform = 'translate(' + x + 'vw,' + y + 'vh)';
  }

  // ---- Weather (Open-Meteo, no API key needed) ----

  // WMO weather codes -> [emoji, description].
  function describe(code) {
    if (code === 0) return ['☀️', 'Clear'];
    if (code <= 2) return ['🌤️', 'Partly cloudy'];
    if (code === 3) return ['☁️', 'Overcast'];
    if (code <= 48) return ['🌫️', 'Fog'];
    if (code <= 57) return ['🌦️', 'Drizzle'];
    if (code <= 67) return ['🌧️', 'Rain'];
    if (code <= 77) return ['🌨️', 'Snow'];
    if (code <= 82) return ['🌧️', 'Showers'];
    if (code <= 86) return ['🌨️', 'Snow showers'];
    return ['⛈️', 'Thunderstorm'];
  }

  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function loadWeather() {
    var s = state.settings;
    if (s.lat == null) {
      $('w-desc').textContent = 'Press OK to set your city';
      return;
    }
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + s.lat + '&longitude=' + s.lon +
      '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      '&temperature_unit=' + s.units + '&timezone=auto&forecast_days=4';
    fetchJson(url).then(renderWeather).catch(function () {
      $('w-desc').textContent = 'Weather unavailable';
    });
  }

  function renderWeather(data) {
    var now = describe(data.current.weather_code);
    $('w-icon').textContent = now[0];
    $('w-temp').textContent = Math.round(data.current.temperature_2m) + '°';
    $('w-desc').textContent = now[1] + (state.settings.city ? ' · ' + state.settings.city : '');

    var days = $('w-days');
    days.innerHTML = '';
    // Skip today; show the next three days.
    for (var i = 1; i < data.daily.time.length; i++) {
      var name = new Date(data.daily.time[i] + 'T12:00').toLocaleDateString([], { weekday: 'short' });
      var el = document.createElement('div');
      el.className = 'day';
      el.innerHTML = '<div class="d-name"></div><div class="d-icon"></div><div class="d-range"></div>';
      el.children[0].textContent = name;
      el.children[1].textContent = describe(data.daily.weather_code[i])[0];
      el.children[2].textContent = Math.round(data.daily.temperature_2m_max[i]) + '° / ' +
        Math.round(data.daily.temperature_2m_min[i]) + '°';
      days.appendChild(el);
    }
  }

  function setCity(name) {
    $('s-status').textContent = 'Looking up ' + name + '…';
    var url = 'https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(name);
    return fetchJson(url).then(function (data) {
      var place = data.results && data.results[0];
      if (!place) throw new Error('not found');
      state.settings.city = place.name;
      state.settings.lat = place.latitude;
      state.settings.lon = place.longitude;
      save();
      $('s-status').textContent = 'Weather set to ' + place.name + (place.country ? ', ' + place.country : '');
      loadWeather();
    }).catch(function () {
      $('s-status').textContent = 'Couldn’t find "' + name + '"';
    });
  }

  // ---- Reminders ----

  function minutesOf(time) {
    var p = time.split(':');
    return +p[0] * 60 + +p[1];
  }

  function sortedReminders() {
    return state.reminders.slice().sort(function (a, b) {
      if (!a.time) return b.time ? 1 : 0;
      if (!b.time) return -1;
      return minutesOf(a.time) - minutesOf(b.time);
    });
  }

  function formatTime(time) {
    var d = new Date();
    d.setHours(+time.split(':')[0], +time.split(':')[1]);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function renderReminders() {
    var list = $('reminder-list');
    list.innerHTML = '';
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var items = sortedReminders();

    if (!items.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Nothing planned. Enjoy the quiet.';
      list.appendChild(empty);
    }
    items.forEach(function (r) {
      var li = document.createElement('li');
      if (r.time) {
        var diff = minutesOf(r.time) - nowMin;
        // Highlight anything due within the hour, or overdue today.
        if (diff <= 60) li.className = 'due';
        var when = document.createElement('span');
        when.className = 'r-when';
        when.textContent = formatTime(r.time);
        li.appendChild(when);
      }
      li.appendChild(document.createTextNode(r.text));
      list.appendChild(li);
    });

    var edit = $('edit-list');
    edit.innerHTML = '';
    items.forEach(function (r) {
      var li = document.createElement('li');
      var label = document.createElement('span');
      label.textContent = (r.time ? formatTime(r.time) + '  ' : '') + r.text;
      var done = document.createElement('button');
      done.type = 'button';
      done.textContent = 'Done';
      done.addEventListener('click', function () {
        state.reminders = state.reminders.filter(function (x) { return x.id !== r.id; });
        save();
        renderReminders();
        focusables()[0].focus();
      });
      li.appendChild(label);
      li.appendChild(done);
      edit.appendChild(li);
    });
  }

  // ---- Settings panel and remote control ----

  function openPanel() {
    $('s-city').value = state.settings.city;
    $('s-units').value = state.settings.units;
    $('s-status').textContent = '';
    $('panel').showModal();
    $('r-text').focus();
  }

  function focusables() {
    return Array.prototype.slice.call($('panel').querySelectorAll('input, select, button'));
  }

  // Remotes only have arrows/OK/back, so move focus through the panel's controls in order.
  function moveFocus(step) {
    var items = focusables();
    var i = items.indexOf(document.activeElement);
    var next = items[Math.max(0, Math.min(items.length - 1, i + step))];
    if (next) next.focus();
  }

  function isBack(e) {
    return BACK_KEYS.indexOf(e.key) !== -1 || BACK_CODES.indexOf(e.keyCode) !== -1;
  }

  var hintTimer;
  function showHint() {
    $('hint').classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { $('hint').classList.remove('show'); }, 5000);
  }

  document.addEventListener('keydown', function (e) {
    var panel = $('panel');
    if (!panel.open) {
      showHint();
      if (e.key === 'Enter') { e.preventDefault(); openPanel(); }
      return;
    }
    if (isBack(e)) { e.preventDefault(); panel.close(); return; }

    var el = document.activeElement;
    var typing = el && el.tagName === 'INPUT' && el.type !== 'time';
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
    // Left/right move the text cursor while typing, otherwise move between controls.
    else if (e.key === 'ArrowRight' && !typing && el.tagName !== 'SELECT') { e.preventDefault(); moveFocus(1); }
    else if (e.key === 'ArrowLeft' && !typing && el.tagName !== 'SELECT') { e.preventDefault(); moveFocus(-1); }
  });

  document.addEventListener('mousemove', showHint);
  document.addEventListener('click', function () { if (!$('panel').open) openPanel(); });

  $('add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = $('r-text').value.trim();
    if (!text) return;
    state.reminders.push({ id: Date.now(), text: text, time: $('r-time').value || '' });
    save();
    $('r-text').value = '';
    $('r-time').value = '';
    renderReminders();
    $('r-text').focus();
  });

  $('settings-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var unitsChanged = state.settings.units !== $('s-units').value;
    state.settings.units = $('s-units').value;
    save();
    var city = $('s-city').value.trim();
    if (city && city !== state.settings.city) setCity(city);
    else if (unitsChanged) { loadWeather(); $('s-status').textContent = 'Saved'; }
    else $('s-status').textContent = 'Saved';
  });

  $('close').addEventListener('click', function (e) {
    e.stopPropagation();
    $('panel').close();
  });
  $('panel').addEventListener('click', function (e) { e.stopPropagation(); });

  // ---- Start ----

  // Use the TV's location if it can tell us and no city was chosen yet.
  if (state.settings.lat == null && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(function (pos) {
      state.settings.lat = +pos.coords.latitude.toFixed(3);
      state.settings.lon = +pos.coords.longitude.toFixed(3);
      save();
      loadWeather();
    }, function () { /* no location; user can set a city */ }, { timeout: 10000 });
  }

  tickClock();
  renderReminders();
  loadWeather();
  drift();
  setInterval(tickClock, 1000);
  setInterval(renderReminders, 60 * 1000);
  setInterval(loadWeather, WEATHER_REFRESH_MS);
  setInterval(drift, DRIFT_MS);
  showHint();
})();
