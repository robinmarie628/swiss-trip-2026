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
      blocks: {},        // dayId -> [block]
      hidden: {},        // dayId -> [key]
      photoSpots: [],    // user-added photo spots
      hiddenPhotos: [],  // curated photo-spot ids the user hid
      photoVisible: true,
      order: {},         // dayId -> { b: [key], p: [key], t: [key] }
      sortMode: {},      // dayId -> 'auto' | 'manual'
      presets: null,     // null => fall back to EXPENSE_PRESETS
      budget: null,
      rates: null,       // { cny, eur, date, source, at }
    };
  }

  let data = blank();
  let base = null;                 // pristine snapshot of data.js day content
  const subs = [];

  /* ---------- stable keys for hiding base items ---------------------- */
  function keyOf(kind, item) {
    if (kind === 'p') return String(item.name);
    if (kind === 't') return String(item.from) + '→' + String(item.to) + '|' + String(item.mode || '');
    return String(item.time) + '|' + String(item.label);
  }

  function snapshot() {
    if (base) return;
    base = DAYS.map(function (d) {
      return {
        places: (d.places || []).slice(),
        transport: (d.transport || []).slice(),
        blocks: (d.blocks || []).slice(),
      };
    });
  }

  /* ---------- persistence -------------------------------------------- */
  function load() {
    snapshot();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        data = Object.assign(blank(), parsed || {});
        ['places', 'legs', 'blocks', 'hidden', 'order', 'sortMode'].forEach(function (k) {
          if (!data[k] || typeof data[k] !== 'object' || Array.isArray(data[k])) data[k] = {};
        });
        ['photoSpots', 'hiddenPhotos'].forEach(function (k) {
          if (!Array.isArray(data[k])) data[k] = [];
        });
      }
    } catch (e) { data = blank(); }
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

  function resolved(i) {
    snapshot();
    const d = DAYS[i];
    const id = d.id;
    const b = base[i];
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
    const places = applyOrder(b.places.filter(keep('p')).concat(add('places', 'p')), ord.p,
      function (x) { return x.name; });
    const transport = applyOrder(b.transport.filter(keep('t')).concat(add('legs', 't')), ord.t,
      function (x) { return x.from + '→' + x.to; });

    // timeline: auto by clock/period unless the traveller has dragged it
    if (sortMode(id) === 'manual') {
      blocks = applyOrder(blocks, ord.b, function (x) { return x.time + '|' + x.label; });
    } else {
      blocks = autoSortByTime(blocks);
    }

    return { places: places, transport: transport, blocks: blocks };
  }

  function sortMode(dayId) {
    return data.sortMode[dayId] === 'manual' ? 'manual' : 'auto';
  }

  function setSortMode(dayId, mode) {
    if (mode === 'auto') {
      delete data.sortMode[dayId];
      if (data.order[dayId]) delete data.order[dayId].b;
    } else {
      data.sortMode[dayId] = 'manual';
    }
    save();
  }

  /** persist a manual order; `keys` is the full sequence of item keys */
  function setOrder(dayId, kind, keys) {
    if (!data.order[dayId]) data.order[dayId] = {};
    data.order[dayId][kind] = keys.slice();
    if (kind === 'b') data.sortMode[dayId] = 'manual';
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
      return kind === 'p' ? x.name : kind === 't' ? (x.from + '→' + x.to) : (x.time + '|' + x.label);
    });
  }

  /** write the merged content back into DAYS so all renderers see it */
  function apply() {
    snapshot();
    DAYS.forEach(function (d, i) {
      const r = resolved(i);
      d.places = r.places;
      d.transport = r.transport;
      d.blocks = r.blocks;
    });
  }

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

  function addLeg(dayId, leg) {
    bucket('legs', dayId).push({
      from: leg.from,
      to: leg.to,
      mode: leg.mode || '',
      duration: leg.duration || '',
      note: leg.note || '',
      booked: leg.booked || null,
      detail: leg.detail || null,
    });
    save();
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
      const key = kind === 'p' ? item.name : kind === 't' ? (item.from + '→' + item.to) : (item.time + '|' + item.text);
      const idx = arr.findIndex(function (x) {
        if (kind === 'p') return x.name === item.name;
        if (kind === 't') return (x.from + '→' + x.to) === (item.from + '→' + item.to);
        return (x.time + '|' + x.text) === (item.time + '|' + item.text);
      });
      if (idx >= 0) arr.splice(idx, 1);
      void key;
    } else {
      if (!data.hidden[dayId]) data.hidden[dayId] = [];
      const k = keyOf(kind, item);
      if (data.hidden[dayId].indexOf(k) < 0) data.hidden[dayId].push(k);
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
      hasCustomPresets: Array.isArray(data.presets) };
  }

  global.STORE = {
    load: load, save: save, onChange: onChange,
    resolved: resolved, apply: apply,
    addPlace: addPlace, addLeg: addLeg, addBlock: addBlock,
    remove: remove, restoreHidden: restoreHidden,
    presets: presets, setPresets: setPresets, updatePreset: updatePreset,
    addPreset: addPreset, removePreset: removePreset, resetPresets: resetPresets,
    budget: budget, setBudget: setBudget, rates: rates, setRates: setRates,
    exportJson: exportJson, importJson: importJson, resetAll: resetAll,
    stats: stats, keyOf: keyOf,
    /* ordering */
    timeRank: timeRank, sortMode: sortMode, setSortMode: setSortMode,
    setOrder: setOrder, clearOrder: clearOrder, orderKeys: orderKeys,
    /* photo spots */
    allPhotoSpots: allPhotoSpots, photoSpotsForDay: photoSpotsForDay,
    addPhotoSpot: addPhotoSpot, removePhotoSpot: removePhotoSpot,
    restorePhotos: restorePhotos, setPhotoVisible: setPhotoVisible,
    photosVisible: photosVisible, hiddenPhotoCount: hiddenPhotoCount,
    raw: function () { return data; },
  };
})(window);
