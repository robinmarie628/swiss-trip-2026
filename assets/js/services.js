/* ============================================================================
   Swiss Trip Workbench — external services

   All four endpoints are keyless and CORS-enabled (verified 2026-09-26), which
   is what makes them usable from a purely static page:

     transport.opendata.ch        real Swiss public-transport connections
                                  + station autocomplete  (official timetable data)
     geocoding-api.open-meteo.com place lookup for anything that isn't a station
     api.frankfurter.dev          CHF rates (European Central Bank, daily)
     open.er-api.com              CHF rates, fallback and more current

   Every call has a timeout and retries: this network is measurably flaky, and a
   hung request would otherwise leave a sheet spinning forever.
   ========================================================================== */
(function (global) {
  'use strict';

  const TRANSIT = 'https://transport.opendata.ch/v1';
  const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
  const FX_URLS = [
    'https://api.frankfurter.dev/v1/latest?base=CHF&symbols=CNY,EUR',
    'https://open.er-api.com/v6/latest/CHF',
  ];

  /* ======================== fetch plumbing ============================ */
  async function get(url, opts) {
    const o = opts || {};
    const tries = o.tries || 3;
    const timeout = o.timeout || 12000;
    let lastErr = null;

    for (let attempt = 0; attempt < tries; attempt++) {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctl ? setTimeout(function () { ctl.abort(); }, timeout) : null;
      try {
        const res = await fetch(url, {
          mode: 'cors',
          credentials: 'omit',
          signal: ctl ? ctl.signal : undefined,
        });
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error('服务返回 ' + res.status);
        const json = await res.json();
        return json;
      } catch (e) {
        if (timer) clearTimeout(timer);
        lastErr = e;
        if (e && e.name === 'AbortError') lastErr = new Error('请求超时');
        if (attempt < tries - 1) await sleep(500 + attempt * 700);
      }
    }
    throw lastErr || new Error('请求失败');
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ======================== place search ============================== */
  /** query Swiss stations (official data) */
  async function searchStations(q) {
    const json = await get(TRANSIT + '/locations?query=' + encodeURIComponent(q) + '&type=station',
      { tries: 2, timeout: 9000 });
    return (json.stations || [])
      .filter(function (s) { return s && s.name && s.coordinate && s.coordinate.x != null; })
      .slice(0, 7)
      .map(function (s) {
        return {
          name: s.name,
          nameEn: '',
          lat: s.coordinate.x,
          lng: s.coordinate.y,
          kind: 'transit',
          stationId: s.id || null,
          source: 'station',
        };
      });
  }

  /**
   * Nearest real stations to a coordinate, closest first.
   *
   * This is what lets us hand a *hotel* or a *sight* to SBB: SBB only routes
   * between stations, so "Sunstar Hotel Grindelwald" or "Bachalpsee" returns
   * "no connection". The official station directory (the same data Google Maps
   * and SBB draw from) can, however, translate a coordinate into the closest
   * stop — train station, tram or bus stop. We keep only entries that carry a
   * station id, because the endpoint also returns bare street addresses.
   */
  async function stationsNear(lat, lng) {
    if (lat == null || lng == null) return [];
    const json = await get(TRANSIT + '/locations?x=' + encodeURIComponent(lat) +
      '&y=' + encodeURIComponent(lng), { tries: 2, timeout: 9000 });
    return (json.stations || [])
      .filter(function (s) { return s && s.id && s.name; })
      .map(function (s) {
        const c = s.coordinate || {};
        return {
          name: s.name,
          // the API reports x = latitude, y = longitude (see searchStations)
          lat: c.x != null ? c.x : lat,
          lng: c.y != null ? c.y : lng,
          stationId: s.id,
          distance: s.distance || 0,
          kind: 'station',
        };
      })
      .sort(function (a, b) { return a.distance - b.distance; });
  }

  /** query Open-Meteo's geocoder for non-station places */
  async function searchGeocode(q) {
    const json = await get(GEOCODE + '?name=' + encodeURIComponent(q) + '&count=6&language=zh',
      { tries: 2, timeout: 9000 });
    return (json.results || []).map(function (r) {
      const where = [r.admin1, r.country].filter(Boolean).join(' · ');
      return {
        name: r.name,
        nameEn: r.name,
        lat: r.latitude,
        lng: r.longitude,
        kind: 'sight',
        note: where,
        source: 'geocode',
      };
    });
  }

  /**
   * OpenStreetMap POIs via Nominatim. This is the source that actually knows
   * Swiss features like Bachalpsee, Staubbach Falls or Schloss Laufen —
   * Open-Meteo's geocoder only carries populated places.
   */
  async function searchOsm(q) {
    const json = await get('https://nominatim.openstreetmap.org/search?q=' +
      encodeURIComponent(q) + '&format=jsonv2&limit=5&accept-language=zh',
      { tries: 2, timeout: 9000 });
    return (Array.isArray(json) ? json : []).map(function (r) {
      const parts = String(r.display_name || '').split(',').map(function (s) { return s.trim(); });
      const lat = parseFloat(r.lat);
      const lng = parseFloat(r.lon);
      if (isNaN(lat) || isNaN(lng)) return null;
      return {
        name: parts[0] || r.name || q,
        nameEn: r.name && r.name !== parts[0] ? r.name : '',
        lat: lat,
        lng: lng,
        kind: 'sight',
        note: parts.slice(1, 3).join(' · '),
        source: 'osm',
      };
    }).filter(Boolean);
  }

  /**
   * Search every source in parallel and report partial results as they land.
   * The endpoints have very different latency, so waiting for all of them
   * before painting anything makes the UI feel broken on a slow connection.
   */
  function searchPlacesStreaming(q, onPartial) {
    const query = String(q || '').trim();
    if (query.length < 2) return Promise.resolve([]);

    const seen = {};
    const out = [];

    function absorb(list) {
      let changed = false;
      (list || []).forEach(function (p) {
        if (p.lat == null || p.lng == null) return;      // unusable without coordinates
        const k = String(p.name).toLowerCase();
        if (seen[k]) return;
        seen[k] = 1;
        out.push(p);
        changed = true;
      });
      if (changed) { try { onPartial(out.slice()); } catch (e) {} }
      return changed;
    }

    const sources = [searchStations(query), searchOsm(query), searchGeocode(query)];
    let pending = sources.length;
    const done = function () {
      pending -= 1;
      if (pending === 0) { try { onPartial(out.slice(), true); } catch (e) {} }
    };

    return Promise.all(sources.map(function (p) {
      return p.then(absorb).catch(function () {}).then(done);
    })).then(function () { return out; });
  }

  /** merged search, resolved once (kept for callers that want a single result) */
  async function searchPlaces(q) {
    const settled = await Promise.allSettled([searchStations(q), searchOsm(q), searchGeocode(q)]);
    const out = [];
    const seen = {};
    settled.forEach(function (r) {
      if (r.status !== 'fulfilled') return;
      r.value.forEach(function (p) {
        const k = String(p.name).toLowerCase();
        if (seen[k]) return;
        seen[k] = 1;
        out.push(p);
      });
    });
    return out;
  }

  /**
   * Coordinates → a human-readable address. Used when the traveller copies the
   * address of a photo spot: the curated spots only carry coordinates.
   * Nominatim allows light on-demand use like this; the caller caches the result.
   */
  async function reverseGeocode(lat, lng) {
    if (lat == null || lng == null) throw new Error('缺少坐标');
    const json = await get('https://nominatim.openstreetmap.org/reverse?lat=' +
      encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng) +
      '&format=jsonv2&zoom=18&addressdetails=1&accept-language=zh',
      { tries: 1, timeout: 7000 });

    const a = json.address || {};
    // Swiss addresses read "Street 12, 1207 Town" — and for a landmark the name
    // itself is the most useful part, so it leads.
    const street = [a.road || a.pedestrian || a.footway || a.path || a.square,
      a.house_number].filter(Boolean).join(' ');
    const town = a.city || a.town || a.village || a.municipality || a.suburb || a.county;
    const poi = json.name || a.amenity || a.tourism || a.building || '';

    const parts = [];
    if (poi && poi !== street) parts.push(poi);
    if (street) parts.push(street);
    const tail = [a.postcode, town].filter(Boolean).join(' ');
    if (tail) parts.push(tail);
    if (a.country) parts.push(a.country);

    const out = parts.length ? parts.join(', ') : (json.display_name || '');
    if (!out) throw new Error('没有查到地址');
    return out;
  }

  /* ======================== connections =============================== */
  function endpointOf(ref) {
    if (!ref) return '';
    if (ref.stationId) return String(ref.stationId);
    if (ref.lat != null && ref.lng != null) return ref.lat + ',' + ref.lng;
    return String(ref.name || '');
  }

  function fmtDuration(dur) {
    // API gives "00d02:57:00"
    if (!dur) return '';
    const m = /^(?:(\d+)d)?(\d{2}):(\d{2})/.exec(String(dur));
    if (!m) return String(dur);
    const days = Number(m[1] || 0);
    const mins = days * 1440 + Number(m[2]) * 60 + Number(m[3]);
    return fmtMinutes(mins);
  }

  function fmtMinutes(mins) {
    if (!mins) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return h + ' 小时 ' + m + ' 分';
    if (h) return h + ' 小时';
    return m + ' 分钟';
  }

  function hhmm(iso) {
    return iso ? String(iso).slice(11, 16) : '';
  }

  /** the API appends "@<id>,<x>,<y>" to names resolved from coordinates */
  function cleanName(n) {
    return String(n == null ? '' : n).replace(/\s*@[\d.,]+\s*$/, '').trim();
  }

  const BUS = ['B', 'BUS', 'NFB', 'T', 'TRAM', 'TRO'];
  const BOAT = ['BAT', 'BAT_', 'S', 'SHIP'];

  function deriveMode(sections) {
    const cats = sections
      .filter(function (s) { return s.kind === 'ride'; })
      .map(function (s) { return String(s.cat || '').toUpperCase(); });
    if (!cats.length) return sections.length ? '步行' : '';
    const hasRail = cats.some(function (c) { return BUS.indexOf(c) < 0 && BOAT.indexOf(c) < 0; });
    const hasBus = cats.some(function (c) { return BUS.indexOf(c) >= 0; });
    const hasBoat = cats.some(function (c) { return BOAT.indexOf(c) >= 0; });
    const parts = [];
    if (hasRail) parts.push('火车');
    if (hasBoat) parts.push('游船');
    if (hasBus) parts.push('巴士 / 电车');
    return parts.join(' + ');
  }

  function normalizeConnection(c) {
    const sections = [];
    (c.sections || []).forEach(function (s) {
      if (s.journey) {
        const j = s.journey;
        const pl = j.passList || [];
        sections.push({
          kind: 'ride',
          cat: j.category || '',
          num: j.number || '',
          from: cleanName((pl[0] && pl[0].station && pl[0].station.name) || ''),
          to: cleanName((pl[pl.length - 1] && pl[pl.length - 1].station && pl[pl.length - 1].station.name) || ''),
          dep: hhmm(s.departure && s.departure.time) || hhmm(pl[0] && pl[0].departure),
          arr: hhmm(s.arrival && s.arrival.time) || hhmm(pl[pl.length - 1] && pl[pl.length - 1].arrival),
          platform: (pl[0] && pl[0].platform) || '',
          stops: pl.length,
        });
      } else if (s.walk) {
        sections.push({ kind: 'walk', min: Math.max(1, Math.round((s.walk.duration || 0) / 60)) });
      }
    });

    const rides = sections.filter(function (s) { return s.kind === 'ride'; });
    const durationMin = (function () {
      const m = /^(?:(\d+)d)?(\d{2}):(\d{2})/.exec(String(c.duration || ''));
      if (!m) return null;
      return Number(m[1] || 0) * 1440 + Number(m[2]) * 60 + Number(m[3]);
    })();

    return {
      dep: hhmm(c.from && c.from.departure),
      arr: hhmm(c.to && c.to.arrival),
      fromName: cleanName((c.from && c.from.station && c.from.station.name) || ''),
      toName: cleanName((c.to && c.to.station && c.to.station.name) || ''),
      duration: fmtDuration(c.duration),
      durationMin: durationMin,
      transfers: c.transfers == null ? Math.max(0, rides.length - 1) : c.transfers,
      sections: sections,
      lines: rides.map(function (r) { return (r.cat + ' ' + r.num).trim(); }),
      mode: deriveMode(sections),
    };
  }

  /**
   * Real connections between two points.
   * ref = { name, lat, lng, stationId }
   */
  async function connections(opts) {
    const from = endpointOf(opts.from);
    const to = endpointOf(opts.to);
    if (!from || !to) throw new Error('请先选择起点和终点');

    const p = new URLSearchParams();
    p.set('from', from);
    p.set('to', to);
    p.set('limit', String(opts.limit || 4));
    if (opts.date) p.set('date', opts.date);
    if (opts.time) p.set('time', opts.time);

    const json = await get(TRANSIT + '/connections?' + p.toString(), { tries: 2, timeout: 14000 });
    const list = (json.connections || []).map(normalizeConnection);
    if (!list.length) throw new Error('这两个地点之间没有查到班次');
    return list;
  }

  /* ======================== exchange rates ============================ */
  async function fx() {
    let lastErr = null;
    for (let i = 0; i < FX_URLS.length; i++) {
      const url = FX_URLS[i];
      try {
        const json = await get(url, { tries: 2, timeout: 12000 });
        const r = json.rates || {};
        const cny = Number(r.CNY);
        const eur = Number(r.EUR);
        if (!cny || !eur) throw new Error('汇率数据不完整');
        return {
          cny: cny,
          eur: eur,
          date: json.date || (json.time_last_update_utc
            ? new Date(json.time_last_update_utc).toISOString().slice(0, 10)
            : ''),
          source: i === 0 ? '欧洲央行 (ECB)' : 'open.er-api.com',
          at: Date.now(),
        };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('汇率获取失败');
  }

  global.SERVICES = {
    searchPlaces: searchPlaces,
    searchPlacesStreaming: searchPlacesStreaming,
    searchStations: searchStations,
    stationsNear: stationsNear,
    reverseGeocode: reverseGeocode,
    connections: connections,
    fx: fx,
    fmtMinutes: fmtMinutes,
    fmtDuration: fmtDuration,
  };
})(window);
