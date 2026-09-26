/* ============================================================================
   Swiss Trip Workbench — app logic
   No build step, no dependencies beyond the vendored Leaflet.
   ========================================================================== */
(function () {
  'use strict';

  /* ======================== tiny helpers ============================== */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const pad2 = (n) => String(n).padStart(2, '0');

  /* storage ------------------------------------------------------------- */
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const K = {
    expenses: 'swiss.expenses.v1',
    budget: 'swiss.budget.v1',
    rates: 'swiss.rates.v1',
    sel: 'swiss.selday.v1',
  };

  /* toast --------------------------------------------------------------- */
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), 1900);
  }

  /* ======================== date / timezone =========================== */
  const TZ = TRIP.timezone;

  function zurichParts(d) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const o = {};
    fmt.formatToParts(d || new Date()).forEach((p) => { if (p.type !== 'literal') o[p.type] = p.value; });
    if (o.hour === '24') o.hour = '00';
    return o;
  }

  function zurichToday() {
    const p = zurichParts();
    return p.year + '-' + p.month + '-' + p.day;
  }

  /** whole days from ISO date a to ISO date b */
  function dayDiff(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }

  const WD_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function dateInfo(iso) {
    const d = new Date(iso + 'T12:00:00Z');
    const m = Number(iso.slice(5, 7));
    const day = Number(iso.slice(8, 10));
    const wd = WD_CN[(d.getUTCDay() + 7) % 7];
    return { month: m, day: day, wd: wd, md: m + '月' + day + '日', short: m + '/' + day };
  }

  function tripStatus() {
    const t = zurichToday();
    if (t < TRIP.startDate) return { phase: 'before', today: t, days: dayDiff(t, TRIP.startDate) };
    if (t > TRIP.endDate) return { phase: 'after', today: t, days: dayDiff(TRIP.endDate, t) };
    return { phase: 'during', today: t, index: dayDiff(TRIP.startDate, t) };
  }

  /* ======================== app state ================================= */
  const state = {
    view: 'today',
    sel: 0,
    itinMode: 'cards',
    walletMode: 'ledger',
    mapFilter: 'all',
    mapReady: false,
    mapLayer: 'std',
  };

  function dayIndexByDate(iso) {
    for (let i = 0; i < DAYS.length; i++) if (DAYS[i].date === iso) return i;
    return -1;
  }

  function initSel() {
    const st = tripStatus();
    if (st.phase === 'during') state.sel = clamp(st.index, 0, DAYS.length - 1);
    else {
      const saved = store.get(K.sel, null);
      state.sel = saved != null && saved >= 0 && saved < DAYS.length ? saved : 0;
    }
  }

  const hotelById = (id) => HOTELS.filter((h) => h.id === id)[0] || null;
  const regionOf = (day) => REGIONS[day.region] || REGIONS.transit;

  /* ======================== small view pieces ========================= */
  function icon(id, cls) {
    return '<svg' + (cls ? ' class="' + cls + '"' : '') + '><use href="#i-' + id + '"/></svg>';
  }

  function tintStyle(region) {
    return '--tint:' + region.color + ';--tint-soft:' + region.soft;
  }

  function navUrl(lat, lng, name) {
    return {
      google: 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng +
        '&travelmode=transit',
      apple: 'https://maps.apple.com/?daddr=' + lat + ',' + lng +
        '&q=' + encodeURIComponent(name || ''),
      geo: 'geo:' + lat + ',' + lng + '?q=' + lat + ',' + lng +
        '(' + encodeURIComponent(name || '') + ')',
    };
  }

  /* ======================== HERO ====================================== */
  function renderHero() {
    const day = DAYS[state.sel];
    const st = tripStatus();
    const r = regionOf(day);
    const di = dateInfo(day.date);
    const idx = state.sel + 1;
    const hotel = hotelById(day.hotelId);

    const booked = day.transport.filter((t) => t.booked);
    const third = booked.length
      ? { k: '已订车次', v: booked[0].booked }
      : { k: '今日重点', v: day.stat || day.headline };
    const hotelShort = hotel ? String(hotel.city).split(/\s/)[0] : '无住宿';

    let countdown = '';
    if (st.phase === 'before') {
      countdown =
        '<div class="count">' +
          '<div class="count-num">' + st.days + '</div>' +
          '<div class="count-txt">天后出发 · <b>' + esc(TRIP.startDate.slice(5).replace('-', '/')) +
          '</b> 北京首都机场 PEK T3 起飞<br>当前显示第 ' + idx + ' 天行程</div>' +
        '</div>';
    } else if (st.phase === 'during' && state.sel === st.index) {
      countdown =
        '<div class="count">' +
          '<div class="count-num">' + idx + '</div>' +
          '<div class="count-txt">今天是行程<b>第 ' + idx + ' 天</b> · 共 ' + DAYS.length +
          ' 天<br>祝旅途顺利 🇨🇭</div>' +
        '</div>';
    }

    $('#hero').innerHTML =
      '<svg class="hero-art" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true">' +
        '<path d="M0 120 L74 44 L120 84 L168 34 L232 92 L286 52 L340 96 L400 58 L400 120 Z" fill="rgba(255,255,255,.14)"/>' +
        '<path d="M0 120 L58 74 L118 104 L182 66 L250 108 L316 74 L400 106 L400 120 Z" fill="rgba(255,255,255,.2)"/>' +
      '</svg>' +
      '<div class="hero-in">' +
        '<div class="hero-top">' +
          '<span class="dot"></span>' +
          '<span>' + esc(day.dow) + ' · ' + esc(day.dowEn) + '</span>' +
        '</div>' +
        '<div class="hero-date">' +
          '<span class="big">' + pad2(di.day) + '</span>' +
          '<span class="unit">' + di.month + '月 · 第 ' + idx + ' 天</span>' +
          '<span class="tag" style="background:' + r.color + 'cc;border-color:' + r.color + '">' +
            esc(r.label) + '</span>' +
        '</div>' +
        '<div class="hero-route">' + esc(day.title) +
          '<span class="arrow">·</span><span class="en">' + esc(day.titleEn) + '</span>' +
        '</div>' +
        '<div class="hero-sum">' + esc(day.summary) + '</div>' +
        (typeof WEATHER !== 'undefined' ? WEATHER.panelHtml(day) : '') +
        '<div class="hero-stats">' +
          '<div class="hero-stat"><div class="k">行程日</div><div class="v">Day ' + idx + '</div></div>' +
          '<div class="hero-stat"><div class="k">住宿</div><div class="v">' +
            esc(hotelShort) + '</div></div>' +
          '<div class="hero-stat"><div class="k">' + esc(third.k) + '</div><div class="v">' +
            esc(third.v) + '</div></div>' +
        '</div>' +
        countdown +
      '</div>';
  }

  /* ======================== DAY CHIPS ================================= */
  function renderChips() {
    const st = tripStatus();
    const todayIdx = st.phase === 'during' ? st.index : -1;
    $('#dayChips').innerHTML = DAYS.map(function (d, i) {
      const di = dateInfo(d.date);
      const r = regionOf(d);
      return '<button class="dchip' + (i === state.sel ? ' is-on' : '') +
        (i === todayIdx ? ' is-today' : '') + '" data-day="' + i + '" ' +
        'style="' + (i === state.sel ? '' : 'border-color:' + r.color + '44') + '">' +
        '<div class="d">' + esc(d.dow) + '</div>' +
        '<div class="n">' + pad2(di.day) + '</div>' +
        '<div class="m">' + di.short + '</div>' +
      '</button>';
    }).join('');
  }

  /* ======================== shared sections =========================== */
  function cardHead(region, iconId, title, sub, right) {
    return '<div class="card-hd" style="' + tintStyle(region) + '">' +
      '<span class="ibub tint">' + icon(iconId) + '</span>' +
      '<div style="flex:1;min-width:0"><h3>' + esc(title) + '</h3>' +
        (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>' +
      (right || '') +
    '</div>';
  }

  function blockLabel(text) {
    return '<div style="margin:16px 0 2px;font-size:10.5px;font-weight:800;letter-spacing:.08em;' +
      'text-transform:uppercase;color:var(--faint)">' + esc(text) + '</div>';
  }

  /* ---- bare content ------------------------------------------------- */
  function timelineBare(day) {
    return '<div class="tl">' + day.blocks.map(function (b) {
      const dup = String(b.label) === String(b.time);
      return '<div class="tl-item">' +
        '<div class="tl-time">' + esc(b.time) + '</div>' +
        '<div class="tl-body">' +
          (dup ? '' : '<div class="tl-label">' + esc(b.label) + '</div>') +
          '<div class="tl-text">' + esc(b.text) + '</div>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function legsBare(day) {
    const r = regionOf(day);
    return day.transport.map(function (t) {
      const route = t.to
        ? esc(t.from) + ' <span class="arrow">→</span> ' + esc(t.to)
        : esc(t.from || '');
      const parts = [];
      if (t.mode) parts.push(esc(t.mode));
      if (t.duration) parts.push(esc(t.duration));
      if (t.note) parts.push(esc(t.note));
      return '<div class="leg" style="' + tintStyle(r) + '">' +
        '<div class="leg-rail"><span class="nub"></span><span class="bar"></span></div>' +
        '<div class="leg-body">' +
          (route ? '<div class="leg-route">' + route + '</div>' : '') +
          (parts.length ? '<div class="leg-meta">' + parts.join('<span class="sep"></span>') + '</div>' : '') +
          (t.booked
            ? '<div class="leg-booked">' + icon('check') +
              '<span>已预订</span><span class="t">' + esc(t.booked) + ' 发车</span></div>'
            : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function hotelBare(hotel) {
    if (!hotel) {
      return '<div class="hotel">' +
        '<span class="hotel-pic" style="--tint:#5A6572;--tint-soft:#EDEFF2">' + icon('plane') + '</span>' +
        '<div class="hotel-tx"><b>无住宿 · 当天返程</b>' +
          '<div class="addr">回程航班 CA862 · 日内瓦 13:20 起飞</div></div>' +
      '</div>';
    }
    const r = REGIONS[hotel.region] || REGIONS.transit;
    return '<div class="hotel" style="' + tintStyle(r) + '">' +
      '<span class="hotel-pic">' + icon('bed') + '</span>' +
      '<div class="hotel-tx">' +
        '<b>' + esc(hotel.name) + '</b>' +
        '<div class="addr">' + esc(hotel.address) + '</div>' +
        '<div class="hotel-badges">' +
          '<span class="badge tint">' + icon('cal') + esc(hotel.nightsText) + '</span>' +
          '<span class="badge">入住 ' + esc(hotel.checkIn.replace('-', '/')) + '</span>' +
          '<span class="badge">退房 ' + esc(hotel.checkOut.replace('-', '/')) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>' +
    (hotel.note ? '<div style="margin-top:11px;font-size:12.5px;line-height:1.6;color:var(--muted)">' +
      esc(hotel.note) + '</div>' : '') +
    '<div class="btn-row" style="margin-top:12px">' +
      '<button class="btn sm primary" data-hotel-nav="' + hotel.id + '">' + icon('nav') + '导航</button>' +
      '<button class="btn sm ghost" data-copy="' + esc(hotel.address) + '">复制地址</button>' +
      '<button class="btn sm ghost" data-hotel-map="' + hotel.id + '">在地图查看</button>' +
    '</div>';
  }

  function placesBare(day, di) {
    const r = regionOf(day);
    const idx = di == null ? state.sel : di;
    return day.places.map(function (p, i) {
      return '<button class="place" data-place="' + idx + ':' + i + '" style="' + tintStyle(r) + '">' +
        '<span class="place-ic">' +
          icon(p.kind === 'transit' ? 'train' : (p.kind === 'area' ? 'map' : 'pin')) + '</span>' +
        '<span class="place-tx"><b>' + esc(p.name) + '</b><span>' + esc(p.nameEn) +
          (p.note ? ' · ' + esc(p.note) : '') + '</span></span>' +
        '<span class="place-go">' + icon('chev') + '</span>' +
      '</button>';
    }).join('');
  }

  function tipsBare(day) {
    return day.tips.map(function (t, i) {
      return '<div class="note-item"><span class="num">' + (i + 1) + '</span><span>' + esc(t) + '</span></div>';
    }).join('');
  }

  /* ---- card wrappers ------------------------------------------------ */
  function timelineCard(day) {
    return '<div class="card">' +
      cardHead(regionOf(day), 'clock', '今日行程', day.headline) +
      '<div class="card-bd tight">' + timelineBare(day) + '</div></div>';
  }

  function transportCard(day, title, withAll) {
    const right = withAll
      ? '<div class="rt"><button class="btn sm ghost" data-all-bookings="1">全部车次</button></div>'
      : '';
    return '<div class="card">' +
      cardHead(regionOf(day), 'train', title || '交通', '时间均为约数 · 以 SBB App 为准', right) +
      '<div class="card-bd tight">' + legsBare(day) + '</div></div>';
  }

  /* ---- all booked connections + flights, as a sheet ------------------ */
  function bookingsSheetHtml() {
    return '<div style="margin:-4px 0 10px;font-size:10.5px;font-weight:800;letter-spacing:.08em;' +
        'text-transform:uppercase;color:var(--faint)">已订车次 · ' + BOOKINGS.length + ' 段</div>' +
      '<div class="card"><div class="card-bd tight">' +
        BOOKINGS.map(function (b) {
          const di = dayIndexByDate(b.date);
          const d = di >= 0 ? DAYS[di] : null;
          const r = d ? regionOf(d) : REGIONS.transit;
          return '<div class="leg" style="' + tintStyle(r) + '">' +
            '<div class="leg-rail"><span class="nub"></span><span class="bar"></span></div>' +
            '<div class="leg-body">' +
              '<div class="leg-route">' + esc(b.from) + ' <span class="arrow">→</span> ' + esc(b.to) + '</div>' +
              '<div class="leg-meta"><span>' + esc(b.dow) + ' ' + esc(b.date.slice(5).replace('-', '/')) + '</span>' +
                '<span class="sep"></span><span>出发 ' + esc(b.dep) + '</span></div>' +
              '<div class="leg-booked">' + icon('check') + '<span>已预订</span>' +
                '<span class="t">' + esc(b.dep) + '</span></div>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div></div>' +
      '<div style="margin:20px 0 10px;font-size:10.5px;font-weight:800;letter-spacing:.08em;' +
        'text-transform:uppercase;color:var(--faint)">航班</div>' +
      '<div class="card"><div class="card-bd tight">' +
        FLIGHTS.map(function (f) {
          return '<div class="kv"><span class="k">' + esc(f.direction.replace(/ · .*/, '')) + '</span>' +
            '<span class="v">' + esc(f.code) + ' · ' + esc(f.date.slice(5).replace('-', '/')) +
            ' · ' + esc(f.dep) + ' → ' + esc(f.arr) + '</span></div>';
        }).join('') +
      '</div></div>' +
      '<div class="btn-row" style="margin-top:16px">' +
        '<button class="btn block primary" data-open-link="https://www.sbb.ch/en">' +
          icon('ext') + '打开 SBB 官网</button>' +
      '</div>' +
      '<div style="margin-top:12px;display:flex;gap:8px;font-size:11.5px;line-height:1.6;color:var(--muted)">' +
        icon('info') + '<span>发车前请以 SBB Mobile App 上的实时站台与时间为准。</span>' +
      '</div>';
  }

  function hotelCard(day) {
    const hotel = hotelById(day.hotelId);
    const r = hotel ? (REGIONS[hotel.region] || REGIONS.transit) : REGIONS.transit;
    return '<div class="card">' +
      cardHead(r, 'bed', hotel ? '今晚住宿' : '住宿', hotel ? hotel.city : '无住宿 · 当天返程') +
      '<div class="card-bd">' + hotelBare(hotel) + '</div></div>';
  }

  function placesCard(day, title) {
    if (!day.places.length) return '';
    return '<div class="card">' +
      cardHead(regionOf(day), 'pin', title || '今日地点', '共 ' + day.places.length + ' 处') +
      '<div class="card-bd tight">' + placesBare(day) + '</div></div>';
  }

  function tipsCard(day) {
    if (!day.tips || !day.tips.length) return '';
    return '<div class="card"><div class="card-bd">' + tipsBare(day) + '</div></div>';
  }

  /* ======================== TODAY VIEW ================================ */
  function renderToday() {
    const day = DAYS[state.sel];
    const booked = day.transport.filter((t) => t.booked);
    let html = '<div class="sec" style="margin-top:20px">';

    html += hotelCard(day);
    html += '</div><div class="sec">' + timelineCard(day) + '</div>';

    html += '<div class="sec">' + transportCard(day, booked.length ? '交通 · 含已订车次' : '交通', true) + '</div>';
    html += '<div class="sec">' + placesCard(day) + '</div>';
    html += '<div class="sec">' + tipsCard(day) + '</div>';

    // quick jump to wallet
    html += '<div class="sec"><div class="card"><div class="card-bd">' +
      '<div class="btn-row">' +
        '<button class="btn sm ghost" data-wx-open="1">' + icon('sun') + '天气详情</button>' +
        '<button class="btn sm ghost" data-go="wallet">' + icon('coins') + '今日记账</button>' +
        '<button class="btn sm ghost" data-go="map">' + icon('map') + '打开地图</button>' +
        '<button class="btn sm ghost" data-open="tickets">' + icon('qr') + '出示票据</button>' +
      '</div></div></div></div>';

    $('#todayBody').innerHTML = html;
    renderHero();
    renderChips();
  }

  /* ======================== ITINERARY VIEW ============================ */
  function renderItin() {
    const box = $('#itinBody');

    if (state.itinMode === 'table') {
      box.innerHTML =
        '<div class="sec" style="margin-top:16px"><div class="card">' +
          '<div class="card-bd tight">' +
            DAYS.map(function (d, i) {
              const r = regionOf(d);
              const di = dateInfo(d.date);
              const h = hotelById(d.hotelId);
              const b = d.transport.filter((t) => t.booked);
              return '<button class="place" data-day="' + i + '" style="' + tintStyle(r) + ';align-items:flex-start">' +
                '<span class="place-ic" style="width:40px;height:40px;border-radius:12px">' +
                  '<span style="font-size:11px;font-weight:800;line-height:1.1;text-align:center">' +
                    di.short + '<br><span style="font-size:9px;opacity:.75">' + esc(d.dow) + '</span></span>' +
                '</span>' +
                '<span class="place-tx">' +
                  '<b>' + esc(d.title) + '</b>' +
                  '<span>' + esc(d.headline) + '</span>' +
                  '<span style="margin-top:3px">' +
                    (h ? '🏨 ' + esc(h.city) : '✈️ 无住宿') +
                    (b.length ? ' · 🚆 ' + esc(b[0].booked) : '') +
                  '</span>' +
                '</span>' +
                '<span class="place-go">' + icon('chev') + '</span>' +
              '</button>';
            }).join('') +
          '</div>' +
        '</div></div>';
      return;
    }

    box.innerHTML = DAYS.map(function (d, i) {
      const r = regionOf(d);
      const di = dateInfo(d.date);
      const h = hotelById(d.hotelId);
      return '<div class="sec" style="margin-top:16px">' +
        '<div class="card">' +
          '<button class="card-hd" data-toggle-day="' + i + '" style="width:100%;text-align:left;' +
            tintStyle(r) + ';background:' + r.soft + '">' +
            '<span class="ibub" style="background:' + r.color + ';color:#fff">' +
              '<span style="font-size:12px;font-weight:800">' + pad2(di.day) + '</span></span>' +
            '<div style="flex:1;min-width:0">' +
              '<h3>' + esc(d.title) + '</h3>' +
              '<div class="sub">' + esc(d.dow) + ' · ' + di.md + ' · ' + esc(r.labelEn) + '</div>' +
            '</div>' +
            '<span class="place-go" style="transform:rotate(90deg)">' + icon('chev') + '</span>' +
          '</button>' +
          '<div class="card-bd" style="display:none">' +
            '<div style="font-size:13.5px;line-height:1.7;color:var(--ink-2)">' + esc(d.summary) + '</div>' +
            blockLabel('时间安排') + timelineBare(d) +
            blockLabel('交通') + legsBare(d) +
            (h ? blockLabel('住宿') + hotelBare(h) : '') +
            (d.places.length ? blockLabel('地点 · ' + d.places.length + ' 处') +
              '<div style="margin:0 -1px">' + placesBare(d, i) + '</div>' : '') +
            (d.tips.length ? blockLabel('贴士') + tipsBare(d) : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ======================== MAP VIEW ================================== */
  let map = null;
  let mapLayerRef = null;
  let overlayGroup = null;

  const TILE = {
    std: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr: '&copy; OpenStreetMap contributors',
      max: 19,
    },
    terrain: {
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      attr: '&copy; OpenTopoMap (CC-BY-SA)',
      max: 17,
    },
  };

  function initMap() {
    if (state.mapReady || typeof L === 'undefined') return;
    map = L.map('map', {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      tap: true,
    }).setView([46.72, 7.75], 8);

    // keep +/- out of the way of the day filter row
    L.control.zoom({ position: 'topright' }).addTo(map);

    mapLayerRef = L.tileLayer(TILE.std.url, {
      maxZoom: TILE.std.max,
      attribution: TILE.std.attr,
    }).addTo(map);

    overlayGroup = L.layerGroup().addTo(map);
    state.mapReady = true;
  }

  function makePin(cls, color, html) {
    return L.divIcon({
      className: '',
      html: '<div class="pin ' + cls + '" style="--pin:' + color + '">' + html + '</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -14],
    });
  }

  function makeHotelPin(color) {
    return L.divIcon({
      className: '',
      html: '<div class="pin hotel" style="--pin:' + color + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round"><path d="M2.6 18.4v-12M2.6 12.4h18.8v6M21.4 12.4v-2.6a2 2 0 0 0-2-2h-6.2v4.6"/>' +
        '<circle cx="6.6" cy="9.6" r="1.9"/></svg></div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -12],
    });
  }

  /** pill-shaped marker carrying a city name (used in the trip overview) */
  function makeCityPin(color, label) {
    return L.divIcon({
      className: '',
      html: '<div class="pin city" style="--pin:' + color + '">' + esc(label) + '</div>',
      iconSize: [0, 0],
      iconAnchor: [0, 0],
      popupAnchor: [0, -16],
    });
  }

  function popupHtml(title, sub, lat, lng, name) {
    const u = navUrl(lat, lng, name);
    return '<b>' + esc(title) + '</b>' +
      (sub ? '<div class="pop-sub">' + esc(sub) + '</div>' : '') +
      '<div class="pop-acts">' +
        '<a class="btn sm primary" href="' + u.google + '" target="_blank" rel="noopener">导航</a>' +
        '<a class="btn sm ghost" href="' + u.apple + '" target="_blank" rel="noopener">Apple</a>' +
      '</div>';
  }

  function renderMapLegend() {
    const st = tripStatus();
    const items = [{ id: 'all', label: '全部' }].concat(DAYS.map(function (d, i) {
      const di = dateInfo(d.date);
      return { id: String(i), label: di.short + ' ' + d.dow, color: regionOf(d).color, today: st.phase === 'during' && st.index === i };
    }));
    $('#mapLegend').innerHTML = items.map(function (it) {
      return '<button data-mfilter="' + it.id + '" class="' + (state.mapFilter === it.id ? 'is-on' : '') + '"' +
        (it.color && state.mapFilter !== it.id ? ' style="border-color:' + it.color + '66"' : '') + '>' +
        esc(it.label) + (it.today ? ' · 今天' : '') + '</button>';
    }).join('');
  }

  function currentMapDays() {
    if (state.mapFilter === 'all') return DAYS.map((d, i) => i);
    const i = Number(state.mapFilter);
    return isNaN(i) ? DAYS.map((d, j) => j) : [i];
  }

  function renderMapContent() {
    if (!state.mapReady) return;
    const isAll = state.mapFilter === 'all';
    const days = currentMapDays();
    overlayGroup.clearLayers();
    const allPts = [];

    if (isAll) {
      /* ---------- trip overview: rail corridors + the towns we sleep in ---- */
      DAYS.forEach(function (d) {
        const r = regionOf(d);
        (RAIL_ROUTES[d.id] || []).forEach(function (leg) {
          const latlngs = leg.path.map(function (sid) {
            return [STATIONS[sid][0], STATIONS[sid][1]];
          });
          L.polyline(latlngs, {
            color: r.color, weight: 3.5, opacity: .85,
            dashArray: '1 8', lineCap: 'round',
          }).addTo(overlayGroup).bindPopup(
            '<b>' + esc(leg.label) + '</b><div class="pop-sub">' + esc(d.title) + '</div>'
          );
          latlngs.forEach(function (ll) { allPts.push(ll); });
        });
      });

      const seen = {};
      DAYS.forEach(function (d) {
        const h = hotelById(d.hotelId);
        if (!h || seen[h.id]) return;
        seen[h.id] = 1;
        const r = REGIONS[h.region] || REGIONS.transit;
        const label = String(h.city).split(/\s/)[0];
        L.marker([h.lat, h.lng], { icon: makeCityPin(r.color, label) })
          .addTo(overlayGroup)
          .bindPopup(popupHtml(h.name, h.address, h.lat, h.lng, h.name));
        allPts.push([h.lat, h.lng]);
      });
    } else {
      /* ---------- day detail: numbered stops + the day's route ------------- */
      days.forEach(function (di) {
        const d = DAYS[di];
        const r = regionOf(d);

        const h = hotelById(d.hotelId);
        if (h) {
          L.marker([h.lat, h.lng], { icon: makeHotelPin(r.color) })
            .addTo(overlayGroup)
            .bindPopup(popupHtml(h.name, h.address, h.lat, h.lng, h.name));
          allPts.push([h.lat, h.lng]);
        }

        const pts = [];
        d.places.forEach(function (p, pi) {
          pts.push([p.lat, p.lng]);
          L.marker([p.lat, p.lng], { icon: makePin('', r.color, String(pi + 1)) })
            .addTo(overlayGroup)
            .bindPopup(popupHtml(p.name, (p.nameEn || '') + (p.note ? ' · ' + p.note : ''),
              p.lat, p.lng, p.name));
          allPts.push([p.lat, p.lng]);
        });

        if (pts.length > 1) {
          L.polyline(pts, {
            color: r.color, weight: 3, opacity: .9,
            dashArray: '7 7', lineJoin: 'round',
          }).addTo(overlayGroup);
        }

        // the rail legs into and out of this day
        (RAIL_ROUTES[d.id] || []).forEach(function (leg) {
          const latlngs = leg.path.map(function (sid) {
            return [STATIONS[sid][0], STATIONS[sid][1]];
          });
          L.polyline(latlngs, {
            color: '#1a1a1a', weight: 2.5, opacity: .38, dashArray: '2 6',
          }).addTo(overlayGroup).bindPopup(
            '<b>' + esc(leg.label) + '</b>'
          );
          latlngs.forEach(function (ll) { allPts.push(ll); });
        });
      });
    }

    if (allPts.length) {
      try {
        map.fitBounds(L.latLngBounds(allPts).pad(0.16), { maxZoom: isAll ? 9 : 13 });
      } catch (e) {}
    }

    renderMapPlaces(days);
    $('#mapListTitle').textContent = isAll ? '全部地点' : '本日地点';
  }

  function renderMapPlaces(days) {
    let n = 0;
    const html = days.map(function (di) {
      const d = DAYS[di];
      const r = regionOf(d);
      const h = hotelById(d.hotelId);
      let out = '<div style="padding:10px 0 4px;font-size:11px;font-weight:700;letter-spacing:.06em;' +
        'text-transform:uppercase;color:' + r.color + '">' + esc(d.dow) + ' · ' + esc(d.title) + '</div>';
      if (h) {
        n++;
        out += '<button class="place" data-maplot="' + h.lat + ',' + h.lng + '">' +
          '<span class="place-ic" style="--tint:' + r.color + ';--tint-soft:' + r.soft + '">' + icon('bed') + '</span>' +
          '<span class="place-tx"><b>' + esc(h.name) + '</b><span>酒店 · ' + esc(h.address) + '</span></span>' +
          '<span class="place-go">' + icon('pin') + '</span></button>';
      }
      d.places.forEach(function (p) {
        n++;
        out += '<button class="place" data-maplot="' + p.lat + ',' + p.lng + '">' +
          '<span class="place-ic" style="--tint:' + r.color + ';--tint-soft:' + r.soft + '">' +
            icon(p.kind === 'transit' ? 'train' : 'pin') + '</span>' +
          '<span class="place-tx"><b>' + esc(p.name) + '</b><span>' + esc(p.nameEn) +
            (p.note ? ' · ' + esc(p.note) : '') + '</span></span>' +
          '<span class="place-go">' + icon('pin') + '</span></button>';
      });
      return out;
    }).join('');
    $('#mapPlaces').innerHTML = html || '<div class="empty">暂无地点</div>';
    $('#mapCount').textContent = n + ' 个点';
  }

  /* ======================== WALLET ==================================== */
  function expenses() { return store.get(K.expenses, []); }
  function saveExpenses(list) { store.set(K.expenses, list); }
  function budget() { return Number(store.get(K.budget, TRIP.budgetTarget)) || 0; }
  function rates() { return store.get(K.rates, { cny: 8.85, eur: 1.06 }); }

  function fmtCHF(n) {
    return (Math.round(n * 100) / 100).toLocaleString('en-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function catById(id) {
    return EXPENSE_CATEGORIES.filter((c) => c.id === id)[0] || EXPENSE_CATEGORIES[5];
  }

  function addExpense(o) {
    const list = expenses();
    list.unshift({
      id: 'e' + Date.now() + Math.random().toString(36).slice(2, 6),
      amount: Number(o.amount) || 0,
      cat: o.cat || 'other',
      note: o.note || catById(o.cat).label,
      date: o.date || zurichToday(),
      ts: Date.now(),
    });
    saveExpenses(list);
  }

  function renderWallet() {
    const box = $('#walletBody');
    if (state.walletMode === 'tickets') { box.innerHTML = ticketsHtml(); return; }

    const list = expenses();
    const total = list.reduce((s, e) => s + e.amount, 0);
    const bd = budget();
    const pct = bd > 0 ? clamp((total / bd) * 100, 0, 100) : 0;
    const left = bd - total;
    const rt = rates();
    const byCat = {};
    EXPENSE_CATEGORIES.forEach((c) => { byCat[c.id] = 0; });
    list.forEach((e) => { byCat[e.cat] = (byCat[e.cat] || 0) + e.amount; });
    const maxCat = Math.max.apply(null, [1].concat(Object.keys(byCat).map((k) => byCat[k])));

    const activeCats = EXPENSE_CATEGORIES.filter((c) => byCat[c.id] > 0);

    box.innerHTML =
      '<div class="wallet-hero">' +
        '<div class="wh-k">已记录支出 · Total recorded</div>' +
        '<div class="wh-v"><span class="cur">CHF</span>' + fmtCHF(total) + '</div>' +
        '<div class="bar' + (left < 0 ? ' over' : '') + '"><i style="width:' + pct + '%"></i></div>' +
        '<div class="wh-foot">' +
          '<span>预算 <b>CHF ' + fmtCHF(bd) + '</b></span>' +
          '<span>' + (left >= 0 ? '剩余 <b>CHF ' + fmtCHF(left) + '</b>' : '超支 <b>CHF ' + fmtCHF(-left) + '</b>') + '</span>' +
        '</div>' +
        '<div class="wh-foot" style="margin-top:4px">' +
          '<span>≈ <b>¥' + fmtCHF(total * rt.cny) + '</b> · €' + fmtCHF(total * rt.eur) + '</span>' +
          '<span>' + list.length + ' 笔记录</span>' +
        '</div>' +
      '</div>' +

      '<div class="sec">' +
        '<div class="sec-head"><h2>常见消费 · 点一下添加</h2></div>' +
        '<div class="presets">' +
          EXPENSE_PRESETS.map(function (p) {
            const c = catById(p.cat);
            return '<button class="preset" data-preset="' + esc(p.label) + '|' + p.amount + '|' + p.cat + '">' +
              '<span class="k" style="background:' + c.color + '1f;color:' + c.color + '">' + esc(c.label) + '</span>' +
              '<span class="n">' + esc(p.label) + '</span>' +
              '<span class="a">' + fmtCHF(p.amount) + '</span>' +
              '<span class="plus">' + icon('plus') + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
      '</div>' +

      (activeCats.length ?
      '<div class="sec">' +
        '<div class="sec-head"><h2>分类占比</h2></div>' +
        '<div class="card"><div class="card-bd"><div class="catbars">' +
          activeCats.map(function (c) {
            const v = byCat[c.id];
            return '<div class="catbar-row">' +
              '<span class="catbar-name"><i class="catbar-dot" style="background:' + c.color + '"></i>' + esc(c.label) + '</span>' +
              '<span class="catbar-track"><i style="width:' + ((v / maxCat) * 100) + '%;background:' + c.color + '"></i></span>' +
              '<span class="catbar-amt">' + fmtCHF(v) + '</span>' +
            '</div>';
          }).join('') +
        '</div></div></div>' +
      '</div>' : '') +

      '<div class="sec">' +
        '<div class="sec-head"><h2>账目明细</h2>' +
          (list.length ? '<span class="more" data-clear-ledger="1">清空</span>' : '') + '</div>' +
        '<div class="card"><div class="card-bd tight">' +
          (list.length ? list.map(function (e) {
            const c = catById(e.cat);
            return '<div class="ledger-row">' +
              '<span class="ledger-ic" style="--tint:' + c.color + ';--tint-soft:' + c.color + '1a">' +
                icon(c.icon === 'dot' ? 'dot' : c.icon) + '</span>' +
              '<span class="ledger-tx"><b>' + esc(e.note) + '</b>' +
                '<span>' + esc(e.date.slice(5).replace('-', '/')) + ' · ' + esc(c.label) + '</span></span>' +
              '<span class="ledger-amt">' + fmtCHF(e.amount) + '</span>' +
              '<button class="ledger-del" data-del-exp="' + e.id + '">' + icon('x') + '</button>' +
            '</div>';
          }).join('') : '<div class="empty">' + icon('coins') + '还没有记录<br>用下面的按钮或右上角「记一笔」开始</div>') +
        '</div></div>' +
      '</div>' +

      '<div class="sec">' +
        '<div class="btn-row">' +
          '<button class="btn sm ghost" data-edit-budget="1">修改预算</button>' +
          '<button class="btn sm ghost" data-edit-rates="1">修改汇率</button>' +
          '<button class="btn sm ghost" data-export-csv="1">导出 CSV</button>' +
        '</div>' +
      '</div>';
  }

  /* ---------- tickets ---------- */
  function ticketsHtml() {
    return '<div class="sec" style="margin-top:18px">' +
      TICKETS.map(function (t) {
        const isRail = t.kind === 'rail';
        const tint = isRail ? '#e30613' : '#3B6EA5';
        const soft = isRail ? 'var(--red-soft)' : '#E7EEF7';
        return '<div class="tkt" style="--tint:' + tint + ';--tint-soft:' + soft + '">' +
          '<div class="tkt-hd">' +
            '<span class="ic">' + icon(isRail ? 'ticket' : 'plane') + '</span>' +
            '<div><b>' + esc(t.title) + '</b>' +
              (t.holder ? '<span>' + esc(t.holder) + '</span>' : '') + '</div>' +
          '</div>' +
          '<div class="tkt-rows">' +
            t.facts.map(function (f) {
              return '<div class="tkt-row"><span class="k">' + esc(f[0]) + '</span>' +
                '<span class="v">' + esc(f[1]) + '</span></div>';
            }).join('') +
          '</div>' +
          (t.note ? '<div class="tkt-note">' + esc(t.note) + '</div>' : '') +
        '</div>';
      }).join('') +
    '</div>' +

    '<div class="sec">' +
      '<div class="sec-head"><h2>票据照片</h2><span class="more">仅存本机</span></div>' +
      '<div class="card"><div class="card-bd">' +
        '<div class="slots" id="ticketSlots"></div>' +
        '<div class="btn-row" style="margin-top:12px">' +
          '<button class="btn sm primary" data-add-photo="1">' + icon('camera') + '添加票据照片</button>' +
        '</div>' +
        '<div style="margin-top:12px;display:flex;gap:8px;font-size:11.5px;line-height:1.6;color:var(--muted)">' +
          icon('lock') +
          '<span>照片保存在你手机的浏览器本地存储里，<b>不会上传、也不会进入 Git 仓库</b>。' +
          '换手机或清除浏览器数据后会丢失。半价卡二维码含个人信息，请勿提交到公开仓库。</span>' +
        '</div>' +
      '</div></div>' +
    '</div>' +

    '<div class="sec">' +
      '<div class="card"><div class="card-bd">' +
        '<div class="btn-row">' +
          '<button class="btn sm ghost" data-open-link="https://www.sbb.ch/en">' + icon('ext') + 'SBB 官网</button>' +
          '<button class="btn sm ghost" data-open-link="https://www.sbb.ch/en/travelcards-and-tickets.html">' + icon('ext') + '半价卡说明</button>' +
        '</div>' +
      '</div></div>' +
    '</div>';
  }

  /* ======================== MORE VIEW ================================= */
  function renderMore() {
    const st = tripStatus();
    const rt = rates();

    $('#moreBody').innerHTML =
      /* hotels */
      '<div class="sec" style="margin-top:18px">' +
        '<div class="sec-head"><h2>酒店 · 4 家</h2></div>' +
        HOTELS.map(function (h) {
          const r = REGIONS[h.region] || REGIONS.transit;
          return '<div class="card" style="margin-top:12px">' +
            '<div class="card-hd" style="' + tintStyle(r) + '">' +
              '<span class="ibub tint">' + icon('bed') + '</span>' +
              '<div><h3>' + esc(h.city) + '</h3><div class="sub">' + esc(h.nightsText) + '</div></div>' +
              '<div class="rt"><button class="btn sm primary" data-hotel-nav="' + h.id + '">' + icon('nav') + '导航</button></div>' +
            '</div>' +
            '<div class="card-bd">' +
              '<div class="hotel"><div class="hotel-tx">' +
                '<b>' + esc(h.name) + '</b>' +
                '<div class="addr">' + esc(h.address) + '</div>' +
                '<div class="hotel-badges">' +
                  '<span class="badge tint">' + icon('cal') + esc(h.checkIn.replace('-', '/')) + ' → ' + esc(h.checkOut.replace('-', '/')) + '</span>' +
                  '<span class="badge">' + esc(h.nightsText) + '</span>' +
                '</div>' +
              '</div></div>' +
              (h.note ? '<div style="margin-top:10px;font-size:12.5px;line-height:1.6;color:var(--muted)">' + esc(h.note) + '</div>' : '') +
              '<div class="btn-row" style="margin-top:11px">' +
                '<button class="btn sm ghost" data-copy="' + esc(h.address) + '">复制地址</button>' +
                '<button class="btn sm ghost" data-hotel-map="' + h.id + '">地图</button>' +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +

      /* booked connections */
      '<div class="sec">' +
        '<div class="sec-head"><h2>已订车次 · SBB</h2></div>' +
        '<div class="card"><div class="card-bd tight">' +
          BOOKINGS.map(function (b) {
            const d = DAYS[dayIndexByDate(b.date)];
            const r = d ? regionOf(d) : REGIONS.transit;
            return '<div class="leg" style="' + tintStyle(r) + '">' +
              '<div class="leg-rail"><span class="nub"></span><span class="bar"></span></div>' +
              '<div class="leg-body">' +
                '<div class="leg-route">' + esc(b.from) + ' <span class="arrow">→</span> ' + esc(b.to) + '</div>' +
                '<div class="leg-meta"><span>' + esc(b.dow) + ' ' + esc(b.date.slice(5).replace('-', '/')) + '</span>' +
                  '<span class="sep"></span><span>出发 ' + esc(b.dep) + '</span></div>' +
                '<div class="leg-booked">' + icon('check') + '<span>已预订</span>' +
                  '<span class="t">' + esc(b.dep) + '</span></div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div></div>' +
      '</div>' +

      /* flights */
      '<div class="sec">' +
        '<div class="sec-head"><h2>航班</h2></div>' +
        FLIGHTS.map(function (f) {
          return '<div class="card" style="margin-top:12px"><div class="card-bd">' +
            '<div class="hotel">' +
              '<span class="hotel-pic" style="--tint:#3B6EA5;--tint-soft:#E7EEF7">' + icon('plane') + '</span>' +
              '<div class="hotel-tx">' +
                '<b>' + esc(f.airline) + ' ' + esc(f.code) + '</b>' +
                '<div class="addr">' + esc(f.direction) + ' · ' + esc(f.date.slice(5).replace('-', '/')) + '</div>' +
              '</div>' +
            '</div>' +
            '<div style="margin-top:11px">' +
              '<div class="kv"><span class="k">起飞</span><span class="v">' + esc(f.from) + ' · ' + esc(f.dep) + '</span></div>' +
              '<div class="kv"><span class="k">到达</span><span class="v">' + esc(f.to) + ' · ' + esc(f.arr) +
                (f.arrDate ? '（次日）' : '') + '</span></div>' +
              '<div class="kv"><span class="k">时长</span><span class="v">' + esc(f.duration) + '</span></div>' +
            '</div>' +
            (f.note ? '<div style="margin-top:8px;font-size:12px;color:var(--muted);line-height:1.6">' + esc(f.note) + '</div>' : '') +
          '</div></div>';
        }).join('') +
      '</div>' +

      /* tools */
      '<div class="sec">' +
        '<div class="sec-head"><h2>工具</h2></div>' +
        '<div class="card"><div class="card-bd tight">' +
          '<div class="kv"><span class="k">行程预算</span><span class="v">CHF ' + fmtCHF(budget()) + '</span>' +
            '<button class="btn sm ghost" data-edit-budget="1">改</button></div>' +
          '<div class="kv"><span class="k">参考汇率</span><span class="v">1 CHF ≈ ¥' + rt.cny + ' / €' + rt.eur + '</span>' +
            '<button class="btn sm ghost" data-edit-rates="1">改</button></div>' +
          '<div class="kv"><span class="k">瑞士当前时间</span><span class="v" id="moreClock">--:--</span></div>' +
          '<div class="kv"><span class="k">行程状态</span><span class="v">' +
            (st.phase === 'before' ? '未出发 · 还有 ' + st.days + ' 天'
              : st.phase === 'during' ? '进行中 · 第 ' + (st.index + 1) + ' 天'
              : '已结束') + '</span></div>' +
        '</div></div>' +
      '</div>' +

      /* links */
      '<div class="sec">' +
        '<div class="sec-head"><h2>实用链接</h2></div>' +
        '<div class="card"><div class="card-bd tight">' +
          LINKS.map(function (l) {
            return '<a class="link-row" href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
              '<span class="ic">' + icon('link') + '</span>' +
              '<span class="tx"><b>' + esc(l.label) + '</b><span>' + esc(l.desc) + '</span></span>' +
              '<span class="place-go">' + icon('ext') + '</span>' +
            '</a>';
          }).join('') +
        '</div></div>' +
      '</div>' +

      /* emergency */
      '<div class="sec">' +
        '<div class="sec-head"><h2>紧急电话</h2></div>' +
        '<div class="card"><div class="card-bd tight">' +
          CONTACTS.map(function (c) {
            return '<a class="link-row" href="tel:' + esc(c.value.replace(/\s/g, '')) + '">' +
              '<span class="ic" style="background:var(--red-soft);color:var(--red-ink)">' + icon('phone') + '</span>' +
              '<span class="tx"><b>' + esc(c.label) + '</b></span>' +
              '<span class="ledger-amt">' + esc(c.value) + '</span>' +
            '</a>';
          }).join('') +
        '</div></div>' +
      '</div>' +

      /* notes */
      '<div class="sec">' +
        '<div class="sec-head"><h2>行程说明</h2></div>' +
        '<div class="card"><div class="card-bd">' +
          NOTES.map(function (n, i) {
            return '<div class="note-item"><span class="num">' + (i + 1) + '</span><span>' + esc(n) + '</span></div>';
          }).join('') +
        '</div></div>' +
      '</div>' +

      /* trip meta */
      '<div class="sec">' +
        '<div class="sec-head"><h2>行程信息</h2></div>' +
        '<div class="card"><div class="card-bd tight">' +
          '<div class="kv"><span class="k">旅客</span><span class="v">' + esc(TRIP.traveller) + '</span></div>' +
          '<div class="kv"><span class="k">目的</span><span class="v">' + esc(TRIP.purpose) + '</span></div>' +
          '<div class="kv"><span class="k">出入境</span><span class="v">' + esc(TRIP.entryExit) + '</span></div>' +
          '<div class="kv"><span class="k">时长</span><span class="v">' + esc(TRIP.duration) + '</span></div>' +
          '<div class="kv"><span class="k">日期</span><span class="v">' + esc(TRIP.startDate) + ' → ' + esc(TRIP.endDate) + '</span></div>' +
        '</div></div>' +
      '</div>' +

      /* app */
      '<div class="sec">' +
        '<div class="sec-head"><h2>这个工作台</h2></div>' +
        '<div class="card"><div class="card-bd">' +
          '<div style="font-size:12.5px;line-height:1.7;color:var(--muted)">' +
            '把本页「添加到主屏幕」，即可像 App 一样离线打开：行程、地图、酒店、票据与记账都在手上。<br><br>' +
            '数据（账目、预算、票据照片）全部保存在这台设备本地，不会上传到任何服务器。' +
          '</div>' +
          '<div class="btn-row" style="margin-top:12px">' +
            '<button class="btn sm primary" id="installBtn" hidden>' + icon('plus') + '添加到主屏幕</button>' +
            '<button class="btn sm ghost" data-print="1">打印 / 存为 PDF</button>' +
            '<button class="btn sm ghost" data-reset="1">清空本地数据</button>' +
          '</div>' +
        '</div></div>' +
      '</div>' +

      '<div class="sec" style="padding-bottom:8px">' +
        '<div style="text-align:center;font-size:11px;color:var(--faint);line-height:1.7">' +
          '瑞士行 · 旅行工作台<br>行程数据来自本人行程单 · 仅供个人使用' +
        '</div>' +
      '</div>';

    $('#moreClock').textContent = $('#clockTime').textContent;
    hookInstall();
  }

  /* ======================== sheets ==================================== */
  let sheetOpen = false;
  let sheetKind = null;

  function openSheet(title, sub, body, after, kind) {
    $('#sheetTitle').textContent = title;
    $('#sheetSub').textContent = sub || '';
    $('#sheetBody').innerHTML = body;
    $('#sheet').classList.add('is-open');
    $('#sheetBg').classList.add('is-open');
    sheetOpen = true;
    sheetKind = kind || null;
    if (after) setTimeout(after, 40);
  }

  function closeSheet() {
    $('#sheet').classList.remove('is-open');
    $('#sheetBg').classList.remove('is-open');
    sheetOpen = false;
    sheetKind = null;
  }

  /* ---- weather ------------------------------------------------------- */
  function openWeatherSheet() {
    if (typeof WEATHER === 'undefined') return;
    const day = DAYS[state.sel];
    const place = WEATHER.placeFor(day);
    openSheet('天气 · ' + (place ? place.label : ''),
      '气温 · 天气 · 穿衣建议 · 注意事项',
      WEATHER.sheetHtml(day), null, 'weather');
  }

  function repaintWeatherSheet() {
    if (sheetOpen && sheetKind === 'weather' && typeof WEATHER !== 'undefined') {
      const day = DAYS[state.sel];
      $('#sheetBody').innerHTML = WEATHER.sheetHtml(day);
    }
  }

  function navSheet(lat, lng, name, sub) {
    const u = navUrl(lat, lng, name);
    openSheet(name, sub || '', 
      '<div class="btn-row" style="display:grid;gap:9px">' +
        '<a class="btn block primary" href="' + u.google + '" target="_blank" rel="noopener">' + icon('nav') + 'Google 地图导航</a>' +
        '<a class="btn block" href="' + u.apple + '" target="_blank" rel="noopener">' + icon('nav') + 'Apple 地图导航</a>' +
        '<a class="btn block ghost" href="' + u.geo + '">' + icon('pin') + '用手机默认地图打开</a>' +
        '<button class="btn block ghost" data-copy="' + lat + ',' + lng + '">复制坐标 ' + lat + ', ' + lng + '</button>' +
        '<button class="btn block ghost" data-map-here="' + lat + ',' + lng + '">在工作台地图中定位</button>' +
      '</div>');
  }

  function expenseSheet(prefill) {
    const p = prefill || { amount: '', cat: 'food', note: '' };
    const cats = EXPENSE_CATEGORIES.map(function (c) {
      return '<button data-cat="' + c.id + '" class="' + (c.id === p.cat ? 'is-on' : '') + '" ' +
        'style="--c:' + c.color + '">' + icon(c.icon === 'dot' ? 'dot' : c.icon) + esc(c.label) + '</button>';
    }).join('');

    openSheet('记一笔', '记录今天的开销', 
      '<div class="field">' +
        '<label>金额</label>' +
        '<div class="amount-input"><span class="cur">CHF</span>' +
          '<input id="exAmount" type="number" inputmode="decimal" step="0.05" min="0" ' +
          'placeholder="0.00" value="' + (p.amount === '' ? '' : p.amount) + '"></div>' +
      '</div>' +
      '<div class="field">' +
        '<label>分类</label>' +
        '<div class="catpick" id="exCats">' + cats + '</div>' +
      '</div>' +
      '<div class="field">' +
        '<label>备注</label>' +
        '<input id="exNote" type="text" placeholder="例如：First 缆车" value="' + esc(p.note) + '">' +
      '</div>' +
      '<div class="field">' +
        '<label>日期</label>' +
        '<input id="exDate" type="date" value="' + zurichToday() + '">' +
        '<div class="hint">默认按瑞士当地时间记录</div>' +
      '</div>' +
      '<button class="btn block primary" id="exSave" style="height:46px;margin-top:4px">' +
        icon('check') + '保存</button>',
      function () {
        const amt = $('#exAmount');
        if (amt && !p.amount) amt.focus();
        $('#exCats').addEventListener('click', function (ev) {
          const b = ev.target.closest('[data-cat]');
          if (!b) return;
          $$('#exCats button').forEach((x) => x.classList.remove('is-on'));
          b.classList.add('is-on');
        });
        $('#exSave').addEventListener('click', function () {
          const a = parseFloat($('#exAmount').value);
          if (!a || a <= 0) { toast('请输入金额'); return; }
          const cat = ($('#exCats .is-on') || {}).dataset ? $('#exCats .is-on').dataset.cat : 'other';
          addExpense({
            amount: a,
            cat: cat,
            note: $('#exNote').value.trim() || catById(cat).label,
            date: $('#exDate').value || zurichToday(),
          });
          closeSheet();
          renderWallet();
          toast('已记录 CHF ' + fmtCHF(a));
        });
      });
  }

  /* ======================== ticket photos (IndexedDB) ================= */
  const IDB = {
    db: null,
    open() {
      return new Promise(function (res) {
        if (IDB.db) return res(IDB.db);
        if (!('indexedDB' in window)) return res(null);
        const req = indexedDB.open('swiss-trip', 1);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains('photos')) {
            db.createObjectStore('photos', { keyPath: 'id' });
          }
        };
        req.onsuccess = function () { IDB.db = req.result; res(IDB.db); };
        req.onerror = function () { res(null); };
      });
    },
    async all() {
      const db = await IDB.open();
      if (!db) return [];
      return new Promise(function (res) {
        const tx = db.transaction('photos', 'readonly').objectStore('photos').getAll();
        tx.onsuccess = function () { res(tx.result || []); };
        tx.onerror = function () { res([]); };
      });
    },
    async put(rec) {
      const db = await IDB.open();
      if (!db) return;
      return new Promise(function (res) {
        const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').put(rec);
        tx.oncomplete = res;
        tx.onerror = res;
      });
    },
    async del(id) {
      const db = await IDB.open();
      if (!db) return;
      return new Promise(function (res) {
        const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').delete(id);
        tx.oncomplete = res;
        tx.onerror = res;
      });
    },
  };

  async function renderSlots() {
    const box = $('#ticketSlots');
    if (!box) return;
    const items = await IDB.all();
    items.sort((a, b) => b.ts - a.ts);
    let html = items.map(function (it) {
      const url = URL.createObjectURL(it.blob);
      return '<div class="slot" style="border-style:solid">' +
        '<img src="' + url + '" alt="' + esc(it.name) + '" data-photo="' + it.id + '">' +
        '<button class="x" data-del-photo="' + it.id + '">' + icon('x') + '</button>' +
      '</div>';
    }).join('');
    const slots = Math.max(0, 6 - items.length);
    for (let i = 0; i < slots; i++) {
      html += '<button class="slot" data-add-photo="1">' + icon('camera', 'add') + '<span>添加</span></button>';
    }
    box.innerHTML = html;
  }

  function pickPhoto() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.multiple = true;
    inp.addEventListener('change', async function () {
      const files = Array.prototype.slice.call(inp.files || []);
      for (const f of files) {
        await IDB.put({ id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6), name: f.name, blob: f, ts: Date.now() });
      }
      if (files.length) toast('已保存 ' + files.length + ' 张（仅本机）');
      renderSlots();
    });
    inp.click();
  }

  function viewPhoto(id) {
    IDB.all().then(function (items) {
      const it = items.filter((x) => x.id === id)[0];
      if (!it) return;
      openSheet(it.name || '票据', '', 
        '<img src="' + URL.createObjectURL(it.blob) + '" style="width:100%;border-radius:14px" alt="">');
    });
  }

  /* ======================== CSV export ================================ */
  function exportCsv() {
    const list = expenses();
    if (!list.length) { toast('还没有账目'); return; }
    const rows = [['日期', '分类', '备注', '金额(CHF)']];
    list.slice().reverse().forEach(function (e) {
      rows.push([e.date, catById(e.cat).label, e.note, e.amount.toFixed(2)]);
    });
    const csv = '\ufeff' + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'switzerland-expenses.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('已导出 CSV');
  }

  /* ======================== install prompt ============================ */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    hookInstall();
  });

  function hookInstall() {
    const b = $('#installBtn');
    if (b && deferredPrompt) {
      b.hidden = false;
      b.onclick = async function () {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        b.hidden = true;
      };
    }
  }

  /* ======================== routing =================================== */
  function setView(v, opts) {
    state.view = v;
    $$('.view').forEach(function (s) { s.classList.toggle('is-active', s.dataset.view === v); });
    $$('#nav button').forEach(function (b) { b.classList.toggle('is-on', b.dataset.go === v); });
    $('#fab').hidden = !(v === 'today' || v === 'wallet');

    if (v === 'today') renderToday();
    if (v === 'itin') renderItin();
    if (v === 'wallet') { renderWallet(); if (state.walletMode === 'tickets') renderSlots(); }
    if (v === 'more') renderMore();
    if (v === 'map') {
      initMap();
      renderMapLegend();
      renderMapContent();
      setTimeout(function () { if (map) map.invalidateSize(); }, 60);
    }
    if (!opts || !opts.keepScroll) window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
    try { history.replaceState(null, '', '#' + v); } catch (e) {}
  }

  function selectDay(i, goToday) {
    state.sel = clamp(i, 0, DAYS.length - 1);
    store.set(K.sel, state.sel);
    state.mapFilter = String(state.sel);
    if (goToday !== false && state.view !== 'today') setView('today');
    else { renderHero(); renderChips(); if (state.view === 'today') renderToday(); }
  }

  /* ======================== global events ============================= */
  function bind() {
    // nav
    $('#nav').addEventListener('click', function (e) {
      const b = e.target.closest('[data-go]');
      if (b) setView(b.dataset.go);
    });

    // header shadow
    window.addEventListener('scroll', function () {
      $('#hdr').classList.toggle('is-stuck', window.scrollY > 6);
    }, { passive: true });

    // day chips
    $('#dayChips').addEventListener('click', function (e) {
      const b = e.target.closest('[data-day]');
      if (b) selectDay(Number(b.dataset.day));
    });

    // itinerary segment
    $('#itinSeg').addEventListener('click', function (e) {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      $$('#itinSeg button').forEach((x) => x.classList.remove('is-on'));
      b.classList.add('is-on');
      state.itinMode = b.dataset.mode;
      renderItin();
    });

    // wallet segment
    $('#walletSeg').addEventListener('click', function (e) {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      $$('#walletSeg button').forEach((x) => x.classList.remove('is-on'));
      b.classList.add('is-on');
      state.walletMode = b.dataset.mode;
      renderWallet();
      if (state.walletMode === 'tickets') renderSlots();
    });

    // map legend
    $('#mapLegend').addEventListener('click', function (e) {
      const b = e.target.closest('[data-mfilter]');
      if (!b) return;
      state.mapFilter = b.dataset.mfilter;
      renderMapLegend();
      renderMapContent();
    });

    // FAB
    $('#fab').addEventListener('click', function () { expenseSheet(); });

    // sheet close
    $('#sheetX').addEventListener('click', closeSheet);
    $('#sheetBg').addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheetOpen) closeSheet(); });

    // delegated clicks
    document.addEventListener('click', function (e) {
      const t = e.target;

      const dayBtn = t.closest('[data-day]');
      if (dayBtn && !t.closest('#dayChips')) { selectDay(Number(dayBtn.dataset.day)); return; }

      const hotelNav = t.closest('[data-hotel-nav]');
      if (hotelNav) {
        const h = hotelById(hotelNav.dataset.hotelNav);
        if (h) navSheet(h.lat, h.lng, h.name, h.address);
        return;
      }

      const hotelMap = t.closest('[data-hotel-map]');
      if (hotelMap) {
        const h = hotelById(hotelMap.dataset.hotelMap);
        if (h) {
          let di = -1;
          for (let i = 0; i < DAYS.length; i++) { if (DAYS[i].hotelId === h.id) { di = i; break; } }
          state.mapFilter = di >= 0 ? String(di) : 'all';
          setView('map');
        }
        return;
      }

      const place = t.closest('[data-place]');
      if (place) {
        const parts = place.dataset.place.split(':');
        const d = DAYS[Number(parts[0])];
        const p = d.places[Number(parts[1])];
        if (p) navSheet(p.lat, p.lng, p.name, (p.nameEn || '') + (p.note ? ' · ' + p.note : ''));
        return;
      }

      const maplot = t.closest('[data-maplot]');
      if (maplot) {
        const ll = maplot.dataset.maplot.split(',').map(Number);
        if (map) { map.setView(ll, 14, { animate: true }); }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const mapHere = t.closest('[data-map-here]');
      if (mapHere) {
        const ll = mapHere.dataset.mapHere.split(',').map(Number);
        closeSheet();
        setView('map');
        setTimeout(function () { if (map) map.setView(ll, 15, { animate: true }); }, 220);
        return;
      }

      const mapAct = t.closest('[data-map-action]');
      if (mapAct && map) {
        const a = mapAct.dataset.mapAction;
        if (a === 'fit') renderMapContent();
        if (a === 'route') renderMapContent();
        if (a === 'terrain') {
          state.mapLayer = state.mapLayer === 'std' ? 'terrain' : 'std';
          const cfg = TILE[state.mapLayer];
          map.removeLayer(mapLayerRef);
          mapLayerRef = L.tileLayer(cfg.url, { maxZoom: cfg.max, attribution: cfg.attr }).addTo(map);
          toast(state.mapLayer === 'std' ? '标准地图' : '地形图');
        }
        return;
      }

      const toggleDay = t.closest('[data-toggle-day]');
      if (toggleDay) {
        const card = toggleDay.closest('.card');
        const bd = card.querySelector('.card-bd');
        const open = bd.style.display !== 'none';
        bd.style.display = open ? 'none' : 'block';
        const chev = toggleDay.querySelector('.place-go');
        if (chev) chev.style.transform = open ? 'rotate(90deg)' : 'rotate(-90deg)';
        return;
      }

      const ab = t.closest('[data-all-bookings]');
      if (ab) {
        openSheet('交通总览', 'SBB 已订车次与航班', bookingsSheetHtml());
        return;
      }

      const wxo = t.closest('[data-wx-open]');
      if (wxo) { openWeatherSheet(); return; }

      const wxr = t.closest('[data-wx-refresh]');
      if (wxr) {
        wxr.textContent = '刷新中…';
        WEATHER.refresh(true).then(function () {
          toast('天气已更新');
          repaintWeatherSheet();
          renderHero();
        });
        return;
      }

      const preset = t.closest('[data-preset]');
      if (preset) {
        const p = preset.dataset.preset.split('|');
        addExpense({ amount: Number(p[1]), cat: p[2], note: p[0] });
        renderWallet();
        toast('已记录 ' + p[0] + ' CHF ' + fmtCHF(Number(p[1])));
        return;
      }

      const del = t.closest('[data-del-exp]');
      if (del) {
        saveExpenses(expenses().filter((x) => x.id !== del.dataset.delExp));
        renderWallet();
        toast('已删除');
        return;
      }

      const clear = t.closest('[data-clear-ledger]');
      if (clear) {
        openSheet('清空账目', '此操作不可撤销', 
          '<div style="font-size:13.5px;line-height:1.7;color:var(--ink-2);margin-bottom:16px">' +
          '将删除本机记录的全部 ' + expenses().length + ' 笔开销。确定继续吗？</div>' +
          '<button class="btn block primary" id="doClear" style="background:#c0392b">确定清空</button>',
          function () {
            $('#doClear').addEventListener('click', function () {
              saveExpenses([]); closeSheet(); renderWallet(); toast('已清空');
            });
          });
        return;
      }

      const cp = t.closest('[data-copy]');
      if (cp) {
        const txt = cp.dataset.copy;
        if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('已复制'), () => toast('复制失败'));
        else toast(txt);
        return;
      }

      const eb = t.closest('[data-edit-budget]');
      if (eb) {
        openSheet('行程预算', '用于记账页的进度条',
          '<div class="field"><label>预算金额 (CHF)</label>' +
          '<div class="amount-input"><span class="cur">CHF</span>' +
          '<input id="bIn" type="number" inputmode="decimal" value="' + budget() + '"></div>' +
          '<div class="hint">纯个人参考，不影响行程</div></div>' +
          '<button class="btn block primary" id="bSave" style="height:46px">保存</button>',
          function () {
            $('#bSave').addEventListener('click', function () {
              const v = parseFloat($('#bIn').value) || 0;
              store.set(K.budget, v); closeSheet(); renderWallet(); renderMore(); toast('预算已更新');
            });
          });
        return;
      }

      const er = t.closest('[data-edit-rates]');
      if (er) {
        const r = rates();
        openSheet('参考汇率', '仅用于显示换算，需手动更新',
          '<div class="field"><label>1 CHF = ? CNY</label><input id="rCny" type="number" step="0.01" value="' + r.cny + '"></div>' +
          '<div class="field"><label>1 CHF = ? EUR</label><input id="rEur" type="number" step="0.01" value="' + r.eur + '"></div>' +
          '<button class="btn block primary" id="rSave" style="height:46px">保存</button>',
          function () {
            $('#rSave').addEventListener('click', function () {
              store.set(K.rates, { cny: parseFloat($('#rCny').value) || 8.85, eur: parseFloat($('#rEur').value) || 1.06 });
              closeSheet(); renderWallet(); renderMore(); toast('汇率已更新');
            });
          });
        return;
      }

      const ex = t.closest('[data-export-csv]');
      if (ex) { exportCsv(); return; }

      const open = t.closest('[data-open]');
      if (open) {
        if (open.dataset.open === 'tickets') {
          setView('wallet');
          state.walletMode = 'tickets';
          $$('#walletSeg button').forEach((x) => x.classList.toggle('is-on', x.dataset.mode === 'tickets'));
          renderWallet();
          renderSlots();
        }
        return;
      }

      const ol = t.closest('[data-open-link]');
      if (ol) { window.open(ol.dataset.openLink, '_blank', 'noopener'); return; }

      const ap = t.closest('[data-add-photo]');
      if (ap) { pickPhoto(); return; }

      const dp = t.closest('[data-del-photo]');
      if (dp) {
        IDB.del(dp.dataset.delPhoto).then(function () { renderSlots(); toast('已删除照片'); });
        return;
      }

      const vp = t.closest('[data-photo]');
      if (vp) { viewPhoto(vp.dataset.photo); return; }

      const pr = t.closest('[data-print]');
      if (pr) { window.print(); return; }

      const rs = t.closest('[data-reset]');
      if (rs) {
        openSheet('清空本地数据', '不可撤销', 
          '<div style="font-size:13.5px;line-height:1.7;color:var(--ink-2);margin-bottom:16px">' +
          '将删除本机的账目记录、预算设置与票据照片。行程数据本身不受影响。</div>' +
          '<button class="btn block primary" id="doReset" style="background:#c0392b">确定清空</button>',
          function () {
            $('#doReset').addEventListener('click', async function () {
              saveExpenses([]);
              localStorage.removeItem(K.budget);
              localStorage.removeItem(K.rates);
              const items = await IDB.all();
              for (const it of items) await IDB.del(it.id);
              closeSheet(); renderMore(); toast('本地数据已清空');
            });
          });
        return;
      }
    });

    // hash routing
    const hash = (location.hash || '').replace('#', '');
    if (['today', 'itin', 'map', 'wallet', 'more'].indexOf(hash) >= 0) state.view = hash;
    window.addEventListener('hashchange', function () {
      const h = (location.hash || '').replace('#', '');
      if (['today', 'itin', 'map', 'wallet', 'more'].indexOf(h) >= 0 && h !== state.view) setView(h);
    });
  }

  /* ======================== clock ===================================== */
  function tickClock() {
    const p = zurichParts();
    const txt = p.hour + ':' + p.minute;
    $('#clockTime').textContent = txt;
    const el = $('#moreClock');
    if (el) el.textContent = txt;

    const h = Number(p.hour);
    $('#clockZone').textContent = h < 6 ? '瑞士 · 凌晨' : h < 12 ? '瑞士 · 上午' : h < 18 ? '瑞士 · 下午' : '瑞士 · 晚上';
  }

  /* ======================== boot ====================================== */
  function boot() {
    initSel();
    state.mapFilter = String(state.sel);
    bind();
    tickClock();
    setInterval(tickClock, 20000);

    // header subtitle
    const st = tripStatus();
    if (st.phase === 'before') $('#hdrSub').textContent = '距出发 ' + st.days + ' 天 · 8 天 7 晚';
    else if (st.phase === 'during') $('#hdrSub').textContent = '行程第 ' + (st.index + 1) + ' 天 / 共 ' + DAYS.length + ' 天';
    else $('#hdrSub').textContent = '行程已结束 · 8 天 7 晚';

    setView(state.view, { keepScroll: true });

    // weather: paint from cache immediately, then refresh in the background
    if (typeof WEATHER !== 'undefined') {
      WEATHER.loadCache();
      WEATHER.onUpdate(function () {
        if (state.view === 'today') renderHero();
        repaintWeatherSheet();
      });
      WEATHER.refresh();
    }

    // offline indicator
    const off = () => $('#offlineBar').classList.toggle('is-on', !navigator.onLine);
    window.addEventListener('online', off);
    window.addEventListener('offline', off);
    off();

    // service worker
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }

    // expose a little for debugging
    window.__swissTrip = { state, DAYS, HOTELS, BOOKINGS, setView, selectDay };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
