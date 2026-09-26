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
      places: {},    // dayId -> [place]
      legs: {},      // dayId -> [leg]
      blocks: {},    // dayId -> [block]
      hidden: {},    // dayId -> [key]
      presets: null, // null => fall back to EXPENSE_PRESETS
      budget: null,
      rates: null,   // { cny, eur, date, source, at }
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
        ['places', 'legs', 'blocks', 'hidden'].forEach(function (k) {
          if (!data[k] || typeof data[k] !== 'object') data[k] = {};
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
  function resolved(i) {
    snapshot();
    const d = DAYS[i];
    const id = d.id;
    const b = base[i];
    const hidden = data.hidden[id] || [];

    const keep = function (kind) {
      return function (item) { return hidden.indexOf(keyOf(kind, item)) < 0; };
    };

    const add = function (bucket, kind) {
      return (data[bucket][id] || []).map(function (x) {
        return Object.assign({}, x, { _user: true, _kind: kind });
      });
    };

    return {
      places: b.places.filter(keep('p')).concat(add('places', 'p')),
      transport: b.transport.filter(keep('t')).concat(add('legs', 't')),
      blocks: b.blocks.filter(keep('b')).concat(add('blocks', 'b')),
    };
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
    raw: function () { return data; },
  };
})(window);
