/* ============================================================================
   Swiss Trip Workbench — user data layer

   data.js holds the read-only base trip. Everything the traveller adds or
   edits — extra places, extra transport legs, extra timeline entries, hidden
   base items, custom expense presets, budget and FX overrides — lives here, in
   localStorage on the device.

   On every change the merged result is written back into the DAYS objects, so
   the rest of the app keeps reading DAYS[i].places / .transport / .blocks and
   needs no special-casing.
   ========================================================================== */
(function (global) {
  'use strict';

  const KEY = 'swiss.user.v1';

  function blank() {
    return {
      version: 1,
      places: {},        // dayId -> [place]
      legs: {},          // dayId -> [leg]
      legEdits: {},      // dayId -> { legKey: {patch} } — edits to base legs
      blocks: {},        // dayId -> [block]
      hidden: {},        // dayId -> [key]
      photoSpots: [],    // user-added photo spots
      hiddenPhotos: [],  // curated photo-spot ids the user hid
      photoVisible: true,
      dayMeta: {},       // dayId -> { region, weatherPlace, title, titleEn, summary }
                        //   user overrides for a day's city/route, applied on
                        //   top of data.js so the weather city + the itinerary
                        //   / map city names can be changed in sync ("换城市")
      extraDays: [],     // user-added days, appended to DAYS and sorted by date
      removedDays: [],   // ids of itinerary days the traveller removed (restorable)
      customCities: {},  // cityKey -> { label, labelEn, lat, lng, color, soft }
                        //   cities the traveller searched for, registered into
                        //   REGIONS + WEATHER_PLACES on every apply()
      customHotels: {},  // hotelId -> { name, city, address, lat, lng, region, ... }
                        //   hotels the traveller added, so a new day can have a stay
      order: {},         // dayId -> { b: [key], p: [key], t: [key] }
      sortMode: {},      // dayId -> { b|p|t: 'manual' }  (absent => 'auto')
      geoCache: {},      // 'lat,lng' -> reverse-geocoded address
      placeTimes: {},    // dayId -> { placeName: [fromMin, toMin] } — the user's
                         // own time requirement, fed to the route optimiser
      presets: null,     // null => fall back to EXPENSE_PRESETS
      budget: null,
      rates: null,       // { cny, eur, date, source, at }
    };
  }

  let data = blank();
  let base = null;                 // pristine snapshot of data.js day content
  let baseIds = [];                // ids of the days that came from data.js
  let baseDayObj = {};             // id -> the original day object (for restore)
  const subs = [];

  /* ---------- stable keys for hiding base items ---------------------- */
  /** a transport leg's identity — mode is part of it, so two legs between the
      same two places (train + walk) stay separately addressable */
  function legKey(item) {
    return String(item.from || '') + '→' + String(item.to || '') + '|' + String(item.mode || '');
  }

  function keyOf(kind, item) {
    if (kind === 'p') return String(item.name);
    if (kind === 't') return legKey(item);
    return String(item.time) + '|' + String(item.label);
  }

  /* Base content is keyed by day id (not index) so days can be inserted,
     removed and re-sorted by date without desyncing the snapshot. */
  function baseFor(d) {
    if (!base) base = {};
    if (!base[d.id]) {
      base[d.id] = {
        places: (d.places || []).slice(),
        transport: (d.transport || []).slice(),
        blocks: (d.blocks || []).slice(),
        // base day meta so a cleared override can be restored on re-apply
        region: d.region, weatherPlace: d.weatherPlace,
        title: d.title, titleEn: d.titleEn, summary: d.summary,
        hotelId: d.hotelId,
      };
    }
    return base[d.id];
  }

  function snapshot() {
    if (base) return;
    base = {};
    baseIds = [];
    baseDayObj = {};
    DAYS.forEach(function (d) {
      baseFor(d);
      baseIds.push(d.id);
      baseDayObj[d.id] = d;          // keep the object so a removed day can return
    });
  }

  /** chronological comparator for days */
  function byDate(a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  }

  /* ---------- persistence -------------------------------------------- */
  function load() {
    snapshot();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        data = Object.assign(blank(), parsed || {});
        ['places', 'legs', 'blocks', 'hidden', 'order', 'sortMode', 'geoCache',
          'legEdits', 'placeTimes', 'dayMeta', 'customCities', 'customHotels']
          .forEach(function (k) {
            if (!data[k] || typeof data[k] !== 'object' || Array.isArray(data[k])) data[k] = {};
          });
        ['photoSpots', 'hiddenPhotos', 'extraDays', 'removedDays'].forEach(function (k) {
          if (!Array.isArray(data[k])) data[k] = [];
        });
      }
    } catch (e) { data = blank(); }

    // apply() rebuilds the day list (adds extra days, drops removed ones)
    apply();
    return data;
  }

  function save(quiet) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    apply();
    if (quiet) return;
    subs.forEach(function (fn) { try { fn(data); } catch (e) {} });
  }

  function onChange(fn) { subs.push(fn); }

  /* ---------- merge --------------------------------------------------- */
  /* Period labels rank like a rough clock so an auto-sorted timeline puts
     "上午" before "下午" without the traveller typing a time. */
  const PERIOD_RANK = {
    '清晨': 330, '早上': 420, '上午': 540, '中午': 720, '午间': 720,
    '下午': 840, '傍晚': 1080, '晚上': 1200, '夜里': 1320, '深夜': 1380,
  };

  function timeRank(t) {
    const s = String(t == null ? '' : t).trim();
    const m = /^(\d{1,2})\s*[:：]\s*(\d{2})/.exec(s);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    for (const k in PERIOD_RANK) { if (s.indexOf(k) >= 0) return PERIOD_RANK[k]; }
    return null;                       // "灵活" / custom text — keeps manual position
  }

  /** reorder `list` to follow a stored key sequence; unknown keys sink to the end */
  function applyOrder(list, keys, keyFn) {
    if (!keys || !keys.length) return list;
    const rank = {};
    keys.forEach(function (k, i) { rank[k] = i; });
    return list.slice().sort(function (a, b) {
      const ia = rank[keyFn(a)];
      const ib = rank[keyFn(b)];
      return (ia == null ? 1e6 : ia) - (ib == null ? 1e6 : ib);
    });
  }

  function autoSortByTime(list) {
    return list.slice().sort(function (a, b) {
      const ra = timeRank(a.time);
      const rb = timeRank(b.time);
      if (ra == null && rb == null) return 0;      // stable: keep insertion order
      if (ra == null) return 1;
      if (rb == null) return -1;
      return ra - rb;
    });
  }

  /**
   * Sort by an explicit rank, but let un-ranked items *float* rather than sink.
   *
   * This is what makes transport sortable: only booked legs carry a departure
   * time, so a plain time sort would push every walk to the bottom — on day 4
   * that would move "walk to the falls" below the 10:30 train it precedes.
   * An un-ranked item instead inherits the rank of the last timed item before
   * it (plus a tiny nudge), so it stays in the phase it belongs to.
   */
  function anchorSort(list, rankOf) {
    let last = null, nudge = 0;
    const keyed = list.map(function (x, i) {
      const r = rankOf(x);
      if (r != null) { last = r; nudge = 0; return { x: x, i: i, k: r }; }
      nudge += 1;
      return { x: x, i: i, k: (last == null ? -1 : last) + nudge / 1000 };
    });
    keyed.sort(function (a, b) { return a.k !== b.k ? a.k - b.k : a.i - b.i; });
    return keyed.map(function (o) { return o.x; });
  }

  /** a leg's own clock time — a booked departure wins over a planned one */
  function legRank(l) {
    return timeRank(l.booked || l.time || '');
  }

  /**
   * A place has no time of its own, so borrow one from the timeline entry that
   * mentions it — that is what "sort the places by time" has to mean.
   */
  function placeRank(p, blocks) {
    const names = [p.name, p.nameEn].filter(Boolean);
    if (!names.length) return null;
    let best = null;
    (blocks || []).forEach(function (b) {
      const hay = String(b.label || '') + ' ' + String(b.text || '');
      const hit = names.some(function (n) { return hay.indexOf(n) >= 0; });
      if (!hit) return;
      const r = timeRank(b.time);
      if (r == null) return;
      if (best == null || r < best) best = r;
    });
    return best;
  }

  function resolved(i) {
    snapshot();
    const d = DAYS[i];
    const id = d.id;
    const b = baseFor(d);
    const hidden = data.hidden[id] || [];
    const ord = data.order[id] || {};

    const keep = function (kind) {
      return function (item) { return hidden.indexOf(keyOf(kind, item)) < 0; };
    };

    const add = function (bucket, kind) {
      return (data[bucket][id] || []).map(function (x) {
        return Object.assign({}, x, { _user: true, _kind: kind });
      });
    };

    let blocks = b.blocks.filter(keep('b')).concat(add('blocks', 'b'));
    let places = b.places.filter(keep('p')).concat(add('places', 'p'));

    // A base leg is never mutated: edits to it are stored as a patch and applied
    // in place, so the leg keeps its slot in the list. (Hiding it and appending a
    // copy would lose that slot, and the legs around it would re-sort wrongly.)
    // `_baseKey` records the leg's original identity, because an edit can change
    // its from/to/mode — later edits and deletes must still address the original.
    const edits = data.legEdits[id] || {};
    let transport = b.transport.filter(keep('t')).map(function (l) {
      const k = legKey(l);
      const e = edits[k];
      return Object.assign({}, l, e || {}, { _baseKey: k });
    }).concat(add('legs', 't'));

    // timeline: auto by clock/period unless the traveller has dragged it
    blocks = modeOf(id, 'b') === 'manual'
      ? applyOrder(blocks, ord.b, function (x) { return x.time + '|' + x.label; })
      : autoSortByTime(blocks);

    // transport: auto by departure time unless dragged
    transport = modeOf(id, 't') === 'manual'
      ? applyOrder(transport, ord.t, legKey)
      : anchorSort(transport, legRank);

    // places: auto by the time of the timeline entry that mentions them
    places = modeOf(id, 'p') === 'manual'
      ? applyOrder(places, ord.p, function (x) { return x.name; })
      : anchorSort(places, function (p) { return placeRank(p, blocks); });

    return { places: places, transport: transport, blocks: blocks };
  }

  /* ---------- sort mode, per kind ------------------------------------- */
  function modeOf(dayId, kind) {
    const v = data.sortMode[dayId];
    // legacy shape: a bare 'manual' string meant "the timeline was dragged"
    if (v === 'manual') return kind === 'b' ? 'manual' : 'auto';
    if (v && typeof v === 'object') return v[kind] === 'manual' ? 'manual' : 'auto';
    return 'auto';
  }

  function sortMode(dayId, kind) {
    return modeOf(dayId, kind || 'b');
  }

  function modeObject(dayId) {
    const v = data.sortMode[dayId];
    if (v && typeof v === 'object') return Object.assign({}, v);
    return v === 'manual' ? { b: 'manual' } : {};
  }

  function setSortMode(dayId, kind, mode) {
    const k = kind || 'b';
    const obj = modeObject(dayId);
    if (mode === 'manual') obj[k] = 'manual'; else delete obj[k];
    if (Object.keys(obj).length) data.sortMode[dayId] = obj;
    else delete data.sortMode[dayId];
    // dropping back to auto throws away that list's manual order
    if (mode !== 'manual' && data.order[dayId]) delete data.order[dayId][k];
    save();
  }

  /** persist a manual order; `keys` is the full sequence of item keys */
  function setOrder(dayId, kind, keys) {
    if (!data.order[dayId]) data.order[dayId] = {};
    data.order[dayId][kind] = keys.slice();
    // dragging a list pins just that list: it stops following the clock
    const obj = modeObject(dayId);
    obj[kind] = 'manual';
    data.sortMode[dayId] = obj;
    save();
  }

  function clearOrder(dayId, kind) {
    if (data.order[dayId]) delete data.order[dayId][kind];
    save();
  }

  /** keys for the current merged order of a kind */
  function orderKeys(dayId, kind) {
    const i = DAYS.map(function (d) { return d.id; }).indexOf(dayId);
    if (i < 0) return [];
    const r = resolved(i);
    const list = kind === 'p' ? r.places : kind === 't' ? r.transport : r.blocks;
    return list.map(function (x) {
      if (kind === 'p') return x.name;
      if (kind === 't') return legKey(x);
      return x.time + '|' + x.label;
    });
  }

  /**
   * Cities the traveller searched for are registered as first-class theme
   * regions and weather query points, so regionOf(day) / WEATHER.placeFor(day)
   * work on them with no special-casing anywhere else.
   */
  function registerCustomCities() {
    if (typeof REGIONS === 'undefined') return;
    Object.keys(data.customCities).forEach(function (key) {
      const c = data.customCities[key];
      REGIONS[key] = { label: c.label, labelEn: c.labelEn || c.label, color: c.color, soft: c.soft };
      if (typeof WEATHER_PLACES !== 'undefined') {
        WEATHER_PLACES[key] = { lat: c.lat, lng: c.lng, label: c.label, elev: c.elev || '' };
      }
    });
  }

  /** write the merged content back into DAYS so all renderers see it */
  function apply() {
    snapshot();
    registerCustomCities();
    // Rebuild the day list: itinerary days (minus the ones the traveller
    // removed) plus the days they added, kept in date order. Doing it here keeps
    // a pulled/synced payload correct without a separate rebuild step.
    const extraIds = data.extraDays.map(function (d) { return d.id; });
    for (let i = DAYS.length - 1; i >= 0; i--) {
      const id = DAYS[i].id;
      if (data.removedDays.indexOf(id) >= 0) { DAYS.splice(i, 1); continue; }
      if (baseIds.indexOf(id) < 0 && extraIds.indexOf(id) < 0) DAYS.splice(i, 1);
    }
    baseIds.forEach(function (id) {
      if (data.removedDays.indexOf(id) >= 0) return;
      if (!DAYS.some(function (x) { return x.id === id; }) && baseDayObj[id]) DAYS.push(baseDayObj[id]);
    });
    data.extraDays.forEach(function (d) {
      if (!DAYS.some(function (x) { return x.id === d.id; })) DAYS.push(d);
    });
    DAYS.sort(byDate);
    DAYS.forEach(function (d, i) {
      const r = resolved(i);
      d.places = r.places;
      d.transport = r.transport;
      d.blocks = r.blocks;
      // "换城市": a user override can repoint a day's region (itinerary / map
      // city label + colour) and weatherPlace (the city weather is read from),
      // plus its route title and summary — all in sync. Reset to base first so a
      // cleared override restores the original value rather than lingering.
      const b = baseFor(d);
      d.region = b.region;
      d.weatherPlace = b.weatherPlace;
      d.title = b.title;
      d.titleEn = b.titleEn;
      d.summary = b.summary;
      d.hotelId = b.hotelId;
      const m = data.dayMeta[d.id];
      if (m) {
        if (m.region != null) d.region = m.region;
        if (m.weatherPlace != null) d.weatherPlace = m.weatherPlace;
        if (m.title != null) d.title = m.title;
        if (m.titleEn != null) d.titleEn = m.titleEn;
        if (m.summary != null) d.summary = m.summary;
        if (m.hotelId != null) d.hotelId = m.hotelId;
      }
    });
  }

  /* ---------- day meta ("换城市") ------------------------------------- */
  const META_KEYS = ['region', 'weatherPlace', 'title', 'titleEn', 'summary', 'hotelId'];

  /** per-day overrides of region / weatherPlace / title / titleEn / summary.
      Returns a fresh copy so callers can't mutate the store directly. */
  function getDayMeta(dayId) {
    const m = data.dayMeta[dayId];
    return m ? Object.assign({}, m) : {};
  }

  /**
   * Merge an override into a day's meta. Pass null for a field to clear it
   * (revert to the data.js base value); pass an empty object to wipe all.
   */
  function setDayMeta(dayId, patch) {
    if (!data.dayMeta[dayId]) data.dayMeta[dayId] = {};
    const cur = data.dayMeta[dayId];
    Object.keys(patch || {}).forEach(function (k) {
      if (META_KEYS.indexOf(k) >= 0) {
        if (patch[k] == null) delete cur[k];
        else cur[k] = patch[k];
      }
    });
    if (!Object.keys(cur).length) delete data.dayMeta[dayId];
    save();
    apply();
    return cur;
  }

  /* ---------- custom cities (searched) -------------------------------- */
  function customCities() { return data.customCities; }

  /** register (or update) a searched city so it becomes a region + weather point */
  function setCustomCity(key, def) {
    data.customCities[key] = {
      label: def.label, labelEn: def.labelEn || def.label,
      lat: def.lat, lng: def.lng, elev: def.elev || '',
      color: def.color, soft: def.soft,
    };
    save();
    apply();
    return data.customCities[key];
  }

  /* ---------- custom hotels (added by the traveller) ------------------ */
  function customHotels() { return data.customHotels; }

  /** add (or update) a hotel the traveller typed in, so a day can point at it */
  function setCustomHotel(id, def) {
    data.customHotels[id] = {
      id: id,
      name: def.name,
      city: def.city || def.name,
      address: def.address || '',
      lat: def.lat, lng: def.lng,
      region: def.region || 'transit',
      nightsText: def.nightsText || '',
      checkIn: def.checkIn || '',
      checkOut: def.checkOut || '',
      note: def.note || '',
      custom: true,
    };
    save();
    apply();
    return data.customHotels[id];
  }

  function removeCustomHotel(id) { delete data.customHotels[id]; save(); }

  /* ---------- user-added days ----------------------------------------- */
  function isExtraDay(dayId) {
    return data.extraDays.some(function (d) { return d.id === dayId; });
  }

  /** append a traveller-authored day, keeping the whole list in date order */
  function addDay(day) {
    // a random suffix so two days added in the same millisecond stay distinct
    const id = day.id || ('x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
    const d = {
      id: id,
      date: day.date,
      dow: day.dow || '',
      dowEn: day.dowEn || '',
      region: day.region || 'transit',
      weatherPlace: day.weatherPlace || 'gva',
      title: day.title || '新的一天',
      titleEn: day.titleEn || '',
      headline: day.headline || '',
      stat: day.stat || '',
      summary: day.summary || '',
      blocks: day.blocks || [],
      transport: day.transport || [],
      hotelId: day.hotelId || null,
      places: day.places || [],
      tips: day.tips || [],
    };
    snapshot();                       // capture base from the pre-existing days
    data.extraDays.push(d);
    DAYS.push(d);
    DAYS.sort(byDate);
    baseFor(d);                       // seed the snapshot for this new day
    save();
    apply();
    return d;
  }

  /**
   * Remove a day from the itinerary.
   *  - a traveller-added day is deleted for good (with its buckets);
   *  - an itinerary day is only hidden (added to `removedDays`) so it can be
   *    restored later — its content in data.js is never touched.
   */
  function removeDay(dayId) {
    if (data.extraDays.some(function (d) { return d.id === dayId; })) {
      data.extraDays = data.extraDays.filter(function (d) { return d.id !== dayId; });
      if (base) delete base[dayId];
      ['places', 'legs', 'blocks', 'hidden', 'legEdits', 'placeTimes',
        'order', 'sortMode', 'dayMeta'].forEach(function (k) {
        if (data[k]) delete data[k][dayId];
      });
    } else if (baseIds.indexOf(dayId) >= 0) {
      if (data.removedDays.indexOf(dayId) < 0) data.removedDays.push(dayId);
    } else {
      return false;
    }
    const j = DAYS.map(function (d) { return d.id; }).indexOf(dayId);
    if (j >= 0) DAYS.splice(j, 1);
    save();
    apply();
    return true;
  }

  /** bring back one day removed with removeDay() */
  function restoreDay(dayId) {
    const i = data.removedDays.indexOf(dayId);
    if (i < 0) return false;
    data.removedDays.splice(i, 1);
    save();
    apply();
    return true;
  }

  /** bring back every removed day */
  function restoreDays() {
    if (!data.removedDays.length) return false;
    data.removedDays = [];
    save();
    apply();
    return true;
  }

  function removedDays() { return data.removedDays.slice(); }

  /* ---------- mutations ---------------------------------------------- */
  function bucket(name, dayId) {
    if (!data[name][dayId]) data[name][dayId] = [];
    return data[name][dayId];
  }

  function addPlace(dayId, place) {
    bucket('places', dayId).push({
      name: place.name,
      nameEn: place.nameEn || '',
      lat: place.lat,
      lng: place.lng,
      kind: place.kind || 'sight',
      note: place.note || '',
      stationId: place.stationId || null,
    });
    save();
  }

  /**
   * The traveller's own time requirement for a place, as [fromMin, toMin]
   * minutes past midnight — "be at the cable car by 09:00" is knowledge no
   * dataset has, so it is theirs to state and the optimiser's to honour.
   * Keyed by place name, matching keyOf('p', …).
   */
  function placeTime(dayId, name) {
    const day = data.placeTimes[dayId];
    const w = day && day[name];
    return (Array.isArray(w) && w.length === 2) ? w : null;
  }

  function setPlaceTime(dayId, name, win) {
    if (!data.placeTimes[dayId]) data.placeTimes[dayId] = {};
    if (!win) delete data.placeTimes[dayId][name];
    else data.placeTimes[dayId][name] = [Number(win[0]), Number(win[1])];
    save();
  }

  function addLeg(dayId, leg) {
    bucket('legs', dayId).push({
      from: leg.from,
      to: leg.to,
      mode: leg.mode || '',
      duration: leg.duration || '',
      note: leg.note || '',
      time: leg.time || null,
      booked: leg.booked || null,
      detail: leg.detail || null,
    });
    save();
  }

  /**
   * Edit a leg in place. User-added legs are patched directly; a leg from
   * data.js is immutable, so the change is kept as a patch keyed by the leg's
   * original identity and re-applied on every merge.
   */
  function updateLeg(dayId, index, patch) {
    const day = DAYS.filter(function (d) { return d.id === dayId; })[0];
    const item = day && day.transport[index];
    if (!item) return false;

    // for a base leg this is the original identity, which an edit may have changed
    const oldKey = item._baseKey || legKey(item);
    const clean = {};
    Object.keys(patch || {}).forEach(function (k) {
      if (k.charAt(0) !== '_') clean[k] = patch[k];
    });

    if (item._user) {
      const arr = data.legs[dayId] || [];
      const i = arr.map(legKey).indexOf(legKey(item));
      if (i < 0) return false;
      arr[i] = Object.assign({}, arr[i], clean);
    } else {
      if (!data.legEdits[dayId]) data.legEdits[dayId] = {};
      // a second edit folds into the stored patch instead of stacking a new one
      const prev = data.legEdits[dayId][oldKey];
      data.legEdits[dayId][oldKey] = Object.assign({}, prev || {}, clean);
    }

    // keep a manual order pointing at the right leg when its identity changes
    const nextKey = legKey(Object.assign({}, item, clean));
    if (nextKey !== oldKey) {
      const ord = data.order[dayId] && data.order[dayId].t;
      if (ord) {
        const j = ord.indexOf(oldKey);
        if (j >= 0) ord[j] = nextKey;
      }
    }
    save();
    return true;
  }

  function addBlock(dayId, block) {
    bucket('blocks', dayId).push({
      time: block.time || '灵活',
      label: block.label || '安排',
      text: block.text || '',
    });
    save();
  }

  /** remove a user-added item, or hide a base item */
  function remove(dayId, kind, index) {
    const list = DAYS.filter(function (d) { return d.id === dayId; })[0];
    if (!list) return;
    const merged = kind === 'p' ? list.places : kind === 't' ? list.transport : list.blocks;
    const item = merged[index];
    if (!item) return;

    if (item._user) {
      const bucketName = kind === 'p' ? 'places' : kind === 't' ? 'legs' : 'blocks';
      const arr = data[bucketName][dayId] || [];
      const key = kind === 'p' ? item.name : kind === 't' ? legKey(item) : (item.time + '|' + item.text);
      const idx = arr.findIndex(function (x) {
        if (kind === 'p') return x.name === item.name;
        if (kind === 't') return legKey(x) === legKey(item);
        return (x.time + '|' + x.text) === (item.time + '|' + item.text);
      });
      if (idx >= 0) arr.splice(idx, 1);
      void key;
    } else {
      if (!data.hidden[dayId]) data.hidden[dayId] = [];
      // a base leg is hidden by its *original* key, which an edit may have changed
      const k = kind === 't' ? (item._baseKey || keyOf(kind, item)) : keyOf(kind, item);
      if (data.hidden[dayId].indexOf(k) < 0) data.hidden[dayId].push(k);
      // a hidden leg no longer needs its edit patch
      if (kind === 't' && data.legEdits[dayId]) delete data.legEdits[dayId][k];
    }
    save();
  }

  function restoreHidden(dayId) {
    delete data.hidden[dayId];
    save();
  }

  /* ---------- expense presets ---------------------------------------- */
  function presets() {
    if (Array.isArray(data.presets)) return data.presets;
    return EXPENSE_PRESETS.map(function (p, i) {
      return { id: 'pr' + i, label: p.label, amount: p.amount, cat: p.cat };
    });
  }

  function setPresets(list, quiet) {
    data.presets = list.map(function (p, i) {
      return {
        id: p.id || 'pr' + Date.now() + i,
        label: p.label,
        amount: Number(p.amount) || 0,
        cat: p.cat || 'other',
      };
    });
    save(quiet);
  }

  function updatePreset(id, patch, quiet) {
    const list = presets().map(function (p) {
      return p.id === id ? Object.assign({}, p, patch) : p;
    });
    setPresets(list, quiet);
  }

  function addPreset(p) {
    const list = presets();
    list.push({ id: 'pr' + Date.now(), label: p.label, amount: Number(p.amount) || 0, cat: p.cat || 'other' });
    setPresets(list);
  }

  function removePreset(id) {
    setPresets(presets().filter(function (p) { return p.id !== id; }));
  }

  function resetPresets() {
    data.presets = null;
    save();
  }

  /* ---------- budget & rates ----------------------------------------- */
  function budget() {
    return data.budget != null ? Number(data.budget) : TRIP.budgetTarget;
  }
  function setBudget(v) { data.budget = Number(v) || 0; save(); }

  function rates() { return data.rates; }
  function setRates(r) { data.rates = r; save(); }

  /* ---------- photo spots --------------------------------------------- */
  function allPhotoSpots() {
    const curated = (typeof PHOTO_SPOTS !== 'undefined' ? PHOTO_SPOTS : [])
      .filter(function (s) { return data.hiddenPhotos.indexOf(s.id) < 0; })
      .map(function (s) { return Object.assign({}, s, { _curated: true }); });
    const mine = data.photoSpots.map(function (s) {
      return Object.assign({}, s, { _user: true });
    });
    return curated.concat(mine);
  }

  function photoSpotsForDay(dayId) {
    return allPhotoSpots().filter(function (s) { return !s.day || s.day === dayId; });
  }

  function addPhotoSpot(spot) {
    data.photoSpots.push({
      id: 'up' + Date.now().toString(36),
      day: spot.day || null,
      region: spot.region || null,
      name: spot.name,
      nameEn: spot.nameEn || '',
      lat: spot.lat,
      lng: spot.lng,
      best: spot.best || '',
      tip: spot.tip || '',
      // links this spot to its image blob in IndexedDB (local-only, never synced)
      photoId: spot.photoId || null,
    });
    save();
  }

  /** user-added spots are deleted; curated ones are hidden (restorable) */
  function removePhotoSpot(id) {
    const i = data.photoSpots.map(function (s) { return s.id; }).indexOf(id);
    if (i >= 0) data.photoSpots.splice(i, 1);
    else if (data.hiddenPhotos.indexOf(id) < 0) data.hiddenPhotos.push(id);
    save();
  }

  function restorePhotos() { data.hiddenPhotos = []; save(); }
  function setPhotoVisible(v) { data.photoVisible = !!v; save(); }
  function photosVisible() { return data.photoVisible !== false; }
  function hiddenPhotoCount() { return data.hiddenPhotos.length; }

  /* ---------- reverse-geocode cache ----------------------------------- */
  /* Photo spots carry coordinates, not a street address. The address is
     resolved once from Nominatim and kept, so copying it again is instant and
     still works with no connection. */
  function cachedAddress(lat, lng) {
    return data.geoCache[lat + ',' + lng] || null;
  }

  function setAddress(lat, lng, text) {
    if (!text) return;
    data.geoCache[lat + ',' + lng] = text;
    save(true);                       // silent: this is a cache, not an edit
  }

  /* ---------- backup -------------------------------------------------- */
  function exportJson() {
    return JSON.stringify({
      app: 'swiss-trip-workbench',
      exportedAt: new Date().toISOString(),
      data: data,
    }, null, 2);
  }

  function importJson(txt) {
    const parsed = JSON.parse(txt);
    const incoming = parsed && parsed.data ? parsed.data : parsed;
    if (!incoming || typeof incoming !== 'object') throw new Error('格式不正确');
    data = Object.assign(blank(), incoming);
    save();
    return true;
  }

  function resetAll() {
    data = blank();
    try { localStorage.removeItem(KEY); } catch (e) {}
    apply();
    subs.forEach(function (fn) { try { fn(data); } catch (e) {} });
  }

  function stats() {
    let places = 0, legs = 0, blocks = 0, hidden = 0;
    Object.keys(data.places).forEach(function (k) { places += data.places[k].length; });
    Object.keys(data.legs).forEach(function (k) { legs += data.legs[k].length; });
    Object.keys(data.blocks).forEach(function (k) { blocks += data.blocks[k].length; });
    Object.keys(data.hidden).forEach(function (k) { hidden += data.hidden[k].length; });
    return { places: places, legs: legs, blocks: blocks, hidden: hidden,
      photos: data.photoSpots.length, hiddenPhotos: data.hiddenPhotos.length,
      extraDays: data.extraDays.length, removedDays: data.removedDays.length,
      hasCustomPresets: Array.isArray(data.presets) };
  }

  global.STORE = {
    load: load, save: save, onChange: onChange,
    resolved: resolved, apply: apply,
    getDayMeta: getDayMeta, setDayMeta: setDayMeta,
    customCities: customCities, setCustomCity: setCustomCity,
    customHotels: customHotels, setCustomHotel: setCustomHotel, removeCustomHotel: removeCustomHotel,
    addDay: addDay, removeDay: removeDay, isExtraDay: isExtraDay,
    restoreDay: restoreDay, restoreDays: restoreDays, removedDays: removedDays,
    addPlace: addPlace, addLeg: addLeg, addBlock: addBlock,
    updateLeg: updateLeg,
    placeTime: placeTime, setPlaceTime: setPlaceTime,
    remove: remove, restoreHidden: restoreHidden,
    presets: presets, setPresets: setPresets, updatePreset: updatePreset,
    addPreset: addPreset, removePreset: removePreset, resetPresets: resetPresets,
    budget: budget, setBudget: setBudget, rates: rates, setRates: setRates,
    exportJson: exportJson, importJson: importJson, resetAll: resetAll,
    stats: stats, keyOf: keyOf, legKey: legKey,
    /* ordering */
    timeRank: timeRank, sortMode: sortMode, setSortMode: setSortMode,
    setOrder: setOrder, clearOrder: clearOrder, orderKeys: orderKeys,
    anchorSort: anchorSort, legRank: legRank, placeRank: placeRank,
    /* reverse-geocode cache */
    cachedAddress: cachedAddress, setAddress: setAddress,
    /* photo spots */
    allPhotoSpots: allPhotoSpots, photoSpotsForDay: photoSpotsForDay,
    addPhotoSpot: addPhotoSpot, removePhotoSpot: removePhotoSpot,
    restorePhotos: restorePhotos, setPhotoVisible: setPhotoVisible,
    photosVisible: photosVisible, hiddenPhotoCount: hiddenPhotoCount,
    raw: function () { return data; },
  };
})(window);
