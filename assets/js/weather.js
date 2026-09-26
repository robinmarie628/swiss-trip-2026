/* ============================================================================
   Swiss Trip Workbench — weather module
   Data: Open-Meteo, which serves the MeteoSwiss ICON-CH1/CH2 regional models
   (1.1 km / 2.2 km) for Switzerland, plus global models beyond their range.
   No API key, CORS-enabled, so it works from a static GitHub Pages site.

   ICON-CH1 covers ~33 h and ICON-CH2 ~5 days, so the MeteoSwiss tier only
   fills the near term; further-out days fall back to the global blend and are
   labelled as such. Everything is cached in localStorage so the panel still
   renders offline.
   ========================================================================== */
(function (global) {
  'use strict';

  const API = 'https://api.open-meteo.com/v1/forecast';

  const DAILY = [
    'weather_code', 'temperature_2m_max', 'temperature_2m_min',
    'apparent_temperature_max', 'apparent_temperature_min',
    'precipitation_probability_max', 'precipitation_sum',
    'wind_speed_10m_max', 'uv_index_max', 'sunrise', 'sunset',
  ].join(',');

  const CURRENT = [
    'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
    'weather_code', 'wind_speed_10m', 'precipitation', 'is_day',
  ].join(',');

  const CACHE_KEY = 'swiss.weather.v1';
  const TTL = 30 * 60 * 1000;      // refetch after 30 minutes
  const PAST_DAYS = 7;             // so mid-trip days earlier in the week still resolve
  const FORECAST_DAYS = 16;        // Open-Meteo's forward horizon

  const PLACE_IDS = Object.keys(WEATHER_PLACES);

  const state = {
    loading: false,
    error: null,
    fetchedAt: 0,
    byDate: {},          // byDate[placeId][isoDate] = record
    subscribers: [],
  };

  /* ======================== helpers =================================== */
  function wmo(code) {
    return WMO[code] || { zh: '未知', en: 'Unknown', g: 'cloudy' };
  }

  function num(v) { return v == null || v === '' ? null : Number(v); }

  function round(v) { return v == null ? null : Math.round(v); }

  function zurichToday() {
    const p = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TRIP.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date()).forEach(function (x) { if (x.type !== 'literal') p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }

  function dayDiff(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }

  function ageText(ts) {
    if (!ts) return '';
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return '刚刚更新';
    if (m < 60) return m + ' 分钟前更新';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' 小时前更新';
    return Math.round(h / 24) + ' 天前更新';
  }

  /* ======================== fetching ================================== */
  function buildUrl(opts) {
    const params = new URLSearchParams();
    params.set('latitude', PLACE_IDS.map(function (p) { return WEATHER_PLACES[p].lat; }).join(','));
    params.set('longitude', PLACE_IDS.map(function (p) { return WEATHER_PLACES[p].lng; }).join(','));
    params.set('daily', DAILY);
    params.set('current', CURRENT);
    params.set('timezone', TRIP.timezone);
    if (opts.models) params.set('models', opts.models);
    if (opts.window) {
      params.set('past_days', String(PAST_DAYS));
      params.set('forecast_days', String(FORECAST_DAYS));
    } else {
      params.set('past_days', String(PAST_DAYS));
      params.set('forecast_days', '6');
    }
    return API + '?' + params.toString();
  }

  function fetchJson(url, timeoutMs) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs || 15000) : null;
    return fetch(url, { mode: 'cors', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error('天气服务返回 ' + res.status);
        return res.json();
      })
      .catch(function (e) {
        if (timer) clearTimeout(timer);
        if (e && e.name === 'AbortError') throw new Error('天气服务响应超时');
        throw e;
      });
  }

  /** turn one API location payload into byDate entries */
  function absorb(payload, placeId, tier) {
    const d = payload.daily || {};
    const times = d.time || [];
    const cur = payload.current || null;
    const curDate = cur && cur.time ? cur.time.slice(0, 10) : null;

    const bucket = state.byDate[placeId] || (state.byDate[placeId] = {});

    // fields the regional MeteoSwiss models may not carry — inherit from the
    // global tier rather than blanking them out
    const INHERIT = ['code', 'group', 'zh', 'en', 'tmax', 'tmin', 'appMax', 'appMin',
      'pop', 'precip', 'wind', 'uv', 'sunrise', 'sunset'];

    for (let i = 0; i < times.length; i++) {
      const code = d.weather_code ? d.weather_code[i] : null;
      const tmax = num(d.temperature_2m_max && d.temperature_2m_max[i]);
      const tmin = num(d.temperature_2m_min && d.temperature_2m_min[i]);
      if (code == null && tmax == null && tmin == null) continue;   // empty model day

      const prev = bucket[times[i]];
      if (prev && tier !== 2) continue;                             // global never overwrites

      const info = wmo(code);
      const rec = {
        place: placeId,
        date: times[i],
        elevation: payload.elevation,
        code: code,
        group: info.g,
        zh: info.zh,
        en: info.en,
        tmax: tmax,
        tmin: tmin,
        appMax: num(d.apparent_temperature_max && d.apparent_temperature_max[i]),
        appMin: num(d.apparent_temperature_min && d.apparent_temperature_min[i]),
        pop: num(d.precipitation_probability_max && d.precipitation_probability_max[i]),
        precip: num(d.precipitation_sum && d.precipitation_sum[i]),
        wind: num(d.wind_speed_10m_max && d.wind_speed_10m_max[i]),
        uv: num(d.uv_index_max && d.uv_index_max[i]),
        sunrise: (d.sunrise && d.sunrise[i] || '').slice(11, 16),
        sunset: (d.sunset && d.sunset[i] || '').slice(11, 16),
        src: tier === 2 ? 'meteoswiss' : 'global',
        current: null,
      };

      if (prev) {
        INHERIT.forEach(function (k) {
          const empty = rec[k] == null || rec[k] === '';
          if (empty && prev[k] != null && prev[k] !== '') rec[k] = prev[k];
        });
      }

      bucket[times[i]] = rec;
    }

    if (cur && curDate && bucket[curDate]) {
      const target = bucket[curDate];
      target.current = {
        temp: num(cur.temperature_2m),
        app: num(cur.apparent_temperature),
        rh: num(cur.relative_humidity_2m),
        code: cur.weather_code,
        wind: num(cur.wind_speed_10m),
        precip: num(cur.precipitation),
        isDay: cur.is_day === 1,
      };
      // only let the regional model restate the headline condition when the
      // global tier had nothing at all
      if (target.code == null) {
        const info = wmo(cur.weather_code);
        target.code = cur.weather_code;
        target.group = info.g;
        target.zh = info.zh;
        target.en = info.en;
      }
    }
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const c = JSON.parse(raw);
      if (!c || !c.byDate) return false;
      state.byDate = c.byDate;
      state.fetchedAt = c.fetchedAt || 0;
      return true;
    } catch (e) { return false; }
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        byDate: state.byDate, fetchedAt: state.fetchedAt,
      }));
    } catch (e) {}
  }

  function notify() {
    state.subscribers.forEach(function (fn) { try { fn(state); } catch (e) {} });
  }

  function refresh(force) {
    if (state.loading) return Promise.resolve(state);
    if (!force && state.fetchedAt && Date.now() - state.fetchedAt < TTL) {
      return Promise.resolve(state);
    }
    state.loading = true;
    state.error = null;
    notify();                                    // flip the panel into "loading"

    let err1 = null;

    // tier 1: whatever model blend covers the full window — this one matters
    const t1 = fetchJson(buildUrl({ window: true }), 15000).then(function (json) {
      const list = Array.isArray(json) ? json : [json];
      list.forEach(function (payload, i) {
        if (PLACE_IDS[i]) absorb(payload, PLACE_IDS[i], 1);
      });
    }).catch(function (e) { err1 = e; });

    // tier 2: MeteoSwiss ICON-CH2 for the near term — a bonus, never required
    const t2 = fetchJson(buildUrl({ models: 'meteoswiss_icon_ch2' }), 15000).then(function (json) {
      const list = Array.isArray(json) ? json : [json];
      list.forEach(function (payload, i) {
        if (PLACE_IDS[i]) absorb(payload, PLACE_IDS[i], 2);
      });
    }).catch(function () {});

    return Promise.all([t1, t2]).then(function () {
      state.loading = false;
      const have = Object.keys(state.byDate).length > 0;
      if (err1) {
        state.error = err1.message || '天气获取失败';
        if (!have) state.fetchedAt = 0;
      } else {
        state.fetchedAt = Date.now();
      }
      if (have) saveCache();
      notify();
      return state;
    });
  }

  /* ======================== reading =================================== */
  function recordFor(day) {
    const pid = day.weatherPlace;
    const bucket = state.byDate[pid];
    return bucket && bucket[day.date] ? bucket[day.date] : null;
  }

  function placeFor(day) {
    return WEATHER_PLACES[day.weatherPlace] || null;
  }

  /** how far out is this date? beyond ~7 days a forecast is indicative only */
  function reliability(date) {
    const ahead = dayDiff(zurichToday(), date);
    if (ahead < 0) return 'past';
    if (ahead === 0) return 'now';
    if (ahead <= 5) return 'near';
    if (ahead <= 10) return 'mid';
    return 'far';
  }

  /* ======================== advice engine ============================= */
  function advice(rec, day) {
    const place = WEATHER_PLACES[rec.place] || {};
    const hi = rec.appMax != null ? rec.appMax : rec.tmax;
    const lo = rec.appMin != null ? rec.appMin : rec.tmin;
    const band = WX_CLOTHING.filter(function (b) { return hi != null && hi >= b.min; })[0]
      || WX_CLOTHING[WX_CLOTHING.length - 1];

    const clothing = [band.text];
    const cautions = [];
    const rain = rec.pop != null ? rec.pop : 0;
    const wind = rec.wind != null ? rec.wind : 0;
    const uv = rec.uv != null ? rec.uv : 0;
    const g = rec.group;

    if (rain >= 60) {
      clothing.push('带雨具或防水外套');
      cautions.push({ lvl: 'warn', t: '降水概率 ' + Math.round(rain) + '%，记得带伞或防水外套；山路石阶可能湿滑' });
    } else if (rain >= 35) {
      clothing.push('备一件轻便雨衣');
      cautions.push({ lvl: 'info', t: '有 ' + Math.round(rain) + '% 的降水概率，出门带件轻便雨衣' });
    }

    if (g === 'snow' || g === 'sleet') {
      cautions.push({ lvl: 'danger', t: '有降雪或冻雨，路面可能结冰，务必穿防滑鞋、放慢脚步' });
    }
    if (g === 'thunder') {
      cautions.push({ lvl: 'danger', t: '有雷阵雨，避免在山脊、缆车、空旷地和树下停留' });
    }
    if (g === 'fog') {
      cautions.push({ lvl: 'warn', t: '有雾、能见度低，山区步道与自驾都要格外小心' });
    }

    if (wind >= 50) {
      cautions.push({ lvl: 'danger', t: '风力较大（' + Math.round(wind) + ' km/h），高山缆车与游船可能停运，出发前查运营状态' });
    } else if (wind >= 35) {
      clothing.push('穿防风外套');
      cautions.push({ lvl: 'warn', t: '风力偏大（' + Math.round(wind) + ' km/h），山上体感更冷' });
    }

    if (uv >= 6) {
      clothing.push('防晒霜、墨镜、帽子');
      cautions.push({ lvl: 'info', t: '紫外线较强（UV ' + Math.round(uv) + '），海拔越高越明显' });
    }

    if (lo != null && lo <= 2) {
      cautions.push({ lvl: 'warn', t: '早晚接近或低于冰点（' + Math.round(lo) + '°C），注意保暖防滑' });
    }
    if (hi != null && lo != null && hi - lo >= 12) {
      cautions.push({ lvl: 'info', t: '昼夜温差约 ' + Math.round(hi - lo) + '°C，建议分层穿、方便增减' });
    }
    if (place.mountain) {
      cautions.push({ lvl: 'warn', t: '山区天气变化快，出发前查 First / 少女峰官网的缆车与项目运营状态' });
    }

    const rank = { danger: 0, warn: 1, info: 2 };
    cautions.sort(function (a, b) { return rank[a.lvl] - rank[b.lvl]; });

    return { clothing: clothing, cautions: cautions, hi: hi, lo: lo, place: place };
  }

  /* ======================== animated icons ============================ */
  /* The positioning transform lives on an OUTER <g> so the CSS animation on
     the inner <g> does not clobber it. */
  const CLOUD = function (x, y, s, cls) {
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">' +
      '<g class="wxi-cloud ' + (cls || '') + '">' +
        '<circle cx="0" cy="0" r="9"/><circle cx="12" cy="-4" r="11"/>' +
        '<circle cx="24" cy="1" r="8"/><rect x="-8" y="-1" width="34" height="11" rx="5.5"/>' +
      '</g></g>';
  };

  const ICONS = {
    clear: function (isDay) {
      if (isDay === false) {
        return '<path d="M40 12a20 20 0 1 0 0 40 24 24 0 0 1 0-40Z" fill="#E7ECF5" class="wxi-core"/>' +
          '<circle cx="46" cy="20" r="2" fill="#E7ECF5" opacity=".8" class="wxi-twinkle"/>';
      }
      return '<g class="wxi-rays" stroke="#FFC93C" stroke-width="3.2" stroke-linecap="round">' +
          '<line x1="32" y1="4.5" x2="32" y2="12"/><line x1="32" y1="52" x2="32" y2="59.5"/>' +
          '<line x1="4.5" y1="32" x2="12" y2="32"/><line x1="52" y1="32" x2="59.5" y2="32"/>' +
          '<line x1="12.5" y1="12.5" x2="17.8" y2="17.8"/><line x1="46.2" y1="46.2" x2="51.5" y2="51.5"/>' +
          '<line x1="51.5" y1="12.5" x2="46.2" y2="17.8"/><line x1="17.8" y1="46.2" x2="12.5" y2="51.5"/>' +
        '</g>' +
        '<circle class="wxi-core" cx="32" cy="32" r="12.5" fill="#FFC93C"/>';
    },

    partly: function () {
      return '<g class="wxi-rays" stroke="#FFC93C" stroke-width="2.8" stroke-linecap="round">' +
          '<line x1="44" y1="6" x2="44" y2="11.5"/><line x1="62" y1="24" x2="56.5" y2="24"/>' +
          '<line x1="56.7" y1="11.3" x2="60.6" y2="7.4"/><line x1="31.3" y1="11.3" x2="27.4" y2="7.4"/>' +
        '</g>' +
        '<circle cx="44" cy="24" r="10.5" fill="#FFC93C"/>' +
        '<g fill="#DCE4EF">' + CLOUD(16, 40, 1.05) + '</g>';
    },

    cloudy: function () {
      return '<g fill="#B9C4D4" opacity=".7">' + CLOUD(24, 26, 0.82) + '</g>' +
        '<g fill="#DCE4EF">' + CLOUD(14, 40, 1.08) + '</g>';
    },

    fog: function () {
      return '<g fill="#DCE4EF" opacity=".85">' + CLOUD(16, 24, 0.9) + '</g>' +
        '<g stroke="#C4CEDC" stroke-width="4.5" stroke-linecap="round">' +
          '<line class="wxi-fogbar" x1="14" y1="41" x2="50" y2="41"/>' +
          '<line class="wxi-fogbar" x1="19" y1="49" x2="55" y2="49"/>' +
          '<line class="wxi-fogbar" x1="12" y1="57" x2="44" y2="57"/>' +
        '</g>';
    },

    drizzle: function () {
      return '<g fill="#DCE4EF">' + CLOUD(14, 30, 1.05) + '</g>' +
        '<g stroke="#8FCBFF" stroke-width="3" stroke-linecap="round">' +
          '<line class="wxi-drop" x1="24" y1="48" x2="24" y2="53"/>' +
          '<line class="wxi-drop" x1="34" y1="48" x2="34" y2="53"/>' +
          '<line class="wxi-drop" x1="44" y1="48" x2="44" y2="53"/>' +
        '</g>';
    },

    rain: function () {
      return '<g fill="#DCE4EF">' + CLOUD(14, 28, 1.08) + '</g>' +
        '<g stroke="#7FC4FF" stroke-width="3.2" stroke-linecap="round">' +
          '<line class="wxi-drop" x1="22" y1="46" x2="19" y2="56"/>' +
          '<line class="wxi-drop" x1="33" y1="46" x2="30" y2="56"/>' +
          '<line class="wxi-drop" x1="44" y1="46" x2="41" y2="56"/>' +
        '</g>';
    },

    sleet: function () {
      return '<g fill="#DCE4EF">' + CLOUD(14, 28, 1.08) + '</g>' +
        '<g stroke="#9FD3FF" stroke-width="3" stroke-linecap="round">' +
          '<line class="wxi-drop" x1="24" y1="46" x2="21" y2="56"/>' +
          '<line class="wxi-drop" x1="44" y1="46" x2="41" y2="56"/>' +
        '</g>' +
        '<g fill="#EAF6FF">' +
          '<circle class="wxi-flake" cx="33" cy="50" r="3"/>' +
        '</g>';
    },

    snow: function () {
      return '<g fill="#DCE4EF">' + CLOUD(14, 28, 1.08) + '</g>' +
        '<g fill="#EAF6FF">' +
          '<circle class="wxi-flake" cx="22" cy="50" r="3.2"/>' +
          '<circle class="wxi-flake" cx="33" cy="50" r="3.2"/>' +
          '<circle class="wxi-flake" cx="44" cy="50" r="3.2"/>' +
        '</g>';
    },

    thunder: function () {
      return '<g fill="#C9D2E0">' + CLOUD(14, 26, 1.08) + '</g>' +
        '<path class="wxi-bolt" d="M33 40 24 53h7l-2.5 10L40 47h-7l3-7Z" fill="#FFD93D"/>' +
        '<g stroke="#7FC4FF" stroke-width="3" stroke-linecap="round">' +
          '<line class="wxi-drop" x1="19" y1="46" x2="16.5" y2="55"/>' +
          '<line class="wxi-drop" x1="48" y1="46" x2="45.5" y2="55"/>' +
        '</g>';
    },
  };

  function icon(group, isDay) {
    const fn = ICONS[group] || ICONS.cloudy;
    return '<svg class="wxi" viewBox="0 0 64 64" aria-hidden="true">' + fn(isDay) + '</svg>';
  }

  /* ======================== rendering ================================= */
  const LVL_ICON = { danger: '!', warn: '!', info: 'i' };

  /** shown when there is no record for the selected day */
  function emptyPanel(day, placeLabel) {
    const anyData = Object.keys(state.byDate).length > 0;
    const rel = reliability(day.date);

    if (state.loading && !anyData) {
      return '<div class="wx wx-empty" data-g="none">' +
        '<span class="wx-ic">' + icon('partly') + '</span>' +
        '<span class="wx-empty-tx"><b>正在获取天气…</b>' +
          '<span>数据来自 MeteoSwiss 区域模式</span></span>' +
      '</div>';
    }

    let title, msg;
    if (!anyData) {
      title = '天气暂不可用';
      msg = state.error ? state.error + ' · 点开可重试' : '需要联网才能获取天气，点开可重试';
    } else if (rel === 'past') {
      title = '行程已过';
      msg = '该日期没有可用的天气数据';
    } else {
      title = '暂无预报';
      msg = '超出 16 天预报范围，临近出发再看';
    }

    return '<button class="wx wx-empty" data-g="none" data-wx-open="1">' +
      '<span class="wx-ic">' + icon('cloudy') + '</span>' +
      '<span class="wx-empty-tx"><b>' + esc(title) + '</b><span>' + esc(msg) + '</span></span>' +
      '<i class="wx-chev">›</i>' +
    '</button>';
  }

  function panelHtml(day) {
    const rec = recordFor(day);
    const place = placeFor(day);
    const placeLabel = place ? place.label : '';

    if (!rec) return emptyPanel(day, placeLabel);

    const a = advice(rec, day);
    const rel = reliability(day.date);
    const cur = rel === 'now' ? rec.current : null;
    const isDay = cur ? cur.isDay : true;
    const headline = cur && cur.temp != null ? Math.round(cur.temp) : round(rec.tmax);
    const sub = rec.zh + ' · ' + round(rec.tmax) + '° / ' + round(rec.tmin) + '°';

    const chips = [];
    if (cur && cur.app != null) chips.push('体感 ' + Math.round(cur.app) + '°');
    else if (rec.appMax != null) chips.push('体感最高 ' + Math.round(rec.appMax) + '°');
    if (rec.pop != null) chips.push('降水 ' + Math.round(rec.pop) + '%');
    if (rec.wind != null) chips.push('风 ' + Math.round(rec.wind) + ' km/h');
    if (rec.uv != null) chips.push('UV ' + Math.round(rec.uv));

    const top = a.cautions[0];
    const relTag = rel === 'far' ? '远期预报'
      : rel === 'mid' ? '中期预报'
      : rel === 'past' ? '已过去'
      : null;

    return '<button class="wx" data-g="' + rec.group + '" data-wx-open="1" ' +
        'aria-label="查看天气详情">' +
      '<span class="wx-atm ' + rec.group + '"></span>' +
      '<span class="wx-in">' +
        '<span class="wx-main">' +
          '<span class="wx-ic">' + icon(rec.group, isDay) + '</span>' +
          '<span class="wx-temp">' +
            '<b>' + (headline == null ? '--' : headline) + '<i>°</i></b>' +
            '<span class="wx-cond">' + esc(sub) + '</span>' +
          '</span>' +
          '<span class="wx-where">' + esc(placeLabel) +
            (relTag ? '<em>' + esc(relTag) + '</em>' : '') +
          '</span>' +
        '</span>' +
        (chips.length ? '<span class="wx-chips">' +
          chips.map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') +
        '</span>' : '') +
        '<span class="wx-cloth"><i class="wx-badge">穿</i>' + esc(a.clothing[0]) + '</span>' +
        (top ? '<span class="wx-caution" data-lvl="' + top.lvl + '">' +
          '<i class="wx-badge">' + LVL_ICON[top.lvl] + '</i>' + esc(top.t) + '</span>' : '') +
        '<span class="wx-src">' + esc(sourceLabel(rec)) + ' · ' + esc(ageText(state.fetchedAt)) +
          '<i class="wx-chev">›</i></span>' +
      '</span>' +
    '</button>';
  }

  function sourceLabel(rec) {
    if (rec.src === 'meteoswiss') return 'MeteoSwiss ICON-CH2 · 1.1 km';
    return 'Open-Meteo 全球模式';
  }

  function rowHtml(day) {
    const rec = recordFor(day);
    const place = placeFor(day);
    const di = new Date(day.date + 'T12:00:00Z');
    const md = (di.getUTCMonth() + 1) + '/' + di.getUTCDate();
    const dcell = '<span class="wxr-d"><b>' + md + '</b><i>' + esc(day.dow) + '</i></span>';

    if (!rec) {
      return '<div class="wxr">' + dcell +
        '<span class="wxr-p">' + esc(place ? place.label : '') + '</span>' +
        '<span class="wxr-i">—</span>' +
        '<span class="wxr-c">暂无</span>' +
        '<span class="wxr-t">—</span></div>';
    }
    return '<div class="wxr">' + dcell +
      '<span class="wxr-p">' + esc(place ? place.label : '') + '</span>' +
      '<span class="wxr-i">' + icon(rec.group, true) + '</span>' +
      '<span class="wxr-c">' + esc(rec.zh) + '</span>' +
      '<span class="wxr-t"><b>' + round(rec.tmax) + '°</b><i>' + round(rec.tmin) + '°</i></span>' +
    '</div>';
  }

  function sheetHtml(day) {
    const rec = recordFor(day);
    const place = placeFor(day);
    const rel = reliability(day.date);
    const di = new Date(day.date + 'T12:00:00Z');
    const dateLabel = (di.getUTCMonth() + 1) + '月' + di.getUTCDate() + '日 ' + day.dow;

    let head;
    if (!rec) {
      head = '<div class="wxs-hero" data-g="none">' +
        '<span class="wx-ic">' + icon('cloudy') + '</span>' +
        '<div><b>暂无预报</b><span>该日期超出 16 天预报范围，临近出发再看</span></div></div>';
    } else {
      const a = advice(rec, day);
      const cur = rel === 'now' ? rec.current : null;
      const isDay = cur ? cur.isDay : true;
      const big = cur && cur.temp != null ? Math.round(cur.temp) : round(rec.tmax);
      head = '<div class="wxs-hero" data-g="' + rec.group + '">' +
          '<span class="wx-atm ' + rec.group + '"></span>' +
          '<div class="wx-in wxs-hero-in">' +
            '<span class="wx-ic big">' + icon(rec.group, isDay) + '</span>' +
            '<div class="wxs-hero-tx">' +
              '<b>' + big + '°<i>' + esc(rec.zh) + '</i></b>' +
              '<span>' + esc(place ? place.label : '') + ' · ' + esc(place ? place.elev : '') + ' · ' +
                esc(dateLabel) + '</span>' +
              '<span class="wxs-hl">最高 ' + round(rec.tmax) + '° / 最低 ' + round(rec.tmin) + '°' +
                (cur && cur.app != null ? ' · 当前体感 ' + Math.round(cur.app) + '°' : '') + '</span>' +
              '<span class="wxs-model">' + esc(sourceLabel(rec)) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="wxs-grid">' +
          metric('降水概率', rec.pop != null ? Math.round(rec.pop) + '%' : '—') +
          metric('降水量', rec.precip != null ? rec.precip.toFixed(1) + ' mm' : '—') +
          metric('风速', rec.wind != null ? Math.round(rec.wind) + ' km/h' : '—') +
          metric('紫外线', rec.uv != null ? Math.round(rec.uv) : '—') +
          metric('湿度', cur && cur.rh != null ? Math.round(cur.rh) + '%' : '—') +
          metric('日出 / 日落', (rec.sunrise || '—') + ' / ' + (rec.sunset || '—')) +
        '</div>' +
        '<div class="wxs-block">' +
          '<div class="wxs-h">' + badge('穿') + '穿衣建议</div>' +
          '<ul class="wxs-list">' + a.clothing.map(function (c) {
            return '<li>' + esc(c) + '</li>';
          }).join('') + '</ul>' +
        '</div>' +
        '<div class="wxs-block">' +
          '<div class="wxs-h">' + badge('!') + '注意事项</div>' +
          (a.cautions.length
            ? '<ul class="wxs-list cautions">' + a.cautions.map(function (c) {
                return '<li data-lvl="' + c.lvl + '">' + esc(c.t) + '</li>';
              }).join('') + '</ul>'
            : '<div class="wxs-none">天气平稳，没有特别需要注意的</div>') +
        '</div>';
    }

    return head +
      '<div class="wxs-block">' +
        '<div class="wxs-h">' + badge('日') + '行程 8 天天气</div>' +
        '<div class="wxs-rows">' + DAYS.map(rowHtml).join('') + '</div>' +
      '</div>' +
      '<div class="wxs-foot">' +
        '<div class="wxs-srcnote">' +
          '<b>数据来源</b><br>' +
          'MeteoSwiss ICON-CH1 / ICON-CH2 区域模式（1.1–2.2 km）与 Open-Meteo 全球模式，' +
          '经 Open-Meteo API 获取，时区按瑞士当地时间。' +
          '<br><br>' +
          'MeteoSwiss 高分辨率区域模式只能预报未来约 5 天，所以更远的日期会自动使用全球模式，' +
          '并标注为「远期预报」；越临近出发，数字越准，也会自动切换到 MeteoSwiss 预报。' +
        '</div>' +
        (state.error ? '<div class="wxs-err">上次更新失败：' + esc(state.error) + '（显示的是缓存数据）</div>' : '') +
        '<div class="wxs-acts">' +
          '<button class="btn sm primary" data-wx-refresh="1">刷新天气</button>' +
          '<button class="btn sm ghost" data-open-link="https://www.meteoswiss.admin.ch/">' +
            '打开 MeteoSwiss</button>' +
          '<button class="btn sm ghost" data-open-link="https://www.meteoschweiz.admin.ch/verstehen/wettervorhersage.html">' +
            '预报说明</button>' +
        '</div>' +
      '</div>';
  }

  function metric(k, v) {
    return '<div class="wxs-m"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
  }

  function badge(t) { return '<i class="wx-badge">' + t + '</i>'; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ======================== public API ================================ */
  global.WEATHER = {
    state: state,
    refresh: refresh,
    recordFor: recordFor,
    placeFor: placeFor,
    advice: advice,
    icon: icon,
    panelHtml: panelHtml,
    sheetHtml: sheetHtml,
    sourceLabel: sourceLabel,
    ageText: ageText,
    loadCache: loadCache,
    onUpdate: function (fn) { state.subscribers.push(fn); },
    hasData: function () { return Object.keys(state.byDate).length > 0; },
  };
})(window);
