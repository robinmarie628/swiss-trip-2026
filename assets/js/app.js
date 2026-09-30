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

  // shown in "更多 · 这个工作台" so you can confirm which build is loaded.
  // Keep in step with VERSION in sw.js.
  const APP_VERSION = 'v1.7.14';

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

  /** Beijing time (China Standard Time, UTC+8, no DST) — independent of the trip TZ */
  function beijingParts(d) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const o = {};
    fmt.formatToParts(d || new Date()).forEach((p) => { if (p.type !== 'literal') o[p.type] = p.value; });
    if (o.hour === '24') o.hour = '00';
    return o;
  }

  /**
   * Combined "German · English" line for a named place/spot.
   * Most Swiss place names are already German, so if the German form equals the
   * English one we show it just once (no doubled text). Falls back to English when
   * no German is recorded.
   */
  function deEn(de, en) {
    de = de || '';
    en = en || '';
    if (!de) return en;
    if (!en) return de;
    if (de.toLowerCase() === en.toLowerCase()) return de;
    return de + ' · ' + en;
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
    mapRoute: true,
    mapReady: false,
    mapLayer: 'std',
    mapDirty: false,
    presetEdit: false,
    editorDay: 0,
    sorting: null,      // { dayId, kind } while long-press reordering
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

  const hotelById = (id) => HOTELS.filter((h) => h.id === id)[0] ||
    (typeof STORE !== 'undefined' && id ? STORE.customHotels()[id] : null) || null;
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

  /**
   * Xiaohongshu (RED) web search — only the fallback for when the app is not
   * installed. The site renders results client-side; the title comes back as
   * "<keyword> - 小红书搜索".
   */
  function xhsUrl(q) {
    return 'https://www.xiaohongshu.com/search_result?keyword=' +
      encodeURIComponent(String(q || '').trim());
  }

  /**
   * Xiaohongshu's app deeplink for a search, straight from RED's own deeplink
   * spec: xhsdiscover://search/result, with `keyword` required (+ optional
   * `source`). The web page is not the point — RED's mobile web search often
   * answers with "你访问的页面不见了", so hand the query to the app instead.
   */
  function xhsScheme(q) {
    return 'xhsdiscover://search/result?keyword=' +
      encodeURIComponent(String(q || '').trim()) + '&source=deeplink';
  }

  /**
   * Launch an app through its URL scheme without losing this page.
   *
   * A same-tab navigation to a custom scheme is handed to the OS; when the app
   * takes over, this page is backgrounded rather than unloaded. If nothing
   * takes over (app not installed) we fall back to the web version in a NEW
   * tab, so the workbench itself is never replaced.
   */
  function openAppScheme(scheme, fallbackUrl, appName) {
    const name = appName || 'App';
    let left = false;
    const onVis = function () { if (document.hidden) left = true; };
    document.addEventListener('visibilitychange', onVis);
    // A navigation is not a popup, so this is NOT blocked by popup blockers —
    // which is what makes it work when the route was resolved asynchronously.
    try { window.location.href = scheme; } catch (e) {}
    setTimeout(function () {
      document.removeEventListener('visibilitychange', onVis);
      if (!left && !document.hidden && fallbackUrl) {
        toast('没打开' + name + '，改用网页版');
        openExternal(fallbackUrl);
      }
    }, 1600);
  }

  /**
   * SBB Mobile's own URL scheme — the exact target SBB's universal-link landing
   * page forwards to (seen on app.sbbmobile.ch/timetable: "Open the link" →
   * sbbmobile://timetable?…). Used whenever the route was resolved after an
   * await, where a programmatic window.open / anchor click is popup-blocked.
   */
  function sbbScheme(fromSt, toSt) {
    const o = encodeURIComponent((fromSt && fromSt.name) || '');
    const d = encodeURIComponent((toSt && toSt.name) || '');
    return 'sbbmobile://timetable?from=' + o + '&to=' + d;
  }

  /** hand two stops to SBB Mobile, falling back to the web timetable */
  function openSbbApp(fromSt, toSt) {
    openAppScheme(sbbScheme(fromSt, toSt), sbbUrl(fromSt, toSt), 'SBB App');
  }

  /**
   * Build a Google Maps transit-directions URL from two resolveRef() results.
   * Prefers lat,lng when we have them; falls back to the place name (Google
   * will geocode). `travelmode=transit` covers bus, rail, and the SBB network.
   */
  function gmapsTransitUrl(fromRef, toRef) {
    const enc = function (r) {
      if (!r) return '';
      if (r.lat != null && r.lng != null) return r.lat + ',' + r.lng;
      return r.name || '';
    };
    const o = encodeURIComponent(enc(fromRef));
    const d = encodeURIComponent(enc(toRef));
    return 'https://www.google.com/maps/dir/?api=1' +
      '&origin=' + o + '&destination=' + d + '&travelmode=transit';
  }

  /**
   * Open an external link in a new tab — and NEVER in this one.
   *
   * A real anchor with target="_blank" is how every other external link in this
   * app is opened, and it is the only form that cannot accidentally replace the
   * app. It matters: `window.open(url, '_blank', 'noopener')` returns null by
   * spec, so an earlier `if (!w) location.href = url` fallback fired on *every*
   * tap and navigated the app itself to Google Maps / the SBB deep link — which
   * is exactly why the app came back blank afterwards.
   *
   * Call synchronously from within a tap so the browser still counts it as a
   * user gesture (a delayed open gets popup-blocked on mobile).
   */
  function openExternal(url) {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
  }

  /**
   * Build an SBB Mobile deep link. `app.sbbmobile.ch` is SBB's universal-link
   * handler: on a phone it opens the SBB Mobile app with the chosen stations
   * pre-filled; if the app isn't installed it falls back to the SBB web
   * timetable (which shows App Store / Play Store links). Stations only — SBB
   * cannot route to a hotel name or a bare address.
   *
   * Deliberately carries NO date/time. SBB's app only half-supports them: the
   * universal link accepts a `date`/`time` pair, but any value it can't parse
   * (including the quote-wrapped `date="2026-10-04"` form its own deep-link
   * generator emits) makes it fall back to the Unix epoch — the traveller saw
   * "Jan 1, 01:00". Omitting them makes the app open on the current time, which
   * is the sane default; the day/time can be adjusted inside the app.
   */
  function sbbUrl(fromSt, toSt) {
    const o = encodeURIComponent((fromSt && fromSt.name) || '');
    const d = encodeURIComponent((toSt && toSt.name) || '');
    return 'https://app.sbbmobile.ch/timetable?from=' + o + '&to=' + d;
  }

  /**
   * The stations to hand SBB for one looked-up connection: where you actually
   * board the first vehicle and leave the last one. The timetable engine already
   * resolved these, so they are real stops SBB can find — unlike the
   * connection's own origin, which may be a street address. Falls back to the
   * connection's endpoints when there is nothing to ride.
   */
  function connectionStations(c) {
    const rides = ((c && c.sections) || []).filter(function (s) { return s.kind === 'ride'; });
    if (rides.length) {
      return { board: rides[0].from, alight: rides[rides.length - 1].to };
    }
    return { board: (c && c.fromName) || '', alight: (c && c.toName) || '' };
  }

  /** the connection list renders below the fold — bring it into view so a tap
      visibly does something instead of looking like it failed */
  function scrollResultsIntoView() {
    const box = $('#tpResults');
    if (!box) return;
    setTimeout(function () {
      try { box.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      catch (e) { box.scrollIntoView(); }
    }, 80);
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
        '<div class="hero-route"><span class="hr-tx">' + esc(day.title) +
          '<span class="arrow">·</span><span class="en">' + esc(day.titleEn) + '</span></span>' +
          '<button class="hero-edit" data-day-meta="1" aria-label="编辑这一天的城市与文字">' +
            icon('edit') + '</button>' +
        '</div>' +
        '<div class="hero-sum">' + esc(day.summary) + '</div>' +
        (typeof WEATHER !== 'undefined'
          ? '<div class="wx-wrap"><div class="wx-head">' +
              '<span class="wx-head-t">' + icon('sun') + '天气</span>' +
              '<button class="wx-swap" data-day-meta="1">' + icon('edit') + '换城市</button>' +
            '</div>' + WEATHER.panelHtml(day) + '</div>'
          : '') +
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
    }).join('') +
      '<button class="dchip dchip-add" data-add-day="1" aria-label="添加一天">' +
        '<div class="dchip-plus">' + icon('plus') + '</div>' +
        '<div class="m">添加一天</div>' +
      '</button>';
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
  /** ↑/↓ controls shown while a list is in sorting mode */
  function sortBtns(kind, key) {
    return '<div class="sortbtns">' +
      '<button class="sortbtn" data-move-kind="' + kind + '" data-move-dir="-1" ' +
        'data-move-key="' + esc(key) + '" aria-label="上移">' + icon('up') + '</button>' +
      '<button class="sortbtn" data-move-kind="' + kind + '" data-move-dir="1" ' +
        'data-move-key="' + esc(key) + '" aria-label="下移">' + icon('down') + '</button>' +
    '</div>';
  }

  function timelineBare(day, sorting) {
    return '<div class="tl">' + day.blocks.map(function (b) {
      const dup = String(b.label) === String(b.time);
      const key = b.time + '|' + b.label;
      // data-hold is always present: it is the long-press target that *starts*
      // sorting mode, so it cannot depend on sorting already being on
      return '<div class="tl-item' + (sorting ? ' is-sortable' : '') + '"' +
        ' data-hold="1" data-sort-key="' + esc(key) + '">' +
        '<div class="tl-time">' + esc(b.time) + '</div>' +
        '<div class="tl-body">' +
          (dup ? '' : '<div class="tl-label">' + esc(b.label) + '</div>') +
          '<div class="tl-text">' + esc(b.text) + '</div>' +
        '</div>' +
        (sorting ? sortBtns('b', key) : '') +
      '</div>';
    }).join('') + '</div>';
  }

  /** a leg's identity — must match STORE.keyOf('t', …) */
  function legKeyOf(t) {
    return String(t.from || '') + '→' + String(t.to || '') + '|' + String(t.mode || '');
  }

  function legsBare(day, sorting) {
    const r = regionOf(day);
    return day.transport.map(function (t) {
      const key = legKeyOf(t);
      const route = t.to
        ? esc(t.from) + ' <span class="arrow">→</span> ' + esc(t.to)
        : esc(t.from || '');
      const parts = [];
      if (t.mode) parts.push(esc(t.mode));
      if (t.duration) parts.push(esc(t.duration));
      if (t.note) parts.push(esc(t.note));
      return '<div class="leg' + (sorting ? ' is-sortable' : '') + '" style="' + tintStyle(r) + '"' +
          ' data-hold="1" data-sort-key="' + esc(key) + '">' +
        '<div class="leg-rail"><span class="nub"></span><span class="bar"></span></div>' +
        '<div class="leg-body">' +
          (route ? '<div class="leg-route">' + route + '</div>' : '') +
          (parts.length ? '<div class="leg-meta">' + parts.join('<span class="sep"></span>') + '</div>' : '') +
          (t.booked
            ? '<div class="leg-booked">' + icon('check') +
              '<span>已预订</span><span class="t">' + esc(t.booked) + ' 发车</span></div>'
            : (t.time
              ? '<div class="leg-time">' + icon('clock') + '<span>' + esc(t.time) + ' 出发</span></div>'
              : '')) +
        '</div>' +
        (sorting ? sortBtns('t', key) : '') +
      '</div>';
    }).join('');
  }

  function hotelBare(hotel, day) {
    if (!hotel) {
      // the last itinerary day ends with a flight home; any other day without a
      // stay (e.g. one the traveller just added) just has none recorded yet
      const isReturn = day && day.id === (DAYS[DAYS.length - 1] || {}).id;
      return '<div class="hotel">' +
        '<span class="hotel-pic" style="--tint:#5A6572;--tint-soft:#EDEFF2">' +
          icon(isReturn ? 'plane' : 'bed') + '</span>' +
        '<div class="hotel-tx"><b>' + (isReturn ? '无住宿 · 当天返程' : '未设置住宿') + '</b>' +
          '<div class="addr">' + (isReturn ? '回程航班 CA862 · 日内瓦 13:20 起飞'
            : '点下方「设置住宿」填入酒店，可导航与查看地址') + '</div></div>' +
      '</div>';
    }
    const r = REGIONS[hotel.region] || REGIONS.transit;
    const dates = [];
    if (hotel.nightsText) dates.push('<span class="badge tint">' + icon('cal') + esc(hotel.nightsText) + '</span>');
    if (hotel.checkIn) dates.push('<span class="badge">入住 ' + esc(String(hotel.checkIn).replace('-', '/')) + '</span>');
    if (hotel.checkOut) dates.push('<span class="badge">退房 ' + esc(String(hotel.checkOut).replace('-', '/')) + '</span>');
    return '<div class="hotel" style="' + tintStyle(r) + '">' +
      '<span class="hotel-pic">' + icon('bed') + '</span>' +
      '<div class="hotel-tx">' +
        '<b>' + esc(hotel.name) + '</b>' +
        (hotel.address ? '<div class="addr">' + esc(hotel.address) + '</div>' : '') +
        (dates.length ? '<div class="hotel-badges">' + dates.join('') + '</div>' : '') +
      '</div>' +
    '</div>' +
    (hotel.note ? '<div style="margin-top:11px;font-size:12.5px;line-height:1.6;color:var(--muted)">' +
      esc(hotel.note) + '</div>' : '') +
    '<div class="btn-row" style="margin-top:12px">' +
      (hotel.lat != null
        ? '<button class="btn sm primary" data-hotel-nav="' + hotel.id + '">' + icon('nav') + '导航</button>'
        : '') +
      (hotel.address
        ? '<button class="btn sm ghost" data-copy="' + esc(hotel.address) + '">复制地址</button>'
        : '') +
      (hotel.lat != null
        ? '<button class="btn sm ghost" data-hotel-map="' + hotel.id + '">在地图查看</button>'
        : '') +
      '<button class="btn sm ghost" data-hotel-edit="' + esc(day ? day.id : '') + '">' +
        icon('edit') + (hotel.custom ? '编辑住宿' : '更换住宿') + '</button>' +
    '</div>';
  }

  function placesBare(day, di, sorting) {
    const r = regionOf(day);
    const idx = di == null ? state.sel : di;
    return day.places.map(function (p, i) {
      return '<div class="place-row' + (sorting ? ' is-sortable' : '') + '"' +
        ' data-hold="1" data-sort-key="' + esc(p.name) + '">' +
        '<button class="place" data-place="' + idx + ':' + i + '" style="' + tintStyle(r) + '">' +
          '<span class="place-ic">' +
            icon(p.kind === 'transit' ? 'train' : (p.kind === 'area' ? 'map' : 'pin')) + '</span>' +
          '<span class="place-tx"><b>' + esc(p.name) + '</b><span>' + esc(deEn(p.nameDe, p.nameEn)) +
            (p.note ? ' · ' + esc(p.note) : '') + '</span></span>' +
          '<span class="place-go">' + icon('chev') + '</span>' +
        '</button>' +
        (sorting ? sortBtns('p', p.name) : '') +
      '</div>';
    }).join('');
  }

  function tipsBare(day) {
    return day.tips.map(function (t, i) {
      return '<div class="note-item"><span class="num">' + (i + 1) + '</span><span>' + esc(t) + '</span></div>';
    }).join('');
  }

  /* ---- card wrappers ------------------------------------------------ */
  function timelineCard(day) {
    const sorting = sortingThis('b', day.id);
    const auto = STORE.sortMode(day.id) === 'auto';
    const sub = sorting ? '' : (auto ? '长按可调整顺序 · 现在按时间自动排' : '长按可调整顺序 · 当前为手动顺序');
    return '<div class="card">' +
      cardHead(regionOf(day), 'clock', '今日行程', day.headline,
        '<div class="rt"><button class="btn sm ghost" data-edit-day="1">' +
          icon('plus') + '编辑</button></div>') +
      (sorting ? sortBarHtml(day.id, 'b') : '<div class="card-note">' + esc(sub) + '</div>') +
      '<div class="card-bd tight" id="tlList">' + timelineBare(day, sorting) + '</div></div>';
  }

  function transportCard(day, title, withAll) {
    const sorting = sortingThis('t', day.id);
    const auto = STORE.sortMode(day.id, 't') === 'auto';
    const sub = auto ? '长按可调整顺序 · 现在按发车时间排' : '长按可调整顺序 · 当前为手动顺序';
    const right = '<div class="rt">' +
      (withAll ? '<button class="btn sm ghost" data-all-bookings="1">全部车次</button>' : '') +
      '<button class="btn sm ghost" data-add-leg-day="1">' + icon('plus') + '</button>' +
      '</div>';
    return '<div class="card">' +
      cardHead(regionOf(day), 'train', title || '交通', '时间均为约数 · 以 SBB App 为准', right) +
      (sorting ? sortBarHtml(day.id, 't') : '<div class="card-note">' + esc(sub) + '</div>') +
      '<div class="card-bd tight" id="legList">' + legsBare(day, sorting) + '</div></div>';
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
    const r = hotel ? (REGIONS[hotel.region] || REGIONS.transit) : regionOf(day);
    return '<div class="card">' +
      cardHead(r, 'bed', hotel ? '今晚住宿' : '住宿', hotel ? hotel.city : '未设置住宿') +
      '<div class="card-bd">' + hotelBare(hotel, day) +
        (hotel ? '' :
          '<div class="btn-row" style="margin-top:12px">' +
            '<button class="btn sm primary" data-hotel-edit="' + esc(day.id) + '">' +
              icon('plus') + '设置住宿</button>' +
          '</div>') +
      '</div></div>';
  }

  function placesCard(day, title) {
    const sorting = sortingThis('p', day.id);
    return '<div class="card">' +
      cardHead(regionOf(day), 'pin', title || '今日地点', '共 ' + day.places.length + ' 处',
        '<div class="rt"><button class="btn sm ghost" data-add-place-day="1">' +
          icon('plus') + '添加</button></div>') +
      (sorting ? sortBarHtml(day.id, 'p') : '<div class="card-note">长按地点可调整顺序</div>') +
      '<div class="card-bd tight" id="placeList">' +
        (day.places.length ? placesBare(day, null, sorting) : '<div class="egroup-empty">还没有地点，点「添加」搜索</div>') +
      '</div></div>';
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
        '<button class="btn sm ghost" data-edit-day="1">' + icon('plus') + '编辑行程</button>' +
        '<button class="btn sm ghost" data-add-place-day="1">' + icon('pin') + '添加地点</button>' +
        '<button class="btn sm ghost" data-wx-open="1">' + icon('sun') + '天气详情</button>' +
        '<button class="btn sm ghost" data-go="wallet">' + icon('coins') + '今日记账</button>' +
        '<button class="btn sm ghost" data-go="map">' + icon('map') + '打开地图</button>' +
        '<button class="btn sm ghost" data-open="tickets">' + icon('qr') + '出示票据</button>' +
      '</div></div></div></div>';

    $('#todayBody').innerHTML = html;
    renderHero();
    renderChips();

    // long-press to reorder the timeline, the place list and the transport legs
    attachHold($('#tlList'), day.id, 'b');
    attachHold($('#placeList'), day.id, 'p');
    attachHold($('#legList'), day.id, 't');
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
  // every marker of the current render, keyed by coordinate, so tapping a row
  // in the list can find and animate the matching pin
  let mapMarkers = [];
  // the suggested visiting order for the current map filter, or null.
  // { filter, order: [placeIdx…], km } — cleared when the filter changes.
  let mapSuggest = null;

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

  /** red camera pin — photo spots are a different shape and colour from the
      numbered stop pins so they never read as part of the walking route. When a
      spot carries its own photo (stored in IndexedDB) we draw the photo itself
      as a round thumbnail instead, so the capture is visible at a glance. */
  function makePhotoPin(s) {
    if (s && s._photoUrl) {
      return L.divIcon({
        className: '',
        html: '<div class="pin photo thumb" style="background-image:url(\'' + s._photoUrl + '\')"></div>',
        iconSize: [30, 30],
        iconAnchor: [15, 33],
        popupAnchor: [0, -31],
      });
    }
    return L.divIcon({
      className: '',
      html: '<div class="pin photo">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-2h7.2l1.2 2h1.7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5Z"/>' +
        '<circle cx="12" cy="13" r="3.6"/></svg></div>',
      // the pin is a teardrop rotated -45°, so its tip sits ~6px below the box
      iconSize: [28, 28],
      iconAnchor: [14, 34],
      popupAnchor: [0, -34],
    });
  }

  function photoPopupHtml(s) {
    const u = navUrl(s.lat, s.lng, s.name);
    const img = (s && s._photoUrl) ? '<img class="pop-photo" src="' + s._photoUrl + '" alt="' + esc(s.name) + '">' : '';
    return img +
      '<b>' + esc(s.name) + '</b>' +
      (s.nameDe || s.nameEn ? '<div class="pop-sub">' + esc(deEn(s.nameDe, s.nameEn)) + '</div>' : '') +
      (s.best ? '<div class="pop-note">最佳时机 · ' + esc(s.best) + '</div>' : '') +
      (s.tip ? '<div class="pop-note">' + esc(s.tip) + '</div>' : '') +
      '<div class="pop-acts">' +
        '<a class="btn sm primary" href="' + u.google + '" target="_blank" rel="noopener">导航</a>' +
        '<button class="btn sm ghost" data-photo-copy="' + esc(s.id) + '">复制地址</button>' +
        '<button class="btn sm ghost" data-photo-hide="' + esc(s.id) + '">' +
          (s._user ? '删除' : '隐藏') + '</button>' +
      '</div>';
  }

  /** find a photo spot by id, hidden ones included */
  function photoById(id) {
    return (typeof PHOTO_SPOTS !== 'undefined' ? PHOTO_SPOTS : [])
      .concat(STORE.raw().photoSpots || [])
      .filter(function (s) { return s.id === id; })[0] || null;
  }

  /** the action sheet behind a photo spot — reachable from the map list */
  /**
   * The action sheet behind a photo spot. For spots that carry a photo (taken
   * with the camera / uploaded), the image is pulled from IndexedDB and shown
   * at the top so the capture is visible without leaving the sheet.
   */
  async function photoSheet(s) {
    const u = navUrl(s.lat, s.lng, s.name);
    const dn = s.day ? (DAYS.filter(function (d) { return d.id === s.day; })[0] || null) : null;

    let photoHtml = '';
    if (s.photoId && typeof IDB !== 'undefined') {
      try {
        const items = await IDB.all();
        const it = items.filter(function (x) { return x.id === s.photoId; })[0];
        if (it) {
          photoHtml = '<div class="sheet-photo"><img src="' + URL.createObjectURL(it.blob) +
            '" alt="' + esc(s.name) + '"></div>';
        }
      } catch (e) {}
    }

    openSheet(s.name, [deEn(s.nameDe, s.nameEn), dn ? dn.dow + ' · ' + dn.title : '通用'].filter(Boolean).join(' · '),
      photoHtml +
      (s.best ? '<div class="photo-tip"><b>最佳时机</b><span>' + esc(s.best) + '</span></div>' : '') +
      (s.tip ? '<div class="photo-tip"><b>小贴士</b><span>' + esc(s.tip) + '</span></div>' : '') +
      '<div class="btn-row" style="display:grid;gap:9px;margin-top:14px">' +
        '<a class="btn block primary" href="' + u.google + '" target="_blank" rel="noopener">' +
          icon('nav') + 'Google 地图导航</a>' +
        '<a class="btn block" href="' + u.apple + '" target="_blank" rel="noopener">' +
          icon('nav') + 'Apple 地图导航</a>' +
        '<button class="btn block ghost" data-xhs="' + esc(s.name) + '">' +
          icon('globe') + '在小红书搜「' + esc(s.name) + '」</button>' +
        '<button class="btn block ghost" data-photo-copy="' + esc(s.id) + '">' +
          icon('link') + '复制地址</button>' +
        '<button class="btn block ghost" data-photo-map="' + esc(s.id) + '">' +
          icon('map') + '在工作台地图中查看</button>' +
        '<button class="btn block ghost" data-photo-hide="' + esc(s.id) + '">' +
          icon(s._user ? 'trash' : 'x') + (s._user ? '删除这个拍照点' : '隐藏这个拍照点') + '</button>' +
      '</div>', null, 'photo');
  }

  /**
   * Copy a photo spot's address. The curated spots only carry coordinates, so
   * the address is reverse-geocoded on first use and then cached — after that
   * it works with no connection.
   */
  function copyPhotoAddress(s) {
    const cached = STORE.cachedAddress(s.lat, s.lng);
    if (cached) { copyText(cached, '地址已复制'); return; }

    const fallback = s.name + ' · ' + s.lat + ', ' + s.lng;
    if (typeof SERVICES === 'undefined' || !SERVICES.reverseGeocode) {
      copyText(fallback, '已复制名称与坐标');
      return;
    }
    toast('正在解析地址…');
    SERVICES.reverseGeocode(s.lat, s.lng).then(function (addr) {
      STORE.setAddress(s.lat, s.lng, addr);
      copyText(addr, '地址已复制');
    }).catch(function () {
      // no network, or nothing mapped there: the coordinates still work
      copyText(fallback, '已复制名称与坐标');
    });
  }

  function copyText(txt, okMsg) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(
        function () { toast(okMsg || '已复制'); },
        function () { toast(txt); });
    } else toast(txt);
  }

  /** which photo spots to draw for the current map filter */
  function photoSpotsInView(days) {
    if (!STORE.photosVisible()) return [];
    const ids = days.map(function (i) { return DAYS[i].id; });
    return STORE.allPhotoSpots().filter(function (s) {
      return !s.day || ids.indexOf(s.day) >= 0;
    });
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

  /** great-circle distance in km — good enough to rank walking/riding hops */
  function haversineKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /** rough door-to-door minutes for a hop: walk the short ones, ride the rest */
  function hopMinutes(a, b) {
    const km = haversineKm(a, b);
    if (km <= 1.2) return (km / 4.5) * 60;   // on foot
    return 6 + (km / 18) * 60;               // ~6 min waiting, then ride
  }

  /**
   * The time of day a sight asks for, read from hints ALREADY in the data
   * (a place's note, a photo spot's 最佳时机). No network, no guessing — if
   * the data says nothing we simply do not constrain that point.
   */
  /* Every window in this file is MINUTES past midnight — the traveller's own
     requirement is stored that way, so the hints must be too. Mixing hours and
     minutes here silently broke the penalty maths once. */
  function preferredWindow(p) {
    const s = String((p && p.note) || '') + ' ' + String((p && p.best) || '') +
      ' ' + String((p && p.name) || '');
    const h = function (a, b) { return [a * 60, b * 60]; };
    if (/清晨|早上|上午|日出/.test(s)) return h(6, 12);
    if (/中午|午间/.test(s)) return h(11, 14);
    if (/下午/.test(s)) return h(12, 18);
    if (/傍晚|黄昏|日落|夕阳/.test(s)) return h(16, 21);
    if (/夜景|夜晚|夜/.test(s)) return h(19, 23);
    return null;
  }

  /**
   * How long a stop usually takes. A day is mostly spent AT the sights, not
   * travelling between them, so a schedule that counts only travel claims
   * "大喷泉 08:53 → 花钟 08:59", i.e. six minutes for a fountain. Kind is
   * already in the data, so use it.
   */
  function dwellMinutes(p) {
    const k = (p && p.kind) || 'sight';
    if (k === 'transit') return 10;
    if (k === 'area') return 30;
    return 45;
  }

  const DAY_START = 8 * 60 + 30;   // default: leave the hotel at 08:30
  const TRANSFER = 20;             // station → first sight, and sight → station

  /**
   * "约 2 小时 27 分" / "约 12 分钟" / "2.5 小时" / "150 分钟" → minutes, or
   * null when unparseable. The decimal case matters: someone typing "2.5 小时"
   * must not be read as "5 小时".
   */
  function parseDuration(txt) {
    const s = String(txt || '');
    const h = /(\d+(?:[.,]\d+)?)\s*(?:小时|个小时|h\b)/i.exec(s);
    const m = /(\d+(?:[.,]\d+)?)\s*分/.exec(s);
    if (!h && !m) return null;
    const hm = h ? Number(String(h[1]).replace(',', '.')) * 60 : 0;
    const mm = m ? Number(String(m[1]).replace(',', '.')) : 0;
    return Math.round(hm + mm);
  }

  /**
   * The hours a day genuinely leaves for sightseeing.
   *
   * A travel day's morning is spent on a train: on 8 Oct the plan reads
   * "Lauterbrunnen 09:31 → Zürich HB, 约 2 小时 27 分", so nothing in Zürich
   * can be visited before ~12:20. That is already stated in the itinerary
   * (transport[].booked + duration) — the optimiser just has to read it
   * instead of packing every sight into a morning that does not exist.
   *
   * A booked leg departing before 15:00 is "the day moves here" → touring
   * starts after arrival (+ a transfer to the first sight). A later one is
   * "the day has to leave" → touring must end before it.
   */
  function dayWindow(d) {
    let start = DAY_START, end = null, note = '';
    // Legs added in the app land in DAYS[].transport too (store.apply merges
    // them), so a train the traveller adds later is picked up automatically.
    ((d && d.transport) || []).forEach(function (l) {
      if (!l) return;
      const at = l.booked || l.time;        // booked is authoritative; time is a plan
      if (!at) return;
      const dur = parseDuration(l.duration);
      // `time` is set on plain walks as well, so only trust it for legs long
      // enough to be an actual move; an explicit `booked` always counts.
      if (!l.booked && (dur == null || dur < 30)) return;
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(at));
      if (!m) return;
      const dep = Number(m[1]) * 60 + Number(m[2]);
      const how = l.booked ? '已订' : '计划';
      if (dep < 15 * 60) {
        const arr = dep + (dur == null ? 60 : dur) + TRANSFER;
        if (arr > start) {
          start = arr;
          note = '当天 ' + at + '（' + how + '）从 ' + l.from + ' 出发前往 ' + l.to +
            (dur != null ? '（约 ' + (Math.round(dur / 6) / 10) + ' 小时）' : '') +
            '，约 ' + fmtClock(arr) + ' 才能开始游览';
        }
      } else {
        const lim = dep - TRANSFER;
        if (end == null || lim < end) {
          end = lim;
          note = (note ? note + '；' : '') + '当天 ' + at + '（' + how + '）要离开 ' +
            l.from + '，需在 ' + fmtClock(lim) + ' 前结束游览';
        }
      }
    });
    return { start: start, end: end, note: note };
  }

  /**
   * Score a visiting order the way the day is actually lived, not on the map:
   * total elapsed minutes door to door (walking short hops, waiting for the
   * ones you ride) plus a penalty for reaching a sight outside the time of day
   * it asks for. Distance alone is misleading — a 2 km tram hop with a wait can
   * look cheaper than two short walks but cost more of the day.
   */
  function tourCost(order, pts, D, hop, win) {
    const from = (win && win.start) || DAY_START;
    const until = (win && win.end) || null;
    let clock = from, prev = 0, km = 0;
    const stops = [];
    order.forEach(function (i) {
      const q = i + 1;
      clock += hop[prev][q];
      km += D[prev][q];
      const w = pts[q].win;              // minutes past midnight
      if (w) {
        // a window the traveller set themselves outranks a hint from the data
        const weight = pts[q].hard ? 3 : 1;
        if (clock < w[0]) clock += (w[0] - clock) * 0.6 * weight;   // early: idle
        else if (clock > w[1]) clock += (clock - w[1]) * weight;    // late: penalise
      }
      const at = clock;
      clock += pts[q].dwell;
      stops.push({ i: i, at: at, until: clock });
      prev = q;
    });
    clock += hop[prev][0];
    km += D[prev][0];
    // missing a booked departure is worse than any detour
    const over = (until != null && clock > until) ? (clock - until) * 4 : 0;
    return {
      score: (clock - from) + over,
      free: clock - from,
      km: km, stops: stops, backAt: clock,
    };
  }

  /**
   * Suggest a visiting order for one day: start and finish at the day's hotel,
   * see every sight once, and minimise the day it actually costs (see
   * tourCost) rather than raw distance.
   *
   * Up to 8 sights we solve it EXACTLY — ≤ 40 320 tours over precomputed
   * distance/time matrices, a few milliseconds. Nearest-neighbour + 2-opt is
   * not good enough here: measured against the real Geneva day it returned
   * 12.5 km where the traveller's own order was 11.8 km, i.e. a "suggestion"
   * worse than doing nothing. Days never hold more than ~8 sights, so exact it
   * is; anything larger falls back to the heuristic.
   *
   * The itinerary's own order is always scored too, so the result can never be
   * worse than what the traveller already planned.
   */
  function suggestOrder(hotel, places, dayId, win) {
    if (!hotel || !places.length) return null;
    const pts = [{ lat: hotel.lat, lng: hotel.lng, win: null, dwell: 0, hard: false }]
      .concat(places.map(function (p) {
        // a window the traveller set wins over the hint baked into the data
        const own = dayId ? STORE.placeTime(dayId, p.name) : null;
        return {
          lat: p.lat, lng: p.lng,
          win: own || preferredWindow(p),
          hard: !!own,
          dwell: dwellMinutes(p),
        };
      }));
    const D = pts.map(function (a) {
      return pts.map(function (b) { return haversineKm(a, b); });
    });
    const hop = pts.map(function (a) {
      return pts.map(function (b) { return hopMinutes(a, b); });
    });
    const idx = places.map(function (_, i) { return i; });
    let best = null;
    const consider = function (ord) {
      const c = tourCost(ord, pts, D, hop, win);
      if (!best || c.score < best.score - 1e-9) {
        best = {
          order: ord.slice(), score: c.score, minutes: c.free,
          km: c.km, stops: c.stops, backAt: c.backAt,
        };
      }
    };

    consider(idx);                                  // never worse than the plan

    if (places.length <= 8) {
      const walk = function (rest, cur) {
        if (!rest.length) { consider(cur); return; }
        for (let i = 0; i < rest.length; i++) {
          walk(rest.slice(0, i).concat(rest.slice(i + 1)), cur.concat([rest[i]]));
        }
      };
      walk(idx, []);
    } else {
      let left = idx.slice(), cur = 0, tour = [];
      while (left.length) {
        let bi = 0, bd = Infinity;
        for (let k = 0; k < left.length; k++) {
          const d = hop[cur][left[k] + 1];
          if (d < bd) { bd = d; bi = k; }
        }
        cur = left.splice(bi, 1)[0] + 1;
        tour.push(cur - 1);
      }
      consider(tour);
      let improved = true, guard = 0;
      while (improved && guard++ < 40) {
        improved = false;
        for (let i = 0; i < tour.length - 1; i++) {
          for (let j = i + 1; j < tour.length; j++) {
            const cand = tour.slice(0, i).concat(tour.slice(i, j + 1).reverse(), tour.slice(j + 1));
            if (tourCost(cand, pts, D, hop, win).score < tourCost(tour, pts, D, hop, win).score - 1e-9) {
              tour = cand;
              improved = true;
            }
          }
        }
        consider(tour);
      }
    }
    return best;
  }

  /** 09:05 — the suggested schedule is shown in local clock time */
  function fmtClock(mins) {
    const m = Math.round(mins);
    return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' +
      String(m % 60).padStart(2, '0');
  }

  /** direction arrows along a polyline — bearings are clockwise from north */
  function bearingDeg(a, b) {
    const rad = Math.PI / 180;
    const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
    const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
      Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }

  function addArrows(latlngs, color) {
    if (latlngs.length < 2) return;
    const segs = [];
    let total = 0;
    for (let i = 0; i < latlngs.length - 1; i++) {
      const a = { lat: latlngs[i][0], lng: latlngs[i][1] };
      const b = { lat: latlngs[i + 1][0], lng: latlngs[i + 1][1] };
      const d = haversineKm(a, b);
      segs.push({ a: a, b: b, d: d });
      total += d;
    }
    if (total <= 0) return;
    const FRACTIONS = [0.18, 0.42, 0.66, 0.9];
    FRACTIONS.forEach(function (f) {
      let want = total * f;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (want <= s.d || i === segs.length - 1) {
          const t = s.d > 0 ? Math.min(1, want / s.d) : 0;
          const lat = s.a.lat + (s.b.lat - s.a.lat) * t;
          const lng = s.a.lng + (s.b.lng - s.a.lng) * t;
          L.marker([lat, lng], {
            interactive: false,
            zIndexOffset: 300,
            icon: L.divIcon({
              className: '',
              html: '<div class="route-arrow" style="--c:' + color + ';' +
                'transform:rotate(' + bearingDeg(s.a, s.b).toFixed(1) + 'deg)"><i></i></div>',
              iconSize: [12, 12],
              iconAnchor: [6, 6],
            }),
          }).addTo(overlayGroup);
          return;
        }
        want -= s.d;
      }
    });
  }

  /** toggle the suggestion for the current filter; recomputed every time */
  function toggleSuggest() {
    const di = Number(state.mapFilter);
    if (isNaN(di)) {
      toast('先选一天，再规划建议路线');
      return;
    }
    if (mapSuggest && mapSuggest.filter === state.mapFilter) {
      mapSuggest = null;
      renderMapContent();
      toast('已隐藏建议路线');
      return;
    }
    const d = DAYS[di];
    const h = hotelById(d.hotelId);
    if (!h) { toast('这一天没有酒店，无法以酒店为起终点规划'); return; }
    if (!d.places.length) { toast('这一天还没有景点'); return; }
    // a day that starts with a train cannot start sightseeing at 08:30
    const win = dayWindow(d);
    const s = suggestOrder(h, d.places, d.id, win);
    if (!s) { toast('没有可规划的点'); return; }
    mapSuggest = {
      filter: state.mapFilter, order: s.order, km: s.km,
      minutes: s.minutes, stops: s.stops, backAt: s.backAt, win: win,
    };
    renderMapContent();
    const sameAsPlan = s.order.every(function (v, i) { return v === i; });
    toast(sameAsPlan
      ? '行程顺序已经是最优的（约 ' + Math.round(s.minutes) + ' 分钟）'
      : '建议路线：' + d.places.length + ' 个点 · 约 ' + Math.round(s.minutes) + ' 分钟');
    openSuggestSheet(d, h, s, sameAsPlan, win);
  }

  /** the suggested order as a small timetable, so the day is judgeable */
  function openSuggestSheet(d, h, s, sameAsPlan, win) {
    const start = (win && win.start) || DAY_START;
    let unmet = 0;
    const rows = s.stops.map(function (st, k) {
      const p = d.places[st.i];
      const own = STORE.placeTime(d.id, p.name);
      const w = own || preferredWindow(p);          // both in minutes
      const bad = !!w && (st.at > w[1] || st.at < w[0] - 1);
      if (bad && own) unmet++;
      return '<div class="kv"><span class="k">' + (k + 1) + '</span>' +
        '<span class="v">' + esc(fmtClock(st.at)) + '–' + esc(fmtClock(st.until)) +
        ' · ' + esc(p.name) +
        (own
          ? ' <b>要求 ' + esc(fmtClock(own[0])) + '–' + esc(fmtClock(own[1])) + '</b>'
          : (w ? ' <span style="color:var(--muted)">（宜 ' + esc(fmtClock(w[0])) + '–' +
              esc(fmtClock(w[1])) + '）</span>' : '')) +
        (bad ? ' <b style="color:#c0392b">' + (own ? '未满足' : '偏晚') + '</b>' : '') +
        '</span></div>';
    }).join('');

    openSheet('建议路线', '起终点：' + h.name,
      (win && win.note
        ? '<div style="font-size:13px;line-height:1.7;color:var(--ink-2);margin-bottom:12px;' +
          'padding:10px 12px;border-radius:8px;background:var(--surface-2)">' +
          icon('train') + ' ' + esc(win.note) + '</div>'
        : '') +
      (sameAsPlan
        ? '<div style="font-size:13.5px;line-height:1.7;color:var(--ink-2);margin-bottom:12px">' +
          '你现在的顺序已经是最优的，没有可改进的空间。</div>'
        : '') +
      '<div class="card"><div class="card-bd tight">' +
        '<div class="kv"><span class="k">出发</span><span class="v">' +
          esc(fmtClock(start)) + ' · ' + esc(h.name) + '</span></div>' +
        rows +
        '<div class="kv"><span class="k">回酒店</span><span class="v">' +
          esc(fmtClock(s.backAt)) + '</span></div>' +
      '</div></div>' +
      '<div style="margin-top:12px;font-size:11.5px;line-height:1.65;color:var(--muted)">' +
        (win && win.note ? '起止时间已按当天的固定班次调整（见上方提示）。<br>' : '') +
        '全程约 ' + Math.round(s.minutes / 60 * 10) / 10 + ' 小时（' +
        s.km.toFixed(1) + ' km）。估算方式：短距离按步行、长距离按乘车（含约 6 分钟候车），' +
        '每个点按类型留出停留时间（景点约 45 分、区域 30 分、交通点 10 分）。<br>' +
        '标「要求」的点是<b>你自己设的时间要求</b>，排序会优先满足；' +
        '标「宜」的是数据里本来就有的「最佳时机」提示，只作参考。' +
        (unmet
          ? '<br><b style="color:#c0392b">有 ' + unmet +
            ' 个时间要求在现有条件下排不进——点该地点里的「时间要求」放宽，或调整行程。</b>'
          : '') +
      '</div>');
  }

  function renderMapContent() {
    if (!state.mapReady) return;
    // a suggestion belongs to one filter — drop it when the day changes
    if (mapSuggest && mapSuggest.filter !== state.mapFilter) mapSuggest = null;
    const isAll = state.mapFilter === 'all';
    const days = currentMapDays();
    overlayGroup.clearLayers();
    mapMarkers = [];
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
        const mk = L.marker([h.lat, h.lng], { icon: makeCityPin(r.color, label) })
          .addTo(overlayGroup)
          .bindPopup(popupHtml(h.name, h.address, h.lat, h.lng, h.name));
        indexMarker(mk, h.lat, h.lng, h.name);
        allPts.push([h.lat, h.lng]);
      });
    } else {
      /* ---------- day detail: numbered stops + the day's route ------------- */
      days.forEach(function (di) {
        const d = DAYS[di];
        const r = regionOf(d);
        const sug = (mapSuggest && mapSuggest.filter === String(di)) ? mapSuggest : null;

        const h = hotelById(d.hotelId);
        if (h) {
          const mk = L.marker([h.lat, h.lng], { icon: makeHotelPin(r.color) })
            .addTo(overlayGroup)
            .bindPopup(popupHtml(h.name, h.address, h.lat, h.lng, h.name));
          indexMarker(mk, h.lat, h.lng, h.name);
          allPts.push([h.lat, h.lng]);
        }

        // while a suggestion is showing the pins are numbered by ITS order, so
        // the map reads as the proposed route rather than the itinerary order
        const sugPos = {};
        if (sug) sug.order.forEach(function (pi, k) { sugPos[pi] = k + 1; });

        const pts = [];
        d.places.forEach(function (p, pi) {
          pts.push([p.lat, p.lng]);
          const num = sug ? String(sugPos[pi] || '') : String(pi + 1);
          const mk = L.marker([p.lat, p.lng], { icon: makePin('', r.color, num) })
            .addTo(overlayGroup)
            .bindPopup(popupHtml(p.name, deEn(p.nameDe, p.nameEn) + (p.note ? ' · ' + p.note : '') +
              (sug ? ' ｜ 建议第 ' + sugPos[pi] + ' 站' : ''),
              p.lat, p.lng, p.name));
          indexMarker(mk, p.lat, p.lng, p.name);
          allPts.push([p.lat, p.lng]);
        });

        if (sug && h) {
          // hotel → every sight in the suggested order → back to the hotel
          const loop = [[h.lat, h.lng]].concat(
            sug.order.map(function (i) { return [d.places[i].lat, d.places[i].lng]; }),
            [[h.lat, h.lng]]);
          L.polyline(loop, {
            color: '#e30613', weight: 3.5, opacity: .95, lineJoin: 'round',
          }).addTo(overlayGroup).bindPopup(
            '<b>建议路线</b><div class="pop-sub">起终点：' + esc(h.name) +
            ' · 约 ' + Math.round(sug.minutes) + ' 分钟 / ' + sug.km.toFixed(1) + ' km</div>');
          addArrows(loop, '#e30613');
        } else if (state.mapRoute && pts.length > 1) {
          L.polyline(pts, {
            color: r.color, weight: 3, opacity: .9,
            dashArray: '7 7', lineJoin: 'round',
          }).addTo(overlayGroup);
          addArrows(pts, r.color);
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

    // the two toggles say what they will do next
    const sugOn = !!(mapSuggest && mapSuggest.filter === state.mapFilter);
    const btnRoute = $('[data-map-action="route"]');
    const btnSug = $('[data-map-action="suggest"]');
    // while the suggestion is up it replaces the itinerary line, so tapping
    // 显示路线 switches back rather than toggling an invisible line
    if (btnRoute) btnRoute.textContent = (sugOn || !state.mapRoute) ? '显示路线' : '隐藏路线';
    if (btnSug) btnSug.textContent = sugOn ? '隐藏建议' : '建议路线';

    // photo spots are drawn last so they sit above the route lines
    const spots = photoSpotsInView(days);
    const needPhoto = [];
    spots.forEach(function (s) {
      const mk = L.marker([s.lat, s.lng], { icon: makePhotoPin(s), zIndexOffset: 400 })
        .addTo(overlayGroup)
        .bindPopup(photoPopupHtml(s));
      s._marker = mk;
      indexMarker(mk, s.lat, s.lng, s.name);
      allPts.push([s.lat, s.lng]);
      if (s.photoId) needPhoto.push(s);
    });

    // user-taken photos live in IndexedDB (never in the sync payload); load them
    // after the markers are placed and swap the camera icon for a thumbnail,
    // and the popup for one that shows the photo in a small box.
    if (needPhoto.length) {
      IDB.all().then(function (items) {
        const byId = {};
        items.forEach(function (it) { byId[it.id] = it; });
        needPhoto.forEach(function (s) {
          const it = byId[s.photoId];
          if (!it || !s._marker) return;
          if (s._photoUrl) URL.revokeObjectURL(s._photoUrl);
          s._photoUrl = URL.createObjectURL(it.blob);
          s._marker.setIcon(makePhotoPin(s));
          s._marker.setPopupContent(photoPopupHtml(s));
        });
      }).catch(function () {});
    }

    if (allPts.length) {
      try {
        map.fitBounds(L.latLngBounds(allPts).pad(0.16), { maxZoom: isAll ? 9 : 13 });
      } catch (e) {}
    }

    renderMapPlaces(days);
    $('#mapListTitle').textContent = isAll ? '全部地点' : '本日地点';
  }

  /**
   * Pan to a coordinate and make its pin pulse, so tapping a row in the list
   * visibly points at the right marker instead of leaving the user to hunt for
   * it among the numbered pins.
   */
  function pulseMapMarker(lat, lng, zoom) {
    if (!map) return;
    map.setView([lat, lng], zoom || Math.max(map.getZoom(), 15), { animate: true });

    const hit = mapMarkers.filter(function (m) {
      return Math.abs(m.lat - lat) < 1e-6 && Math.abs(m.lng - lng) < 1e-6;
    })[0];
    if (!hit || !hit.marker.getElement) return;
    const el = hit.marker.getElement();
    if (!el) return;

    // drop + force reflow + re-add, so tapping the same row twice re-animates
    el.classList.remove('pin-pulse');
    void el.offsetWidth;
    el.classList.add('pin-pulse');
    if (hit._pulseTimer) clearTimeout(hit._pulseTimer);
    hit._pulseTimer = setTimeout(function () { el.classList.remove('pin-pulse'); }, 3400);
  }

  /* ---- long-press A, then pick B → plan A→B in the SBB app -------------- */

  let linkFrom = null;         // the armed point
  let linkTimer = null;        // long-press timer
  let linkStart = null;        // pointer origin, to tell a hold from a drag
  let linkSwallowClick = false;

  /** the linkable point behind an element, or null */
  function linkableOf(el) {
    const t = el && el.closest ? el.closest('[data-link]') : null;
    if (!t) return null;
    const ll = String(t.dataset.link || '').split(',').map(Number);
    if (isNaN(ll[0]) || isNaN(ll[1])) return null;
    return { lat: ll[0], lng: ll[1], name: t.dataset.linkName || '', el: t };
  }

  /** register a marker in the render index and make it a link endpoint */
  function indexMarker(mk, lat, lng, name) {
    const el = mk.getElement && mk.getElement();
    if (el) {
      el.dataset.link = lat + ',' + lng;
      el.dataset.linkName = name || '';
    }
    mapMarkers.push({ lat: lat, lng: lng, marker: mk });
  }

  function armLink(a) {
    linkFrom = a;
    document.body.classList.add('linking');
    a.el.classList.add('link-armed');
    toast('已选「' + a.name + '」—— 再点另一个地点，或按住划过去，规划 SBB 路线');
  }

  function clearLink() {
    if (linkFrom && linkFrom.el) linkFrom.el.classList.remove('link-armed');
    linkFrom = null;
    document.body.classList.remove('linking');
    Array.prototype.forEach.call(document.querySelectorAll('.link-over'), function (el) {
      el.classList.remove('link-over');
    });
  }

  /** the engine's cleanest option: fewest changes, then shortest ride */
  function bestConnection(list) {
    return list.slice().sort(function (a, b) {
      if (a.transfers !== b.transfers) return a.transfers - b.transfers;
      return (a.durationMin || 9999) - (b.durationMin || 9999);
    })[0];
  }

  /**
   * A → B. Both are the traveller's own points (a hotel, a sight, a photo spot),
   * so let the timetable engine resolve them to real stops and hand those to
   * SBB — the app cannot route from a bare coordinate or a hotel name.
   */
  function planLinkRoute(a, b) {
    toast('正在规划 ' + a.name + ' → ' + b.name + ' …');
    SERVICES.connections({
      from: { lat: a.lat, lng: a.lng },
      to: { lat: b.lat, lng: b.lng },
      limit: 4,
    }).then(function (list) {
      const best = bestConnection(list);
      const rides = best.sections.filter(function (s) { return s.kind === 'ride'; });
      if (!rides.length) { toast('这两点之间没有查到班次，可能步行即可'); return; }
      const board = rides[0].from;
      const alight = rides[rides.length - 1].to;
      // the route took a network round-trip, so a window.open here would be
      // popup-blocked — go through SBB's app scheme instead
      openSbbApp({ name: board }, { name: alight });
      toast('已按最优路线 ' + board + ' → ' + alight);
    }).catch(function (e) {
      toast((e && e.message) || '规划失败，请重试');
    });
  }

  /** a tap while armed completes the link; returns true if it was consumed */
  function linkTap(target) {
    if (!linkFrom) return false;
    const b = linkableOf(target);
    if (!b) { clearLink(); return false; }
    if (b.lat === linkFrom.lat && b.lng === linkFrom.lng) { clearLink(); return true; }
    const a = linkFrom;
    clearLink();
    linkSwallowClick = true;
    planLinkRoute(a, b);
    return true;
  }

  function bindLinkGesture() {
    document.addEventListener('pointerdown', function (e) {
      if (linkFrom) return;                       // already armed — the tap path handles it
      const a = linkableOf(e.target);
      if (!a) return;
      linkStart = { x: e.clientX, y: e.clientY };
      clearTimeout(linkTimer);
      linkTimer = setTimeout(function () { armLink(a); }, 420);
    }, true);

    document.addEventListener('pointermove', function (e) {
      if (!linkStart) return;
      if (!linkFrom) {
        // still holding for the long press: real movement means scroll or pan
        if (Math.abs(e.clientX - linkStart.x) > 12 || Math.abs(e.clientY - linkStart.y) > 12) {
          clearTimeout(linkTimer);
          linkStart = null;
        }
        return;
      }
      // armed — mark whatever point the finger is over
      const b = linkableOf(document.elementFromPoint(e.clientX, e.clientY));
      Array.prototype.forEach.call(document.querySelectorAll('.link-over'), function (el) {
        if (!b || el !== b.el) el.classList.remove('link-over');
      });
      if (b && b.el !== linkFrom.el) b.el.classList.add('link-over');
    }, true);

    document.addEventListener('pointerup', function (e) {
      clearTimeout(linkTimer);
      const armed = !!linkFrom;
      const moved = !!linkStart;
      linkStart = null;
      if (!armed) return;
      // released over another point → complete the link right away
      const b = linkableOf(document.elementFromPoint(e.clientX, e.clientY));
      if (b && (b.lat !== linkFrom.lat || b.lng !== linkFrom.lng)) {
        const a = linkFrom;
        clearLink();
        linkSwallowClick = true;
        planLinkRoute(a, b);
        e.preventDefault();
        return;
      }
      // released in place — stay armed and wait for a tap on B
      if (moved) e.preventDefault();
    }, true);

    document.addEventListener('pointercancel', function () {
      clearTimeout(linkTimer);
      linkStart = null;
      if (linkFrom) clearLink();
    }, true);
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
        out += '<button class="place" data-maplot="' + h.lat + ',' + h.lng + '"' +
          ' data-link="' + h.lat + ',' + h.lng + '" data-link-name="' + esc(h.name) + '">' +
          '<span class="place-ic" style="--tint:' + r.color + ';--tint-soft:' + r.soft + '">' + icon('bed') + '</span>' +
          '<span class="place-tx"><b>' + esc(h.name) + '</b><span>酒店 · ' + esc(h.address) + '</span></span>' +
          '<span class="place-go">' + icon('pin') + '</span></button>';
      }
      d.places.forEach(function (p) {
        n++;
        out += '<button class="place" data-maplot="' + p.lat + ',' + p.lng + '"' +
          ' data-link="' + p.lat + ',' + p.lng + '" data-link-name="' + esc(p.name) + '">' +
          '<span class="place-ic" style="--tint:' + r.color + ';--tint-soft:' + r.soft + '">' +
            icon(p.kind === 'transit' ? 'train' : 'pin') + '</span>' +
          '<span class="place-tx"><b>' + esc(p.name) + '</b><span>' + esc(deEn(p.nameDe, p.nameEn)) +
            (p.note ? ' · ' + esc(p.note) : '') + '</span></span>' +
          '<span class="place-go">' + icon('pin') + '</span></button>';
      });
      return out;
    }).join('');

    /* ---- photo spots, grouped after the places ---- */
    const spots = photoSpotsInView(days);
    let photoHtml = '';
    if (spots.length) {
      photoHtml = '<div style="padding:16px 0 6px;font-size:11px;font-weight:800;' +
        'letter-spacing:.06em;text-transform:uppercase;color:#d03a2f">拍照点 · ' + spots.length + ' 处</div>' +
        spots.map(function (s) {
          const dn = s.day ? (DAYS.filter(function (d) { return d.id === s.day; })[0] || {}) : null;
          return '<div class="place photo-row">' +
            '<button class="place-main" data-photo-open="' + esc(s.id) + '"' +
              ' data-link="' + s.lat + ',' + s.lng + '" data-link-name="' + esc(s.name) + '">' +
              '<span class="place-ic" style="--tint:#d03a2f;--tint-soft:#fdeceb">' + icon('camera') + '</span>' +
              '<span class="place-tx"><b>' + esc(s.name) + '</b><span>' +
                esc([deEn(s.nameDe, s.nameEn), s.best || (dn ? dn.dow : '')].filter(Boolean).join(' · ')) +
              '</span></span>' +
            '</button>' +
            '<button class="photo-x" data-photo-map="' + esc(s.id) + '" aria-label="在地图查看">' +
              icon('map') + '</button>' +
            '<button class="photo-x" data-photo-hide="' + esc(s.id) + '" aria-label="隐藏">' +
              icon('x') + '</button>' +
          '</div>';
        }).join('');
    }

    $('#mapPlaces').innerHTML = (html + photoHtml) || '<div class="empty">暂无地点</div>';
    $('#mapCount').textContent = (n + spots.length) + ' 个点';

    const bar = $('#mapPhotoBar');
    if (bar) {
      const hidden = STORE.hiddenPhotoCount();
      bar.innerHTML =
        '<button class="btn sm ghost" data-photo-toggle="1">' +
          (STORE.photosVisible() ? '隐藏拍照点' : '显示拍照点') + '</button>' +
        '<button class="btn sm ghost" data-photo-add="1">' + icon('plus') + '加拍照点</button>' +
        (hidden ? '<button class="btn sm ghost" data-photo-restore="1">恢复 ' + hidden + ' 个</button>' : '');
    }
  }

  /* ======================== WALLET ==================================== */
  function expenses() { return store.get(K.expenses, []); }
  function saveExpenses(list) { store.set(K.expenses, list); }
  function budget() { return STORE.budget(); }
  function rates() {
    const r = STORE.rates();
    if (r && r.cny && r.eur) return r;
    return { cny: 8.85, eur: 1.06, source: '默认值', date: '', stale: true };
  }

  /* live CHF rates — cached for 12 h, refreshed in the background */
  const FX_TTL = 12 * 60 * 60 * 1000;
  let fxBusy = false;

  function fxRefresh(force) {
    if (fxBusy || typeof SERVICES === 'undefined') return Promise.resolve(rates());
    const cur = STORE.rates();
    if (!force && cur && cur.at && Date.now() - cur.at < FX_TTL) return Promise.resolve(cur);
    fxBusy = true;
    return SERVICES.fx().then(function (r) {
      fxBusy = false;
      STORE.setRates(r);
      if (state.view === 'wallet') renderWallet();
      const el = document.getElementById('moreRates');
      if (el) el.textContent = '1 CHF ≈ ¥' + r.cny.toFixed(2) + ' / €' + r.eur.toFixed(3);
      return r;
    }).catch(function () { fxBusy = false; return rates(); });
  }

  function fxCaption() {
    const r = rates();
    if (r.stale) return '默认汇率 · 点「更新汇率」获取实时';
    const when = r.date ? r.date.slice(5).replace('-', '/') : '';
    const hrs = r.at ? (Date.now() - r.at) / 3600000 : null;
    const age = hrs == null ? '' : hrs < 1 ? ' · 刚刚更新' : ' · ' + Math.round(hrs) + ' 小时前';
    return r.source + (when ? ' · ' + when : '') + age;
  }

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
        '<div class="wh-rate">' + esc(fxCaption()) + '</div>' +
      '</div>' +

      '<div class="sec">' +
        '<div class="sec-head"><h2>常见消费' + (state.presetEdit ? '' : ' · 点一下添加') + '</h2>' +
          '<span class="more" data-preset-edit="' + (state.presetEdit ? '0' : '1') + '">' +
            (state.presetEdit ? '完成' : '改金额') + '</span></div>' +
        (state.presetEdit ? presetsEditHtml() : presetsTapHtml()) +
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
          '<button class="btn sm ghost" data-fx-refresh="1">更新汇率</button>' +
          '<button class="btn sm ghost" data-edit-rates="1">手动设汇率</button>' +
          '<button class="btn sm ghost" data-export-csv="1">导出 CSV</button>' +
        '</div>' +
      '</div>';
  }

  /* ---------- expense presets (tap-to-add / edit) ---------------------- */
  function presetsTapHtml() {
    const list = STORE.presets();
    if (!list.length) {
      return '<div class="empty">' + icon('coins') + '还没有常用项<br>点「改金额」自己加几个</div>';
    }
    return '<div class="presets">' + list.map(function (p) {
      const c = catById(p.cat);
      return '<button class="preset" data-preset="' + esc(p.id) + '">' +
        '<span class="k" style="background:' + c.color + '1f;color:' + c.color + '">' + esc(c.label) + '</span>' +
        '<span class="n">' + esc(p.label) + '</span>' +
        '<span class="a">' + fmtCHF(p.amount) + '</span>' +
        '<span class="plus">' + icon('plus') + '</span>' +
      '</button>';
    }).join('') + '</div>';
  }

  function presetsEditHtml() {
    return '<div class="presets">' + STORE.presets().map(function (p) {
      const c = catById(p.cat);
      return '<div class="preset-row" style="--c:' + c.color + '">' +
        '<select data-pcat="' + esc(p.id) + '" aria-label="分类">' +
          EXPENSE_CATEGORIES.map(function (x) {
            return '<option value="' + x.id + '"' + (x.id === p.cat ? ' selected' : '') + '>' +
              esc(x.label) + '</option>';
          }).join('') +
        '</select>' +
        '<input data-plabel="' + esc(p.id) + '" type="text" value="' + esc(p.label) + '" ' +
          'placeholder="名称" aria-label="名称">' +
        '<input data-pamt="' + esc(p.id) + '" type="number" inputmode="decimal" step="0.05" min="0" ' +
          'value="' + p.amount + '" aria-label="金额">' +
        '<button class="ledger-del" data-pdel="' + esc(p.id) + '" aria-label="删除">' + icon('x') + '</button>' +
      '</div>';
    }).join('') + '</div>' +
    '<div class="btn-row" style="margin-top:11px">' +
      '<button class="btn sm primary" data-padd="1">' + icon('plus') + '添加常用项</button>' +
      '<button class="btn sm ghost" data-preset-reset="1">恢复默认</button>' +
    '</div>' +
    '<div style="margin-top:9px;font-size:11.5px;line-height:1.6;color:var(--muted)">' +
      '改完直接生效，存在手机本地。点「完成」回到一键添加模式。' +
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
    const stats = STORE.stats();

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
        '<div class="sec-head"><h2>工具与设置</h2></div>' +
        '<div class="card"><div class="card-bd tight">' +
          '<div class="kv"><span class="k">行程预算</span><span class="v">CHF ' + fmtCHF(budget()) + '</span>' +
            '<button class="btn sm ghost" data-edit-budget="1">改</button></div>' +
          '<div class="kv"><span class="k">实时汇率</span>' +
            '<span class="v" id="moreRates">1 CHF ≈ ¥' + rt.cny.toFixed(2) + ' / €' + rt.eur.toFixed(3) + '</span>' +
            '<button class="btn sm ghost" data-fx-refresh="1">更新</button></div>' +
          '<div class="kv"><span class="k"></span><span class="v" style="font-weight:500;font-size:11.5px;color:var(--muted)">' +
            esc(fxCaption()) + '</span>' +
            '<button class="btn sm ghost" data-edit-rates="1">手动</button></div>' +
          '<div class="kv"><span class="k">瑞士当前时间</span><span class="v" id="moreClock">--:--</span></div>' +
          '<div class="kv"><span class="k">行程状态</span><span class="v">' +
            (st.phase === 'before' ? '未出发 · 还有 ' + st.days + ' 天'
              : st.phase === 'during' ? '进行中 · 第 ' + (st.index + 1) + ' 天'
              : '已结束') + '</span></div>' +
        '</div></div>' +
      '</div>' +

      /* github sync */
      (function () {
        const gc = ghConfig();
        const ready = !!(gc.repo && gc.token);
        const last = store.get(GH_LAST, 0);
        return '<div class="sec">' +
          '<div class="sec-head"><h2>同步至 GitHub</h2>' +
            '<span class="more">' + (ready ? '已配置' : '未配置') + '</span></div>' +
          '<div class="card"><div class="card-bd tight">' +
            '<div class="kv"><span class="k">仓库</span><span class="v">' +
              (ready ? esc(gc.repo) + ' · ' + esc(gc.branch || 'main') : '未配置') + '</span>' +
              '<button class="btn sm ghost" data-gh-setup="1">设置</button></div>' +
            (ready ? '<div class="kv"><span class="k">文件</span><span class="v">' + esc(gc.path) + '</span></div>' : '') +
            (last ? '<div class="kv"><span class="k">上次同步</span><span class="v">' +
              esc(new Date(last).toLocaleString('zh-CN')) + '</span></div>' : '') +
          '</div>' +
          (ready ? '<div class="card-bd"><div class="btn-row">' +
            '<button class="btn sm primary" data-gh-push="1">上传到 GitHub</button>' +
            '<button class="btn sm ghost" data-gh-pull="1">从 GitHub 拉取</button>' +
          '</div></div>' : '') +
          '<div style="margin-top:10px;font-size:11.5px;line-height:1.65;color:var(--muted)">' +
            '只同步你自己的修改（地点、交通、安排、拍照点、记账）。' +
            '票据图片存在本机、<b>绝不</b>上传；证件与联系人等个人信息不在同步范围内。' +
            'Token 只保存在这台手机里。' +
          '</div>' +
          '</div>' +
        '</div>' +

        /* sharing — its own section */
        '<div class="sec">' +
          '<div class="sec-head"><h2>分享给朋友</h2>' +
            '<span class="more">' + (appRepo() ? '公开' : '不可用') + '</span></div>' +
          '<div class="card"><div class="card-bd tight">' +
            (appRepo()
              ? '<div class="kv"><span class="k">分享文件</span><span class="v">' +
                  esc(appRepo() + '/' + SHARE_PATH) + '</span></div>'
              : '<div class="kv"><span class="k">当前域名</span><span class="v">' +
                  esc(location.hostname) + '（非 GitHub Pages，无法分享）</span></div>') +
          '</div>' +
          (ready && appRepo() ? '<div class="card-bd"><div class="btn-row">' +
            '<button class="btn sm primary" data-gh-share="1">更新分享</button>' +
            '<button class="btn sm ghost" data-gh-sharelink="1">复制分享链接</button>' +
          '</div></div>' : '') +
          '<div style="margin-top:10px;font-size:11.5px;line-height:1.65;color:var(--muted)">' +
            '朋友打开 <b>' + esc(appRepo() ? shareLink() : '<本页地址>/#share') + '</b> ' +
            '就会自动载入你最新分享的行程，不需要 Token。<br>' +
            '分享文件放在本网页所在的公开仓库里，所以<b>任何人拿到链接都能看到</b>——' +
            '目前包含记账；如果不想公开账目，告诉我，我把它改成只分享行程。' +
          '</div>' +
          '</div>' +
        '</div>';
      })() +

      /* my edits */
      '<div class="sec">' +
        '<div class="sec-head"><h2>我的修改</h2><span class="more">只在本机</span></div>' +
        '<div class="card"><div class="card-bd tight">' +
          '<div class="kv"><span class="k">新增地点</span><span class="v">' + stats.places + ' 个</span></div>' +
          '<div class="kv"><span class="k">新增交通</span><span class="v">' + stats.legs + ' 段</span></div>' +
          '<div class="kv"><span class="k">新增安排</span><span class="v">' + stats.blocks + ' 条</span></div>' +
          '<div class="kv"><span class="k">隐藏项目</span><span class="v">' + stats.hidden + ' 项</span></div>' +
          '<div class="kv"><span class="k">新增日期</span><span class="v">' + (stats.extraDays || 0) + ' 天</span></div>' +
          '<div class="kv"><span class="k">已删除日期</span><span class="v">' + (stats.removedDays || 0) + ' 天</span></div>' +
          '<div class="kv"><span class="k">常用消费</span><span class="v">' +
            (stats.hasCustomPresets ? '已自定义 ' + STORE.presets().length + ' 项' : '默认 ' + STORE.presets().length + ' 项') +
            '</span></div>' +
        '</div>' +
        '<div class="card-bd">' +
          '<div class="btn-row">' +
            (stats.removedDays
              ? '<button class="btn sm primary" data-restore-days="1">' +
                  icon('swap') + '恢复已删除的日期（' + stats.removedDays + '）</button>'
              : '') +
            '<button class="btn sm ghost" data-backup="1">导出备份</button>' +
            '<button class="btn sm ghost" data-restore="1">导入备份</button>' +
            '<button class="btn sm ghost" data-clear-edits="1">清空我的修改</button>' +
          '</div>' +
          '<div style="margin-top:10px;font-size:11.5px;line-height:1.65;color:var(--muted)">' +
            '所有修改存在这台手机的浏览器里，不会上传。换手机时用「导出备份」生成一个文件，' +
            '在新手机上「导入备份」即可恢复。' +
          '</div>' +
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
            '<button class="btn sm ghost" data-sw-update="1">' + icon('swap') + '检查更新</button>' +
            '<button class="btn sm ghost" data-reset="1">清空本地数据</button>' +
          '</div>' +
          '<div style="margin-top:9px;font-size:11px;color:var(--faint);text-align:center">' +
            '当前版本 ' + esc(APP_VERSION) + ' · 若功能没更新，点「检查更新」强制刷新' +
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

  /**
   * Force a clean reload: unregister the service worker and drop its caches so
   * the next load fetches the newest app shell. This is the escape hatch when a
   * stale cached build keeps a fix from showing up on the device.
   */
  function forceUpdate() {
    toast('正在检查更新…');
    const done = function () { location.reload(); };
    if (!('serviceWorker' in navigator)) { done(); return; }
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      return Promise.all(regs.map(function (r) { return r.unregister(); }));
    }).then(function () {
      if (typeof caches === 'undefined') return null;
      return caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      });
    }).then(done).catch(done);
  }

  /* ======================== day editors =============================== */

  /** re-render whatever is on screen after a mutation */
  function refreshAfterEdit() {
    // the itinerary changed, so any suggestion on screen is now stale — a new
    // train leg must be able to move the day's window
    mapSuggest = null;
    if (state.mapReady && state.view === 'map') { renderMapLegend(); renderMapContent(); }
    if (state.view === 'today') renderToday();
    else if (state.view === 'itin') renderItin();
    else if (state.view === 'wallet') renderWallet();
    else if (state.view === 'more') renderMore();
    else renderChips();
  }

  function editorRow(kind, index, title, sub, editAttr) {
    return '<div class="erow">' +
      '<span class="erow-tx"><b>' + esc(title) + '</b>' +
        (sub ? '<span>' + esc(sub) + '</span>' : '') + '</span>' +
      (editAttr
        ? '<button class="erow-edit" ' + editAttr + ' aria-label="编辑">' + icon('edit') + '</button>'
        : '') +
      '<button class="ledger-del" data-rm="' + kind + ':' + index + '" aria-label="删除">' +
        icon('x') + '</button>' +
    '</div>';
  }

  function editorGroup(title, iconId, rows, addLabel, addAttr) {
    return '<div class="egroup">' +
      '<div class="egroup-h"><span class="ibub">' + icon(iconId) + '</span>' +
        '<b>' + esc(title) + '</b>' +
        '<span class="egroup-n">' + rows.length + '</span></div>' +
      (rows.length ? rows.join('') : '<div class="egroup-empty">暂无，点下面添加</div>') +
      '<button class="btn sm ghost egroup-add" ' + addAttr + '>' + icon('plus') + esc(addLabel) + '</button>' +
    '</div>';
  }

  function openDayEditor(dayIndex) {
    state.editorDay = dayIndex;
    const day = DAYS[dayIndex];
    const stats = STORE.stats();

    const blockRows = day.blocks.map(function (b, i) {
      return editorRow('b', i, b.time + ' · ' + b.label, b.text);
    });
    const legRows = day.transport.map(function (t, i) {
      const route = t.to ? (t.from + ' → ' + t.to) : t.from;
      const bits = [t.mode, t.duration];
      if (t.booked) bits.push('已订 ' + t.booked);
      else if (t.time) bits.push(t.time);
      return editorRow('t', i, route, bits.filter(Boolean).join(' · '), 'data-edit-leg="' + i + '"');
    });
    const placeRows = day.places.map(function (p, i) {
      return editorRow('p', i, p.name, [deEn(p.nameDe, p.nameEn), p.note].filter(Boolean).join(' · '));
    });

    openSheet('编辑行程', day.dow + ' · ' + day.title,
      editorGroup('时间安排', 'clock', blockRows, '添加安排', 'data-add-block="1"') +
      editorGroup('交通', 'train', legRows, '添加交通（自动推荐班次）', 'data-add-leg="1"') +
      editorGroup('地点', 'pin', placeRows, '添加地点（搜索）', 'data-add-place="1"') +
      '<div class="sheet-sep"></div>' +
      '<div class="btn-row">' +
        '<button class="btn sm ghost" data-restore-day="1">恢复本日默认</button>' +
        '<button class="btn sm ghost" data-go="map">在地图查看</button>' +
      '</div>' +
      '<div style="margin-top:10px;font-size:11.5px;line-height:1.65;color:var(--muted)">' +
        '改动只存在这台手机上，会立刻同步到「今日」和「地图」。' +
        (stats.hidden || stats.places || stats.legs || stats.blocks
          ? '<br>本机已修改：新增 ' + stats.places + ' 个地点、' + stats.legs + ' 段交通、' +
            stats.blocks + ' 条安排，隐藏 ' + stats.hidden + ' 项。'
          : '') +
      '</div>',
      function () {
        const bd = $('.sheet-inner');
        bd.addEventListener('click', function (ev) {
          const rm = ev.target.closest('[data-rm]');
          if (rm) {
            const parts = rm.dataset.rm.split(':');
            STORE.remove(day.id, parts[0], Number(parts[1]));
            refreshAfterEdit();
            openDayEditor(dayIndex);
            toast('已移除');
            return;
          }
          if (ev.target.closest('[data-add-block]')) { openBlockEditor(dayIndex); return; }
          if (ev.target.closest('[data-add-leg]')) {
            const ps = DAYS[dayIndex].places;
            openTransportPicker(dayIndex, ps.length ? ps[0] : null,
              ps.length > 1 ? ps[ps.length - 1] : null);
            return;
          }
          if (ev.target.closest('[data-add-place]')) { openPlaceSearch(dayIndex); return; }
          const el = ev.target.closest('[data-edit-leg]');
          if (el) { openLegEditor(dayIndex, Number(el.dataset.editLeg)); return; }
          if (ev.target.closest('[data-restore-day]')) {
            STORE.restoreHidden(day.id);
            refreshAfterEdit();
            openDayEditor(dayIndex);
            toast('已恢复本日默认内容');
            return;
          }
        });
      }, 'editor');
  }

  /* ---------- add a timeline entry ------------------------------------ */
  function openBlockEditor(dayIndex) {
    const day = DAYS[dayIndex];
    openSheet('添加安排', day.dow + ' · ' + day.title,
      '<div class="field"><label>时间</label>' +
        '<input id="blTime" type="text" placeholder="例如 14:00 或 下午" value=""></div>' +
      '<div class="field"><label>标签</label>' +
        '<input id="blLabel" type="text" placeholder="例如 午餐、购物" value=""></div>' +
      '<div class="field"><label>内容</label>' +
        '<textarea id="blText" placeholder="写点具体安排…"></textarea></div>' +
      '<button class="btn block primary" id="blSave" style="height:46px">' + icon('check') + '保存</button>',
      function () {
        $('#blTime').focus();
        $('#blSave').addEventListener('click', function () {
          const text = $('#blText').value.trim();
          if (!text) { toast('请填写内容'); return; }
          STORE.addBlock(day.id, {
            time: $('#blTime').value.trim() || '灵活',
            label: $('#blLabel').value.trim() || '安排',
            text: text,
          });
          refreshAfterEdit();
          openDayEditor(dayIndex);
          toast('已添加');
        });
      }, 'editor');
  }

  /* ---------- add a place (search) ------------------------------------ */
  let psResults = [];

  function renderPsResults(list, stillSearching) {
    const box = $('#psResults');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<div class="egroup-empty">' +
        (stillSearching ? '搜索中…' : '没找到，换个关键词，或用下面的手动输入') + '</div>';
      return;
    }
    box.innerHTML =
      (stillSearching ? '<div class="egroup-empty" style="margin-bottom:8px">已找到 ' + list.length + ' 个，继续搜索中…</div>' : '') +
      list.map(function (p, i) {
        const src = p.source === 'station' ? '瑞士铁路车站'
          : p.source === 'osm' ? 'OpenStreetMap'
          : '地名';
        return '<button class="place" data-ps-add="' + i + '">' +
          '<span class="place-ic">' + icon(p.source === 'station' ? 'train' : 'pin') + '</span>' +
          '<span class="place-tx"><b>' + esc(p.name) + '</b><span>' +
            esc(src + (p.note ? ' · ' + p.note : '')) +
            ' · ' + p.lat.toFixed(4) + ', ' + p.lng.toFixed(4) + '</span></span>' +
          '<span class="place-go">' + icon('plus') + '</span>' +
        '</button>';
      }).join('');
  }

  function openPlaceSearch(dayIndex, onAdded) {
    const day = DAYS[dayIndex];
    psResults = [];
    let timer = null;
    let seq = 0;

    openSheet('添加地点', day.dow + ' · ' + day.title,
      '<div class="field">' +
        '<label>搜索地点或车站</label>' +
        '<input id="psQuery" type="search" placeholder="Interlaken / Bachalpsee / 车站名" ' +
          'autocomplete="off" autocapitalize="off">' +
      '</div>' +
      '<div id="psResults"><div class="egroup-empty">输入至少 2 个字开始搜索</div></div>' +
      '<div class="sheet-sep"></div>' +
      '<button class="btn block ghost" id="psManual">手动输入名称与坐标</button>',
      function () {
        const q = $('#psQuery');
        if (!q) return;
        q.focus();
        q.addEventListener('input', function () {
          clearTimeout(timer);
          const v = q.value.trim();
          const mine = ++seq;
          if (v.length < 2) {
            psResults = [];
            $('#psResults').innerHTML = '<div class="egroup-empty">输入至少 2 个字开始搜索</div>';
            return;
          }
          $('#psResults').innerHTML = '<div class="egroup-empty">搜索中…</div>';
          timer = setTimeout(function () {
            // results stream in: stations usually land well before geocoding
            SERVICES.searchPlacesStreaming(v, function (list, finished) {
              if (mine !== seq) return;              // a newer keystroke superseded this
              psResults = list;
              renderPsResults(list, !finished);
            });
          }, 380);
        });

        $('#psResults').addEventListener('click', function (ev) {
          const b = ev.target.closest('[data-ps-add]');
          if (!b) return;
          const p = psResults[Number(b.dataset.psAdd)];
          if (!p) return;
          STORE.addPlace(day.id, p);
          refreshAfterEdit();
          toast('已添加「' + p.name + '」');
          if (onAdded) onAdded(p);
          else afterPlaceAdded(dayIndex, p);
        });

        $('#psManual').addEventListener('click', function () { openManualPlace(dayIndex, onAdded); });
      }, 'place');
  }

  function openManualPlace(dayIndex, onAdded) {
    const day = DAYS[dayIndex];
    openSheet('手动添加地点', day.dow + ' · ' + day.title,
      '<div class="field"><label>名称</label><input id="mpName" type="text" placeholder="地点名称"></div>' +
      '<div class="field"><label>英文名（可选）</label><input id="mpEn" type="text" placeholder="English name"></div>' +
      '<div class="field"><label>纬度</label>' +
        '<input id="mpLat" type="number" inputmode="decimal" step="0.0001" placeholder="46.6244"></div>' +
      '<div class="field"><label>经度</label>' +
        '<input id="mpLng" type="number" inputmode="decimal" step="0.0001" placeholder="8.0414"></div>' +
      '<div class="field"><label>备注（可选）</label><input id="mpNote" type="text" placeholder="例如 观景台"></div>' +
      '<button class="btn block primary" id="mpSave" style="height:46px">' + icon('check') + '保存</button>',
      function () {
        $('#mpName').focus();
        $('#mpSave').addEventListener('click', function () {
          const name = $('#mpName').value.trim();
          const lat = parseFloat($('#mpLat').value);
          const lng = parseFloat($('#mpLng').value);
          if (!name) { toast('请填写名称'); return; }
          if (isNaN(lat) || isNaN(lng)) { toast('请填写经纬度'); return; }
          const p = { name: name, nameEn: $('#mpEn').value.trim(), lat: lat, lng: lng,
            note: $('#mpNote').value.trim(), kind: 'sight' };
          STORE.addPlace(day.id, p);
          refreshAfterEdit();
          toast('已添加「' + name + '」');
          if (onAdded) onAdded(p);
          else afterPlaceAdded(dayIndex, p);
        });
      }, 'place');
  }

  /** after adding a place, offer transport to it — the point of the feature */
  function afterPlaceAdded(dayIndex, place) {
    const day = DAYS[dayIndex];
    const prev = day.places.length > 1 ? day.places[day.places.length - 2] : null;
    if (!prev) { openDayEditor(dayIndex); return; }

    openSheet('要加一段交通吗？', '已添加「' + place.name + '」',
      '<div style="font-size:13.5px;line-height:1.7;color:var(--ink-2);margin-bottom:16px">' +
        '可以查一下从 <b>' + esc(prev.name) + '</b> 到 <b>' + esc(place.name) + '</b> 的可行班次，' +
        '选中一段直接记进当天行程。' +
      '</div>' +
      '<button class="btn block primary" id="apGo" style="height:46px;margin-bottom:9px">' +
        icon('train') + '查询交通</button>' +
      '<button class="btn block ghost" id="apSkip">先不用</button>',
      function () {
        $('#apGo').addEventListener('click', function () {
          openTransportPicker(dayIndex, prev, place);
        });
        $('#apSkip').addEventListener('click', function () { openDayEditor(dayIndex); });
      }, 'editor');
  }

  /* ---------- transport recommender ----------------------------------- */
  let tpConns = [];
  let tpOpen = {};
  let tpRefs = { from: null, to: null };

  function resolveRef(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const day = DAYS[state.editorDay];
    const hit = day.places.filter(function (p) {
      return p.name === t || p.nameEn === t;
    })[0];
    if (hit) return {
      name: hit.name, lat: hit.lat, lng: hit.lng, stationId: hit.stationId || null,
      // SBB geocodes German/English, not Chinese — surface both so the deep
      // link opens the right station even when the displayed label is Chinese
      nameEn: hit.nameEn || null, nameDe: hit.nameDe || null,
    };
    const h = hotelById(day.hotelId);
    if (h && (h.name === t || h.city === t)) return { name: t, lat: h.lat, lng: h.lng, nameEn: h.name || null, nameDe: null };
    // a hotel that is merely touched by this day (checkout / check-in)
    const other = HOTELS.filter(function (x) { return x.name === t || x.city === t; })[0];
    if (other) return { name: t, lat: other.lat, lng: other.lng, nameEn: other.name || null, nameDe: null };
    return { name: t, nameEn: null, nameDe: null };
  }

  /**
   * Everything a transport leg on this day could plausibly start or end at:
   * the hotels the day touches (a travel day often means checking out of one
   * and into another, so both belong here) followed by the day's places.
   */
  function dayQuickRefs(day) {
    const out = [];
    const seen = {};
    const push = function (name, kind, sub) {
      const n = String(name || '').trim();
      if (!n || seen[n]) return;
      seen[n] = 1;
      out.push({ name: n, kind: kind, sub: sub || '' });
    };

    const mmdd = day.date.slice(5);
    const primary = day.hotelId ? HOTELS.filter(function (h) { return h.id === day.hotelId; }) : [];
    const overlapping = HOTELS.filter(function (h) {
      return h.checkIn && h.checkOut && h.checkIn <= mmdd && mmdd <= h.checkOut;
    });
    // use the *booked* hotel name (not the city) so the chip matches the booking
    primary.concat(overlapping).forEach(function (h) { push(h.name, 'hotel', h.city || ''); });
    day.places.forEach(function (p) { push(p.name, 'place', p.nameEn || ''); });
    return out;
  }

  /** one-tap fill chips; `attr` is the data-attribute the sheet listens for */
  function quickChips(refs, attr, label) {
    if (!refs.length) return '';
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<div class="chips-row">' + refs.map(function (r) {
        return '<button class="chip' + (r.kind === 'hotel' ? ' chip-hotel' : '') + '" ' +
          attr + '="' + esc(r.name) + '" title="' + esc(r.name + (r.sub ? ' · ' + r.sub : '')) + '">' +
          (r.kind === 'hotel' ? icon('bed') : '') + esc(r.name) + '</button>';
      }).join('') + '</div></div>';
  }

  /**
   * Wire chip taps with a deterministic 起点→终点 sequence.
   *
   * Tap 1 → fills 起点 (always overwrites any pre-fill).
   * Tap 2 → fills 终点.
   * Tap 3+ → ignored (so the same chip can't silently fill both fields,
   *                  which is exactly what made 起点=终点=格林德瓦村 in the bug).
   *
   * `hintEl` is updated live so the user always sees what the next tap will do.
   * Call once per sheet-open; the sequence resets every time.
   */
  function wireSeqChips(root, fromSel, toSel, attr, hintEl) {
    const f = root.querySelector(fromSel);
    const t = root.querySelector(toSel);
    const hint = hintEl || null;
    let step = 0;
    const update = function () {
      if (!hint) return;
      if (step === 0) hint.textContent = '下一步点击将填入：起点';
      else if (step === 1) hint.textContent = '下一步点击将填入：终点';
      else hint.textContent = '起点与终点已填好 — 点输入框可手动改，或直接点查询班次';
    };
    update();
    root.addEventListener('click', function (ev) {
      const chip = ev.target.closest('[' + attr + ']');
      if (!chip) return;
      const v = chip.getAttribute(attr);
      if (step === 0) { if (f) f.value = v; step = 1; }
      else if (step === 1) { if (t) t.value = v; step = 2; }
      else { return; }
      update();
    });
  }

  function transportFormHtml(day) {
    const refs = dayQuickRefs(day);

    return '<div class="field"><label>起点</label>' +
        '<input id="tpFrom" type="text" placeholder="车站名或地点" autocomplete="off"></div>' +
      '<div class="field"><label>终点</label>' +
        '<input id="tpTo" type="text" placeholder="车站名或地点" autocomplete="off"></div>' +
      quickChips(refs, 'data-tp-set', '当天地点与酒店 · 点一下按顺序填入起点、终点') +
      '<div class="chip-hint" id="tpChipHint">下一步点击将填入：起点</div>' +
      '<div class="tp-when">' +
        '<div class="field" style="flex:1"><label>日期</label>' +
          '<input id="tpDate" type="date" value="' + day.date + '"></div>' +
        '<div class="field" style="flex:1"><label>时间</label>' +
          '<input id="tpTime" type="time" value="08:00"></div>' +
      '</div>' +
      '<button class="btn block primary" id="tpGo" style="height:46px">' +
        icon('train') + '查询可行班次（SBB 实时）</button>' +
      '<button class="btn block ghost" id="tpMap" style="height:46px;margin-top:8px">' +
        icon('map') + '用 Google 地图查公交路线</button>' +
      '<div class="hint" style="margin-top:8px">' +
        'Google 地图会同时给出公交、步行与驾车方案，适合 SBB 没有覆盖到的最后一公里。<br>' +
        '查到班次后，每段都有两个操作：「用这段购票」会用该段的上车 / 下车站名直接打开 SBB Mobile 买票（App 内按当前时间查询，日期时间可在 App 里改）；「加入到行程」则把这段写进当天的交通里。</div>' +
      '<div id="tpResults" style="margin-top:14px"></div>' +
      '<div class="sheet-sep"></div>' +
      '<button class="btn block ghost" id="tpManual">手动添加一段交通</button>';
  }

  function renderConnections() {
    const box = $('#tpResults');
    if (!box) return;
    if (!tpConns.length) { box.innerHTML = ''; return; }

    box.innerHTML = '<div class="conn-h">查到 ' + tpConns.length + ' 个班次 · 点「用这段」加入行程</div>' +
      tpConns.map(function (c, i) {
        const open = tpOpen[i];
        return '<div class="conn">' +
          '<div class="conn-top">' +
            '<span class="conn-time">' + esc(c.dep) + ' <i>→</i> ' + esc(c.arr) + '</span>' +
            '<span class="conn-meta">' + esc(c.duration) + ' · ' +
              (c.transfers ? '换乘 ' + c.transfers + ' 次' : '直达') + '</span>' +
          '</div>' +
          '<div class="conn-lines">' + c.lines.map(function (l) {
            return '<span>' + esc(l) + '</span>';
          }).join('') + '</div>' +
          '<div class="conn-path">' + esc(c.fromName) + ' → ' + esc(c.toName) + '</div>' +
          (open ? '<div class="conn-detail">' + c.sections.map(function (s) {
            if (s.kind === 'walk') {
              return '<div class="conn-sec walk">' + icon('swap') + '步行约 ' + s.min + ' 分钟</div>';
            }
            return '<div class="conn-sec">' +
              '<b>' + esc((s.cat + ' ' + s.num).trim()) + '</b>' +
              '<span>' + esc(s.from) + ' → ' + esc(s.to) + '</span>' +
              '<span class="conn-plat">' + esc(s.dep) + '–' + esc(s.arr) +
                (s.platform ? ' · 站台 ' + esc(s.platform) : '') + '</span>' +
            '</div>';
          }).join('') + '</div>' : '') +
          '<div class="conn-acts">' +
            '<button class="btn sm ghost" data-conn-detail="' + i + '">' +
              (open ? '收起' : '详情') + '</button>' +
            '<button class="btn sm ghost" data-conn-add="' + i + '">加入到行程</button>' +
            '<button class="btn sm primary" data-conn-buy="' + i + '">用这段购票</button>' +
          '</div>' +
        '</div>';
      }).join('');
  }

  function openTransportPicker(dayIndex, fromRef, toRef) {
    state.editorDay = dayIndex;
    const day = DAYS[dayIndex];
    tpConns = [];
    tpOpen = {};

    openSheet('添加交通', day.dow + ' · ' + day.title,
      transportFormHtml(day),
      function () {
        const setFrom = function (v) { const e = $('#tpFrom'); if (e) e.value = v; };
        const setTo = function (v) { const e = $('#tpTo'); if (e) e.value = v; };
        if (fromRef) setFrom(fromRef.name || '');
        if (toRef) setTo(toRef.name || '');

        const inner = $('.sheet-inner');
        wireSeqChips(inner, '#tpFrom', '#tpTo', 'data-tp-set', $('#tpChipHint'));

        inner.addEventListener('click', function (ev) {
          const det = ev.target.closest('[data-conn-detail]');
          if (det) {
            const i = Number(det.dataset.connDetail);
            tpOpen[i] = !tpOpen[i];
            renderConnections();
            return;
          }

          // buy this leg: hand SBB the actual boarding / alighting stops of the
          // chosen connection (the engine already resolved them), so the app
          // opens on a route it can find — a hotel name or a bare address would
          // not resolve there
          const buy = ev.target.closest('[data-conn-buy]');
          if (buy) {
            const c = tpConns[Number(buy.dataset.connBuy)];
            if (!c) return;
            const st = connectionStations(c);
            if (!st.board || !st.alight) { toast('这段没有可用的车站名'); return; }
            openSbbApp({ name: st.board }, { name: st.alight });
            toast('已在 SBB 搜索：' + st.board + ' → ' + st.alight);
            return;
          }

          const add = ev.target.closest('[data-conn-add]');
          if (add) {
            const c = tpConns[Number(add.dataset.connAdd)];
            if (!c) return;
            // label the leg with the traveller's own place names — the raw
            // station names the API resolves from coordinates are unreadable
            STORE.addLeg(day.id, {
              from: (tpRefs.from && tpRefs.from.name) || $('#tpFrom').value.trim(),
              to: (tpRefs.to && tpRefs.to.name) || $('#tpTo').value.trim(),
              mode: c.mode || '火车',
              duration: c.duration,
              note: c.lines.join(' → '),
              // a looked-up connection is a plan, not a booking — the traveller
              // can confirm the booked time later from the leg editor
              time: c.dep,
              detail: c.sections,
            });
            refreshAfterEdit();
            toast('已加入行程：' + c.dep + ' 出发');
            openDayEditor(dayIndex);
            return;
          }

          if (ev.target.closest('#tpManual')) { openManualLeg(dayIndex); return; }
          if (ev.target.closest('#tpMap')) {
            const fv = $('#tpFrom').value.trim();
            const tv = $('#tpTo').value.trim();
            if (!fv || !tv) { toast('请填写起点和终点'); return; }
            const fr = resolveRef(fv);
            const tr = resolveRef(tv);
            openExternal(gmapsTransitUrl(fr, tr));
            return;
          }
        });

        $('#tpGo').addEventListener('click', function () {
          const from = resolveRef($('#tpFrom').value);
          const to = resolveRef($('#tpTo').value);
          if (!from || !to) { toast('请填写起点和终点'); return; }

          const btn = $('#tpGo');
          btn.disabled = true;
          btn.innerHTML = '查询中…';
          $('#tpResults').innerHTML = '<div class="egroup-empty">正在查询瑞士铁路实时班次…</div>';

          tpRefs = { from: from, to: to };

          SERVICES.connections({
            from: from, to: to,
            date: $('#tpDate').value || day.date,
            time: $('#tpTime').value || '08:00',
            limit: 4,
          }).then(function (list) {
            tpConns = list;
            tpOpen = {};
            btn.disabled = false;
            btn.innerHTML = icon('train') + '重新查询';
            renderConnections();
            scrollResultsIntoView();
            toast('查到 ' + list.length + ' 个班次');
          }).catch(function (e) {
            btn.disabled = false;
            btn.innerHTML = icon('train') + '查询可行班次';
            $('#tpResults').innerHTML = '<div class="egroup-empty">' +
              esc(e.message || '查询失败') + '<br>可以直接用下面的「手动添加一段交通」。</div>';
            scrollResultsIntoView();
            toast(e.message || '查询失败');
          });
        });
      }, 'editor');
  }

  /** the leg fields, shared by "add manually" and "edit this leg" */
  function legFormHtml(day, leg) {
    const l = leg || {};
    return '<div class="field"><label>起点</label>' +
        '<input id="mlFrom" type="text" placeholder="例如 酒店" value="' + esc(l.from || '') + '"></div>' +
      '<div class="field"><label>终点</label>' +
        '<input id="mlTo" type="text" placeholder="例如 缆车站" value="' + esc(l.to || '') + '"></div>' +
      quickChips(dayQuickRefs(day), 'data-leg-set', '当天地点与酒店 · 点一下按顺序填入') +
      '<div class="chip-hint" id="mlChipHint">下一步点击将填入：起点</div>' +
      '<div class="field"><label>方式</label>' +
        '<input id="mlMode" type="text" placeholder="例如 步行 / 缆车 / 出租车" value="' + esc(l.mode || '') + '"></div>' +
      '<div class="field"><label>耗时</label>' +
        '<input id="mlDur" type="text" placeholder="例如 约 15 分钟" value="' + esc(l.duration || '') + '"></div>' +
      '<div class="tp-when">' +
        '<div class="field" style="flex:1"><label>计划时间（可选）</label>' +
          '<input id="mlTime" type="time" value="' + esc(l.time || '') + '"></div>' +
        '<div class="field" style="flex:1"><label>已订发车（可选）</label>' +
          '<input id="mlBooked" type="time" value="' + esc(l.booked || '') + '"></div>' +
      '</div>' +
      '<div class="hint">填了时间，「按发车时间排」才有依据。</div>' +
      '<div class="field"><label>备注（可选）</label>' +
        '<input id="mlNote" type="text" placeholder="例如 需提前买票" value="' + esc(l.note || '') + '"></div>';
  }

  /**
   * @deprecated — use wireSeqChips() so manual-add and edit-leg chips share
   * the same 起点→终点 sequence + live hint as the transport picker.
   */
  function wireLegChips(root) {
    wireSeqChips(root, '#mlFrom', '#mlTo', 'data-leg-set', $('#mlChipHint'));
  }

  function legFormValues() {
    return {
      from: $('#mlFrom').value.trim(),
      to: $('#mlTo').value.trim(),
      mode: $('#mlMode').value.trim(),
      duration: $('#mlDur').value.trim(),
      note: $('#mlNote').value.trim(),
      time: $('#mlTime').value || null,
      booked: $('#mlBooked').value || null,
    };
  }

  function openManualLeg(dayIndex) {
    const day = DAYS[dayIndex];
    openSheet('手动添加交通', day.dow + ' · ' + day.title,
      legFormHtml(day, null) +
      '<button class="btn block primary" id="mlSave" style="height:46px">' + icon('check') + '保存</button>',
      function () {
        const inner = $('.sheet-inner');
        wireLegChips(inner);
        $('#mlFrom').focus();
        $('#mlSave').addEventListener('click', function () {
          const v = legFormValues();
          if (!v.from && !v.to) { toast('请填写起点或终点'); return; }
          STORE.addLeg(day.id, v);
          refreshAfterEdit();
          openDayEditor(dayIndex);
          toast('已添加');
        });
      }, 'editor');
  }

  /** edit an existing leg — a base leg is hidden and replaced by an edited copy */
  function openLegEditor(dayIndex, legIndex) {
    const day = DAYS[dayIndex];
    const leg = day.transport[legIndex];
    if (!leg) return;

    openSheet('编辑交通', day.dow + ' · ' + day.title,
      legFormHtml(day, leg) +
      '<button class="btn block primary" id="mlSave" style="height:46px">' + icon('check') + '保存修改</button>',
      function () {
        const inner = $('.sheet-inner');
        wireLegChips(inner);
        $('#mlSave').addEventListener('click', function () {
          const v = legFormValues();
          if (!v.from && !v.to) { toast('请填写起点或终点'); return; }
          STORE.updateLeg(day.id, legIndex, v);
          refreshAfterEdit();
          openDayEditor(dayIndex);
          toast('已保存');
        });
      }, 'editor');
  }

  /* ======================== TRANSLATE ================================= */

  const LANGS = [
    { id: 'zh', label: '中文', code: 'zh-CN' },
    { id: 'en', label: 'English', code: 'en' },
    { id: 'de', label: 'Deutsch', code: 'de' },
  ];

  const tr = { from: 'zh', to: 'de', group: 'transport', q: '', busy: false, result: null, error: null };

  function langCode(id) {
    const l = LANGS.filter(function (x) { return x.id === id; })[0];
    return l ? l.code : 'en';
  }

  function trFetch(url, ms) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(function () { ctl.abort(); }, ms || 9000) : null;
    return fetch(url, { mode: 'cors', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (timer) clearTimeout(timer); return r; })
      .catch(function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  /**
   * Try the keyless endpoints in order of quality. Google's gtx endpoint gives
   * the best results but is unreachable from some networks; MyMemory is the
   * reliable fallback (though it cannot translate *out of* Chinese).
   */
  function translateText(text, from, to) {
    const q = String(text || '').trim();
    if (!q) return Promise.reject(new Error('请先输入要翻译的内容'));

    const engines = [
      {
        name: 'Google 翻译',
        run: function () {
          return trFetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=' +
            encodeURIComponent(langCode(from)) + '&tl=' + encodeURIComponent(langCode(to)) +
            '&dt=t&q=' + encodeURIComponent(q))
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (j) {
              const out = (j[0] || []).map(function (x) { return x && x[0]; }).filter(Boolean).join('');
              if (!out) throw new Error('empty');
              return out;
            });
        },
      },
      {
        name: 'MyMemory',
        run: function () {
          return trFetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) +
            '&langpair=' + encodeURIComponent(langCode(from)) + '|' + encodeURIComponent(langCode(to)))
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (j) {
              const out = j && j.responseData && j.responseData.translatedText;
              if (!out || /MYMEMORY WARNING/i.test(out)) throw new Error('unsupported');
              return out;
            });
        },
      },
    ];

    return engines.reduce(function (chain, eng) {
      return chain.catch(function () {
        return eng.run().then(function (text2) {
          return { text: text2, engine: eng.name };
        });
      });
    }, Promise.reject(new Error('start')));
  }

  function phraseGroups() {
    return typeof PHRASE_GROUPS === 'undefined' ? [] : PHRASE_GROUPS;
  }

  function phraseMatches(q) {
    const query = String(q || '').trim().toLowerCase();
    const all = [];
    phraseGroups().forEach(function (g) {
      g.items.forEach(function (it) {
        // it[3] is an optional synonym list, so colloquial wording still hits
        all.push({ group: g, zh: it[0], en: it[1], de: it[2], alt: it[3] || '' });
      });
    });
    if (!query) return null;
    return all.filter(function (p) {
      return (p.zh + ' ' + p.en + ' ' + p.de + ' ' + p.alt).toLowerCase().indexOf(query) >= 0;
    });
  }

  function renderTranslate() {
    const box = $('#translateBody');
    if (!box) return;

    const found = phraseMatches(tr.q);
    const groups = phraseGroups();
    const activeGroup = groups.filter(function (g) { return g.id === tr.group; })[0] || groups[0];

    const list = found || (activeGroup ? activeGroup.items.map(function (it) {
      return { group: activeGroup, zh: it[0], en: it[1], de: it[2] };
    }) : []);

    box.innerHTML =
      /* ---- free translation ---- */
      '<div class="sec" style="margin-top:16px">' +
        '<div class="card"><div class="card-bd">' +
          '<div class="tr-head">' +
            '<button class="tr-lang" data-tr-from="' + tr.from + '">' + esc(langLabel(tr.from)) + '</button>' +
            '<button class="tr-swap" data-tr-swap="1" aria-label="互换">' + icon('swap') + '</button>' +
            '<button class="tr-lang" data-tr-to="' + tr.to + '">' + esc(langLabel(tr.to)) + '</button>' +
          '</div>' +
          '<textarea id="trInput" class="tr-input" rows="3" ' +
            'placeholder="输入要翻译的内容…">' + esc(tr.q) + '</textarea>' +
          '<button class="btn block primary" id="trGo" style="height:46px"' +
            (tr.busy ? ' disabled' : '') + '>' +
            (tr.busy ? '翻译中…' : icon('globe') + '翻译') + '</button>' +
          (tr.result ? '<div class="tr-out"><b>' + esc(tr.result.text) + '</b>' +
            '<div class="tr-out-foot"><span>由 ' + esc(tr.result.engine) + ' 提供</span>' +
              '<button class="tr-say wide" data-say-result="1" data-say-lang="' + tr.to + '">' +
                icon('speak') + '朗读</button></div></div>' : '') +
          (tr.error ? '<div class="tr-err">' + esc(tr.error) +
            '<div class="btn-row" style="margin-top:10px">' +
              '<a class="btn sm ghost" target="_blank" rel="noopener" href="' +
                trExternal('google') + '">用 Google 翻译打开</a>' +
              '<a class="btn sm ghost" target="_blank" rel="noopener" href="' +
                trExternal('deepl') + '">用 DeepL 打开</a>' +
            '</div>' +
            '<div style="margin-top:8px;font-size:11.5px;line-height:1.6;color:var(--muted)">' +
              '免费翻译接口不稳定，点上面两个按钮会用手机浏览器打开完整翻译页面，' +
              '文字已经帮你填好了。' +
            '</div>' +
          '</div>' : '') +
        '</div></div>' +
      '</div>' +

      /* ---- phrasebook ---- */
      '<div class="sec">' +
        '<div class="sec-head"><h2>旅行常用短语</h2>' +
          '<span class="more">' + (found ? found.length + ' 条结果' : '离线可用') + '</span></div>' +
        '<div class="field" style="margin-bottom:12px">' +
          '<input id="trSearch" type="search" placeholder="搜索短语（中文 / English / Deutsch）" ' +
            'autocomplete="off" value="' + esc(tr.q) + '">' +
        '</div>' +
        (found ? '' :
          '<div class="chips-row" style="margin-bottom:12px">' + groups.map(function (g) {
            return '<button class="chip' + (g.id === activeGroup.id ? ' is-on' : '') + '" ' +
              'data-tr-group="' + g.id + '">' + esc(g.label) + '</button>';
          }).join('') + '</div>') +
        '<div class="tr-list">' +
          (list.length ? list.map(function (p, i) {
            return '<div class="tr-phrase" data-tr-big="' + i + '" role="button" tabindex="0">' +
              '<span class="tr-tx">' +
                '<span class="tr-zh">' + esc(p.zh) + '</span>' +
                '<span class="tr-en">' + esc(p.en) + '</span>' +
                '<span class="tr-de">' + esc(p.de) + '</span>' +
              '</span>' +
              '<button class="tr-say" data-say-phrase="' + i + '" data-say-lang="' + tr.to + '" ' +
                'aria-label="朗读' + esc(langLabel(tr.to)) + '">' + icon('speak') + '</button>' +
            '</div>';
          }).join('') : '<div class="empty">没有匹配的短语</div>') +
        '</div>' +
      '</div>' +
      '<div class="sec"><div class="card"><div class="card-bd">' +
        '<div style="font-size:11.5px;line-height:1.7;color:var(--muted)">' +
          '短语手册是内置的，<b>没网也能用</b> —— 直接点开一条，把屏幕给对方看就行。' +
          '瑞士德语区日常说德语，大部分人也能听懂英语；法语区（日内瓦）法语为主，英语通用。' +
        '</div>' +
      '</div></div></div>';

    trList = list;
    wireTranslate();
  }

  let trList = [];

  function langLabel(id) {
    const l = LANGS.filter(function (x) { return x.id === id; })[0];
    return l ? l.label : id;
  }

  function nextLang(id, dir) {
    const i = LANGS.map(function (l) { return l.id; }).indexOf(id);
    const n = ((i < 0 ? 0 : i) + (dir || 1) + LANGS.length) % LANGS.length;
    return LANGS[n].id;
  }

  /* ---- speech playback ----------------------------------------------- */
  /* Web Speech API: built into the browser, no key, no network. Which voices
     exist varies a lot by device, so nothing here is assumed — if there is no
     matching voice we still hand the text to the engine with just a lang tag,
     and if the API is missing altogether we say so instead of failing quietly. */
  const TTS_LANG = { zh: 'zh-CN', en: 'en-US', de: 'de-DE' };
  let ttsVoices = [];

  function ttsSupported() {
    return typeof speechSynthesis !== 'undefined' &&
      typeof SpeechSynthesisUtterance !== 'undefined';
  }

  function ttsRefresh() {
    if (!ttsSupported()) return;
    try { ttsVoices = speechSynthesis.getVoices() || []; } catch (e) { ttsVoices = []; }
  }

  function ttsPick(langId) {
    const want = String(TTS_LANG[langId] || 'en-US').toLowerCase();
    const base = want.slice(0, 2);
    const norm = function (v) { return String(v.lang || '').toLowerCase().replace('_', '-'); };
    const exact = ttsVoices.filter(function (v) { return norm(v) === want; });
    const loose = ttsVoices.filter(function (v) { return norm(v).indexOf(base) === 0; });
    const pool = exact.length ? exact : loose;
    if (!pool.length) return null;
    // a local voice keeps working in a valley with no signal
    return pool.filter(function (v) { return v.localService; })[0] || pool[0];
  }

  /** true if something was actually spoken */
  function speak(text, langId) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return false;
    if (!ttsSupported()) { toast('这台设备不支持语音朗读'); return false; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      const v = ttsPick(langId);
      if (v) u.voice = v;
      u.lang = v ? v.lang : (TTS_LANG[langId] || 'en-US');
      u.rate = 0.88;          // slower than native: the point is to be understood
      u.pitch = 1;
      speechSynthesis.speak(u);
      return true;
    } catch (e) {
      toast('朗读失败');
      return false;
    }
  }

  /** one phrase in one language, by index into the currently rendered list */
  function speakPhrase(index, langId) {
    const p = trList[index];
    if (!p) return;
    speak(langId === 'zh' ? p.zh : langId === 'de' ? p.de : p.en, langId);
  }

  /* ---- add a photo spot ---------------------------------------------- */
  let phResults = [];

  function renderPhResults(list, stillSearching) {
    const box = $('#phResults');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<div class="egroup-empty">' +
        (stillSearching ? '搜索中…' : '没找到，换个关键词') + '</div>';
      return;
    }
    box.innerHTML =
      (stillSearching ? '<div class="egroup-empty" style="margin-bottom:8px">已找到 ' +
        list.length + ' 个，继续搜索中…</div>' : '') +
      list.map(function (p, i) {
        return '<button class="place" data-ph-add="' + i + '">' +
          '<span class="place-ic" style="--tint:#d03a2f;--tint-soft:#fdeceb">' + icon('camera') + '</span>' +
          '<span class="place-tx"><b>' + esc(p.name) + '</b><span>' +
            esc((p.source === 'station' ? '车站' : '地点') + ' · ' +
              p.lat.toFixed(4) + ', ' + p.lng.toFixed(4)) +
          '</span></span>' +
          '<span class="place-go">' + icon('plus') + '</span>' +
        '</button>';
      }).join('');
  }

  /**
   * Add a photo spot. The primary path reads the device GPS, then lets you
   * either shoot a photo (rear camera) or pick one from the gallery — the image
   * is stored in IndexedDB and shown as a small thumbnail pin on the map, and
   * tapping the pin previews it in a small popup box. A legacy "search a place
   * by name" path is kept below for adding a known viewpoint.
   */
  function openPhotoAdd() {
    // Default to the day the map is currently showing (its legend filter) — that
    // is the day the traveller clicked and is looking at — falling back to the
    // selected day. This is read regardless of the active view so a photo always
    // lands on the day on screen instead of needing a manual fix afterwards.
    const mf = String(state.mapFilter);
    const defIdx = /^\d+$/.test(mf) ? clamp(Number(mf), 0, DAYS.length - 1) : state.sel;
    const st = { lat: null, lng: null, blob: null, url: null, dayIdx: defIdx };
    let searchTimer = null, searchSeq = 0;
    phResults = [];

    // which day does this photo actually belong to? defaults to the day the
    // app is currently showing, but the traveller can pick the real one — this
    // is the fix for photos getting recorded under the wrong day.
    const dayOpts = DAYS.map(function (d, i) {
      const di = dateInfo(d.date);
      return '<option value="' + i + '"' + (i === st.dayIdx ? ' selected' : '') + '>' +
        esc(d.dow) + ' · ' + pad2(di.day) + di.month + ' · ' + esc(d.title) + '</option>';
    }).join('');
    const day = function () { return DAYS[st.dayIdx]; };

    openSheet('添加拍照点', '选好日期，再拍 / 上传',
      // ---- Section A: current location + photo (primary) ----
      '<div class="pa-card">' +
        '<div class="field" style="margin-bottom:12px"><label>所属日期</label>' +
          '<select id="paDay" class="pa-day">' + dayOpts + '</select></div>' +
        '<div class="pa-h">' + icon('camera') + '用当前位置 + 照片</div>' +
        '<button class="btn block primary" id="paLoc">' + icon('pin') + '读取我的位置（GPS）</button>' +
        '<div id="paLocMsg" class="pa-msg" style="display:none"></div>' +
        '<div id="paManual" style="display:none">' +
          '<div class="pa-row2">' +
            '<div class="field" style="margin:0"><input id="paLat" type="number" step="any" ' +
              'placeholder="纬度 lat" inputmode="decimal"></div>' +
            '<div class="field" style="margin:0"><input id="paLng" type="number" step="any" ' +
              'placeholder="经度 lng" inputmode="decimal"></div>' +
          '</div>' +
          '<button class="btn block" id="paManualOk">用这个坐标</button>' +
        '</div>' +
        '<div id="paStep2" style="display:none">' +
          '<div class="pa-row2">' +
            '<button class="btn block" id="paCam">' + icon('camera') + '拍照</button>' +
            '<button class="btn block" id="paUp">' + icon('upload') + '上传</button>' +
          '</div>' +
          '<div class="pa-hint">「拍照」调用后置摄像头；「上传」从相册或文件选择。</div>' +
        '</div>' +
        '<div id="paStep3" style="display:none">' +
          '<div class="pa-prev"><img id="paPrevImg" alt="预览"></div>' +
          '<div class="field"><label>名称（可选）</label>' +
            '<input id="paName" type="text" placeholder="例如 湖边日落"></div>' +
          '<div class="field"><label>拍摄备注（可选）</label>' +
            '<input id="paTip" type="text" placeholder="例如 清晨逆光"></div>' +
          '<button class="btn block primary" id="paSave">' + icon('check') + '保存拍照点</button>' +
        '</div>' +
      '</div>' +
      // ---- Section B: search a place by name (legacy) ----
      '<div class="sheet-sep"></div>' +
      '<details class="pa-more" id="paSearch">' +
        '<summary>或者按名称搜索地点添加</summary>' +
        '<div class="field"><label>搜索地点</label>' +
          '<input id="phQuery" type="search" placeholder="Bachalpsee / 观景台 / 车站名" ' +
            'autocomplete="off" autocapitalize="off"></div>' +
        '<div id="phResults"><div class="egroup-empty">输入至少 2 个字开始搜索</div></div>' +
      '</details>',
      function () {
        const $day = $('#paDay');
        if ($day) $day.addEventListener('change', function () {
          st.dayIdx = parseInt($day.value, 10) || 0;
        });

        const $loc = $('#paLoc');
        if ($loc) $loc.addEventListener('click', readLoc);

        const $manualOk = $('#paManualOk');
        if ($manualOk) $manualOk.addEventListener('click', function () {
          const la = parseFloat(($('#paLat') || {}).value);
          const ln = parseFloat(($('#paLng') || {}).value);
          if (isNaN(la) || isNaN(ln)) { paMsg('请填写有效的纬度和经度', 'err'); return; }
          st.lat = la; st.lng = ln; revealStep2();
        });

        const $cam = $('#paCam');
        if ($cam) $cam.addEventListener('click', function () { pickPhotoFile(true); });
        const $up = $('#paUp');
        if ($up) $up.addEventListener('click', function () { pickPhotoFile(false); });

        const $save = $('#paSave');
        if ($save) $save.addEventListener('click', savePhotoSpot);

        wirePhotoSearch();
      }, 'place');

    function paMsg(txt, kind) {
      const m = $('#paLocMsg');
      if (!m) return;
      m.textContent = txt;
      m.style.display = 'block';
      m.className = 'pa-msg' + (kind ? ' ' + kind : '');
    }

    function revealStep2() {
      const b = $('#paStep2'); if (b) b.style.display = 'block';
      const mm = $('#paManual'); if (mm) mm.style.display = 'none';
    }

    function readLoc() {
      if (!('geolocation' in navigator)) {
        paMsg('此设备不支持定位。可手动填写坐标，或用下方按名称搜索。', 'err');
        const mm = $('#paManual'); if (mm) mm.style.display = 'block';
        return;
      }
      const btn = $('#paLoc');
      if (btn) { btn.disabled = true; btn.innerHTML = '定位中…'; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        st.lat = pos.coords.latitude; st.lng = pos.coords.longitude;
        if (btn) btn.style.display = 'none';
        paMsg('已定位 ✓  ' + st.lat.toFixed(5) + ', ' + st.lng.toFixed(5), 'ok');
        revealStep2();
      }, function (err) {
        if (btn) { btn.disabled = false; btn.innerHTML = icon('pin') + '重新读取位置'; }
        paMsg('无法获取定位（' + (err && err.message ? err.message : '已拒绝权限') +
          '）。可手动填写坐标，或用下方按名称搜索。', 'err');
        const mm = $('#paManual'); if (mm) mm.style.display = 'block';
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    }

    function pickPhotoFile(camera) {
      if (st.lat == null || st.lng == null) { paMsg('请先定位再选照片', 'err'); return; }
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      if (camera) inp.setAttribute('capture', 'environment');
      inp.addEventListener('change', function () {
        const f = inp.files && inp.files[0];
        if (!f) return;
        if (st.url) URL.revokeObjectURL(st.url);
        st.blob = f;
        st.url = URL.createObjectURL(f);
        const img = $('#paPrevImg');
        if (img) img.src = st.url;
        const s3 = $('#paStep3'); if (s3) s3.style.display = 'block';
      });
      inp.click();
    }

    function savePhotoSpot() {
      if (st.lat == null || st.lng == null) { toast('请先定位'); return; }
      if (!st.blob) { toast('请先拍照或上传照片'); return; }
      const name = (($('#paName') || {}).value || '').trim();
      const tip = (($('#paTip') || {}).value || '').trim();
      const photoId = 'ph' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      IDB.put({ id: photoId, name: name || '拍照点', blob: st.blob, ts: Date.now() }).then(function () {
        const spotDayId = day().id;
        STORE.addPhotoSpot({
          day: spotDayId, region: day().region,
          name: name || ('我的拍照点 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })),
          nameEn: '', lat: st.lat, lng: st.lng, best: '', tip: tip, photoId: photoId,
        });
        if (st.url) { URL.revokeObjectURL(st.url); st.url = null; }
        closeSheet();
        // if the map is filtered to another day, switch to the spot's day so the
        // traveller immediately sees the one they just added
        const spotIdx = DAYS.map(function (d) { return d.id; }).indexOf(spotDayId);
        if (state.mapReady && state.mapFilter !== 'all' &&
            spotIdx >= 0 && String(spotIdx) !== state.mapFilter) {
          state.mapFilter = String(spotIdx);
          renderMapLegend();
        }
        refreshAfterEdit();
        if (state.mapReady) renderMapContent();
        toast('已添加拍照点');
      }).catch(function (e) {
        toast('保存失败：' + ((e && e.message) || '本地存储不可用'));
      });
    }

    function wirePhotoSearch() {
      const q = $('#phQuery');
      if (!q) return;
      q.addEventListener('input', function () {
        clearTimeout(searchTimer);
        const v = q.value.trim();
        const mine = ++searchSeq;
        if (v.length < 2) {
          $('#phResults').innerHTML = '<div class="egroup-empty">输入至少 2 个字开始搜索</div>';
          return;
        }
        $('#phResults').innerHTML = '<div class="egroup-empty">搜索中…</div>';
        searchTimer = setTimeout(function () {
          SERVICES.searchPlacesStreaming(v, function (list, finished) {
            if (mine !== searchSeq) return;
            phResults = list;
            renderPhResults(list, !finished);
          });
        }, 380);
      });
      $('#phResults').addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-ph-add]');
        if (!b) return;
        const p = phResults[Number(b.dataset.phAdd)];
        if (!p) return;
        const spotDayId = day().id;
        STORE.addPhotoSpot({
          day: spotDayId, region: day().region,
          name: p.name, nameEn: p.nameEn,
          lat: p.lat, lng: p.lng,
          tip: (($('#paTip') || {}).value || '').trim(), best: '',
        });
        closeSheet();
        const spotIdx = DAYS.map(function (d) { return d.id; }).indexOf(spotDayId);
        if (state.mapReady && state.mapFilter !== 'all' &&
            spotIdx >= 0 && String(spotIdx) !== state.mapFilter) {
          state.mapFilter = String(spotIdx);
          renderMapLegend();
        }
        refreshAfterEdit();
        if (state.mapReady) renderMapContent();
        toast('已添加拍照点「' + p.name + '」');
      });
    }
  }

  function trExternal(which) {
    const q = tr.q || '';
    if (which === 'deepl') {
      return 'https://www.deepl.com/translator#' + tr.from + '/' + tr.to + '/' + encodeURIComponent(q);
    }
    return 'https://translate.google.com/?sl=' + langCode(tr.from) + '&tl=' + langCode(tr.to) +
      '&text=' + encodeURIComponent(q) + '&op=translate';
  }

  function wireTranslate() {
    const inp = $('#trInput');
    if (inp) {
      inp.addEventListener('input', function () { tr.q = inp.value; });
    }
    const search = $('#trSearch');
    if (search) {
      let t = null;
      search.addEventListener('input', function () {
        clearTimeout(t);
        const v = search.value;
        t = setTimeout(function () {
          tr.q = v;
          const box = $('#translateBody');
          const scroll = window.scrollY;
          renderTranslate();
          window.scrollTo(0, scroll);
        }, 220);
      });
    }
    const go = $('#trGo');
    if (go) {
      go.addEventListener('click', function () {
        tr.q = ($('#trInput') || {}).value || tr.q;
        tr.busy = true; tr.error = null; tr.result = null;
        renderTranslate();
        translateText(tr.q, tr.from, tr.to).then(function (r) {
          tr.busy = false; tr.result = r; renderTranslate();
        }).catch(function (e) {
          tr.busy = false;
          tr.error = (e && e.message === '请先输入要翻译的内容') ? e.message : '在线翻译接口暂时不可用';
          renderTranslate();
        });
      });
    }
  }

  /* ---- big-display sheet, for showing someone your screen ---- */
  function openPhrase(idx) {
    const p = trList[idx];
    if (!p) return;
    const row = function (label, text, cls, langId) {
      return '<div class="big-line ' + cls + '">' +
        '<span class="big-lang">' + label + '</span>' +
        '<b>' + esc(text) + '</b>' +
        '<button class="big-say" data-say-phrase="' + idx + '" data-say-lang="' + langId + '" ' +
          'aria-label="朗读' + label + '">' + icon('speak') + '</button>' +
      '</div>';
    };
    openSheet('给对方看', p.group ? p.group.label : '短语',
      row('中文', p.zh, 'zh', 'zh') + row('English', p.en, 'en', 'en') + row('Deutsch', p.de, 'de', 'de') +
      '<div style="margin-top:14px;font-size:11.5px;line-height:1.6;color:var(--muted)">' +
        '把手机转过去给对方看即可，不需要联网。点右边的喇叭可以读出来。' +
      '</div>', null, 'phrase');
  }

  /* ======================== reordering ================================ */

  /** move one item one slot up (-1) or down (+1) in a day's list */
  function moveKey(dayId, kind, key, dir) {
    const keys = STORE.orderKeys(dayId, kind);
    const i = keys.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= keys.length) return false;
    const next = keys.slice();
    next.splice(i, 1);
    next.splice(j, 0, key);
    STORE.setOrder(dayId, kind, next);
    return true;
  }

  function sortingThis(kind, dayId) {
    return state.sorting && state.sorting.kind === kind && state.sorting.dayId === dayId;
  }

  function sortBarHtml(dayId, kind) {
    const auto = STORE.sortMode(dayId, kind) === 'auto';
    const label = kind === 't' ? '按发车时间排'
      : kind === 'p' ? '按行程时间排' : '按时间排序';
    return '<div class="sortbar">' +
      '<span class="sortbar-tx">' +
        icon('sort') + '排序模式 · 用 ↑↓ 调整' +
      '</span>' +
      (!auto
        ? '<button class="btn sm ghost" data-sort-auto="1">' + label + '</button>'
        : '') +
      '<button class="btn sm primary" data-sort-done="1">完成</button>' +
    '</div>';
  }

  /** attach long-press-to-sort to a freshly rendered list */
  function attachHold(container, dayId, kind) {
    if (!container) return;
    let timer = null, startY = 0, startX = 0, fired = false;

    const cancel = function () {
      if (timer) { clearTimeout(timer); timer = null; }
    };

    container.addEventListener('pointerdown', function (e) {
      if (state.sorting) return;
      const row = e.target.closest('[data-hold]');
      if (!row) return;
      // ignore the control buttons inside a row, but allow the row itself even
      // when it is a <button> (place rows are), so a tap still opens it
      if (e.target.closest('.sortbtn, .photo-x, .ledger-del, .place-go')) return;
      startY = e.clientY; startX = e.clientX;
      fired = false;
      cancel();
      timer = setTimeout(function () {
        timer = null;
        fired = true;
        state.sorting = { dayId: dayId, kind: kind };
        if (navigator.vibrate) { try { navigator.vibrate(14); } catch (err) {} }
        renderToday();
        toast('已进入排序模式');
      }, 480);
    });
    container.addEventListener('pointermove', function (e) {
      if (!timer) return;
      if (Math.abs(e.clientY - startY) > 10 || Math.abs(e.clientX - startX) > 10) cancel();
    });
    container.addEventListener('pointerup', cancel);
    container.addEventListener('pointercancel', cancel);
    container.addEventListener('pointerleave', cancel);

    // swallow the click that follows a long-press, so it does not also open
    // whatever the row normally opens
    container.addEventListener('click', function (e) {
      if (fired) {
        fired = false;
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    container.addEventListener('contextmenu', function (e) {
      if (e.target.closest('[data-hold]')) e.preventDefault();
    });
  }

  /* ======================== sheets ==================================== */
  let sheetOpen = false;
  let sheetKind = null;

  function openSheet(title, sub, body, after, kind) {
    $('#sheetTitle').textContent = title;
    $('#sheetSub').textContent = sub || '';
    // wrap in a fresh node: anything that binds to `.sheet-inner` is discarded
    // when the next sheet opens, so listeners never accumulate
    $('#sheetBody').innerHTML = '<div class="sheet-inner">' + body + '</div>';
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

  /* ---- edit this day: city (searchable) + route title + summary ------ */
  // each weather query point implies the region whose label + colour the
  // itinerary and map use, so swapping to a city updates both in sync.
  const WP_REGION = {
    geneva: 'geneva', grindelwald: 'alps', first: 'alps',
    wengen: 'valley', zurich: 'zurich', rheinfall: 'zurich', gva: 'transit',
  };
  // a searched city gets a theme colour picked from this palette (stable per city)
  const CITY_PALETTE = [
    { color: '#2E7D9A', soft: '#E6F1F5' }, { color: '#1F6F4A', soft: '#E5F2EC' },
    { color: '#3B6EA5', soft: '#E7EEF7' }, { color: '#6B4E9E', soft: '#EFEAF7' },
    { color: '#B5651D', soft: '#F7EFE6' }, { color: '#A03A5A', soft: '#F7E9EE' },
    { color: '#4C7A6B', soft: '#E8F1EE' }, { color: '#5A6572', soft: '#EDEFF2' },
  ];

  /** stable id for a searched city, derived from its coordinates */
  function cityKeyFor(lat, lng) {
    const s = Number(lat).toFixed(4) + ',' + Number(lng).toFixed(4);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'c' + h.toString(36);
  }
  function cityPaletteFor(key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return CITY_PALETTE[h % CITY_PALETTE.length];
  }

  function predefinedCityOptions() {
    if (typeof WEATHER_PLACES === 'undefined') return [];
    return Object.keys(WP_REGION).filter(function (p) { return WEATHER_PLACES[p]; })
      .map(function (place) {
        const wp = WEATHER_PLACES[place], region = WP_REGION[place];
        const rg = REGIONS[region] || REGIONS.transit;
        return {
          place: place, wLabel: wp.label, wElev: wp.elev || '',
          region: region, rLabel: rg.label, rColor: rg.color,
        };
      });
  }

  /** the city block: current city, a search box, and the common cities */
  function citySectionHtml(day) {
    const r = regionOf(day);
    const wp = (typeof WEATHER !== 'undefined' ? WEATHER.placeFor(day) : null);
    const rows = predefinedCityOptions().map(function (o) {
      const on = (o.region === day.region && o.place === day.weatherPlace);
      return '<button class="cs-row' + (on ? ' is-on' : '') + '" data-city-pre="' + o.place + '" ' +
          'style="--c:' + o.rColor + '">' +
        '<span class="cs-dot" style="background:' + o.rColor + '"></span>' +
        '<span class="cs-tx"><b>' + esc(o.rLabel) + '</b>' +
          '<span>天气读取：' + esc(o.wLabel) + (o.wElev ? ' · ' + esc(o.wElev) : '') + '</span></span>' +
        (on ? '<span class="cs-on">当前</span>' : '<span class="cs-go">' + icon('check') + '</span>') +
      '</button>';
    }).join('');

    return '<div class="cs-cur" style="--c:' + r.color + '">' +
        '<span class="cs-dot" style="background:' + r.color + '"></span>' +
        '<span class="cs-tx"><b>' + esc(r.label) + '</b>' +
          '<span>当前城市 · 天气读取：' + esc((wp && wp.label) || r.label) + '</span></span>' +
      '</div>' +
      '<div class="field" style="margin-top:10px"><label>搜索城市（任意城市）</label>' +
        '<input id="dmCityQ" type="search" placeholder="例如 卢塞恩 / Lucerne / Interlaken" ' +
          'autocomplete="off" autocapitalize="off"></div>' +
      '<div id="dmCityRes" class="cs-res"></div>' +
      '<div class="cs-sub">或选择常用城市</div>' +
      '<div class="cs-list">' + rows + '</div>';
  }

  /**
   * City geocoding, wrapped so the promise ALWAYS settles. If the service is
   * missing or throws synchronously, the caller's .catch runs and the UI stops
   * showing "搜索中…" instead of hanging forever.
   */
  function geocodeCity(q) {
    if (typeof SERVICES === 'undefined') return Promise.reject(new Error('搜索服务不可用'));
    // query two independent geocoders in parallel and merge — if one is slow,
    // blocked or empty, the other still returns cities
    const calls = [];
    if (typeof SERVICES.searchGeocode === 'function') {
      calls.push(Promise.resolve().then(function () { return SERVICES.searchGeocode(q); })
        .catch(function () { return []; }));
    }
    if (typeof SERVICES.searchOsm === 'function') {
      calls.push(Promise.resolve().then(function () { return SERVICES.searchOsm(q); })
        .catch(function () { return []; }));
    }
    if (!calls.length) return Promise.reject(new Error('搜索服务不可用'));
    return Promise.all(calls).then(function (lists) {
      const out = [], seen = {};
      lists.forEach(function (l) {
        (l || []).forEach(function (c) {
          if (!c || c.lat == null || c.lng == null) return;
          const k = String(c.name).toLowerCase();
          if (seen[k]) return;
          seen[k] = 1;
          out.push(c);
        });
      });
      return out;
    });
  }

  function renderCityResults(list) {
    const box = $('#dmCityRes');
    if (!box) return;
    if (!list || !list.length) {
      box.innerHTML = '<div class="egroup-empty">没找到，换个关键词</div>';
      return;
    }
    box.innerHTML = list.map(function (c, i) {
      return '<button class="cs-row" data-city-new="' + i + '">' +
        '<span class="cs-dot" style="background:var(--faint)"></span>' +
        '<span class="cs-tx"><b>' + esc(c.name) + '</b><span>' +
          esc(c.note || '') + ' · ' + c.lat.toFixed(3) + ', ' + c.lng.toFixed(3) +
        '</span></span>' +
        '<span class="cs-go">' + icon('plus') + '</span></button>';
    }).join('');
  }

  /** open the "编辑这一天" sheet for the currently selected day */
  function openDayMetaEditor() {
    if (typeof WEATHER === 'undefined') return;
    const day = DAYS[state.sel];
    let cityResults = [], timer = null, seq = 0, delArmed = false;

    openSheet('编辑这一天', day.dow + ' · ' + day.title,
      '<div class="cs-note">可以改这一天的<b>城市</b>（天气读取的城市、行程与地图上的城市名会' +
        '<b>联动</b>改变），也可以改上面的<b>路线标题</b>与<b>概述</b>、设置<b>住宿</b>。</div>' +
      '<div class="dm-h">' + icon('pin') + '城市</div>' +
      citySectionHtml(day) +
      '<div class="sheet-sep"></div>' +
      '<div class="dm-h">' + icon('bed') + '住宿</div>' +
      hotelSectionHtml(day) +
      '<div class="sheet-sep"></div>' +
      '<div class="dm-h">' + icon('edit') + '文字</div>' +
      '<div class="field"><label>路线标题</label>' +
        '<input id="dmTitle" type="text" value="' + esc(day.title) + '"></div>' +
      '<div class="field"><label>英文标题（可选）</label>' +
        '<input id="dmTitleEn" type="text" value="' + esc(day.titleEn || '') + '"></div>' +
      '<div class="field"><label>概述</label>' +
        '<textarea id="dmSummary" rows="3">' + esc(day.summary || '') + '</textarea></div>' +
      '<button class="btn block primary" id="dmSave">' + icon('check') + '保存文字</button>' +
      '<button class="btn block ghost dm-del" id="dmDel" style="margin-top:10px">' +
        icon('trash') + (STORE.isExtraDay(day.id) ? '删除这一天' : '从行程中删除这一天') + '</button>' +
      '<div id="dmDelHint" class="dm-del-hint">' +
        (STORE.isExtraDay(day.id)
          ? '这一天是你自己加的，删除后无法恢复。'
          : '行程原有的日期会被「隐藏」，之后可在「更多 → 我的修改」里恢复。') +
      '</div>',
      function () {
        const inner = $('.sheet-inner');
        inner.addEventListener('click', function (ev) {
          const pre = ev.target.closest('[data-city-pre]');
          if (pre) { pickPredefinedCity(pre.dataset.cityPre); return; }
          const nw = ev.target.closest('[data-city-new]');
          if (nw) {
            const c = cityResults[Number(nw.dataset.cityNew)];
            if (c) pickCustomCity(c.name, c.nameEn, c.lat, c.lng);
            return;
          }
        });

        const q = $('#dmCityQ');
        if (q) q.addEventListener('input', function () {
          clearTimeout(timer);
          const v = q.value.trim();
          const box = $('#dmCityRes');
          if (v.length < 2) { box.innerHTML = ''; return; }
          box.innerHTML = '<div class="egroup-empty">搜索中…</div>';
          const mine = ++seq;
          timer = setTimeout(function () {
            geocodeCity(v).then(function (list) {
              if (mine !== seq) return;
              cityResults = list || [];
              renderCityResults(cityResults);
            }).catch(function (err) {
              if (mine === seq) box.innerHTML = '<div class="egroup-empty">搜索失败：' +
                esc((err && err.message) || '网络错误') + '，请重试</div>';
            });
          }, 380);
        });

        const save = $('#dmSave');
        if (save) save.addEventListener('click', function () {
          STORE.setDayMeta(day.id, {
            title: ($('#dmTitle').value.trim() || null),
            titleEn: ($('#dmTitleEn').value.trim() || null),
            summary: ($('#dmSummary').value.trim() || null),
          });
          closeSheet();
          refreshAfterCityChange();
          toast('已保存这一天的文字');
        });

        const del = $('#dmDel');
        if (del) del.addEventListener('click', function () {
          if (!delArmed) {
            delArmed = true;
            del.innerHTML = icon('trash') + '再点一次确认' +
              (STORE.isExtraDay(day.id) ? '删除' : '移除');
            return;
          }
          const wasExtra = STORE.isExtraDay(day.id);
          STORE.removeDay(day.id);
          closeSheet();
          state.sel = clamp(state.sel, 0, DAYS.length - 1);
          state.mapFilter = String(state.sel);
          refreshAfterCityChange();
          toast(wasExtra ? '已删除这一天' : '已从行程中移除，可在「更多」里恢复');
        });
      }, 'editor');
  }

  function pickPredefinedCity(place) {
    if (typeof WEATHER_PLACES === 'undefined') return;
    const day = DAYS[state.sel];
    const region = WP_REGION[place] || 'transit';
    STORE.setDayMeta(day.id, { region: region, weatherPlace: place });
    closeSheet();
    refreshAfterCityChange();
    toast('已切换到「' + (REGIONS[region] || REGIONS.transit).label + '」，天气与城市名已联动更新');
  }

  function pickCustomCity(name, nameEn, lat, lng) {
    const day = DAYS[state.sel];
    const key = cityKeyFor(lat, lng);
    if (typeof WEATHER_PLACES === 'undefined' || !WEATHER_PLACES[key]) {
      const pal = cityPaletteFor(key);
      STORE.setCustomCity(key, {
        label: name, labelEn: nameEn || name, lat: lat, lng: lng,
        color: pal.color, soft: pal.soft,
      });
    }
    STORE.setDayMeta(day.id, { region: key, weatherPlace: key });
    closeSheet();
    refreshAfterCityChange();
    // a brand-new query point needs a fresh fetch to have any weather
    if (typeof WEATHER !== 'undefined') {
      WEATHER.refresh(true).then(function () { renderHero(); repaintWeatherSheet(); });
    }
    toast('已把这一天设为「' + name + '」');
  }

  /** re-render everything that shows a day's city or text */
  function refreshAfterCityChange() {
    mapSuggest = null;
    renderHero();
    renderChips();
    if (state.mapReady && state.view === 'map') { renderMapLegend(); renderMapContent(); }
    else if (state.view === 'today') renderToday();
    else if (state.view === 'itin') renderItin();
  }

  /* ---- lodging for a day ("设置住宿") --------------------------------- */
  function hotelSectionHtml(day) {
    const h = hotelById(day.hotelId);
    const color = ((h && REGIONS[h.region]) || regionOf(day)).color;
    return '<div class="cs-cur" style="--c:' + color + '">' +
        '<span class="cs-dot" style="background:' + color + '"></span>' +
        '<span class="cs-tx"><b>' + (h ? esc(h.name) : '未设置住宿') + '</b>' +
          '<span>' + (h ? esc(h.address || h.city || '') :
            '为这一天添加酒店，可导航 / 复制地址 / 地图查看') + '</span></span>' +
      '</div>' +
      '<button class="btn block ghost" data-hotel-edit="' + esc(day.id) + '" style="margin-top:10px">' +
        icon(h ? 'edit' : 'plus') + (h ? '更换 / 编辑住宿' : '设置住宿') + '</button>';
  }

  /** re-render after a day's lodging changed */
  function afterHotelChange() {
    closeSheet();
    refreshAfterEdit();
    renderHero();
    if (state.mapReady) renderMapContent();
  }

  /** set / change / clear the lodging for one day (existing hotel or a new one) */
  function openHotelEditor(dayId) {
    const day = DAYS.filter(function (d) { return d.id === dayId; })[0] || DAYS[state.sel];
    const cur = hotelById(day.hotelId);
    const existing = HOTELS.concat(Object.keys(STORE.customHotels()).map(function (k) {
      return STORE.customHotels()[k];
    }));
    let results = [], timer = null, seq = 0;

    openSheet('设置住宿', day.dow + ' · ' + day.title,
      (cur
        ? '<div class="cs-cur" style="--c:' + ((REGIONS[cur.region] || REGIONS.transit).color) + '">' +
            '<span class="cs-dot" style="background:' + ((REGIONS[cur.region] || REGIONS.transit).color) + '"></span>' +
            '<span class="cs-tx"><b>' + esc(cur.name) + '</b><span>' + esc(cur.address || cur.city || '') + '</span></span>' +
          '</div>' +
          '<button class="btn block ghost dm-del" id="htClear" style="margin-top:10px">' +
            icon('trash') + '清除这一天的住宿</button>' +
          '<div class="sheet-sep"></div>'
        : '') +
      '<div class="dm-h">' + icon('bed') + '新酒店</div>' +
      '<div class="field"><label>搜索酒店 / 地点（可选）</label>' +
        '<input id="htQ" type="search" placeholder="例如 Hotel Interlaken / Interlaken" ' +
          'autocomplete="off" autocapitalize="off"></div>' +
      '<div id="htRes" class="cs-res"></div>' +
      '<div class="field"><label>酒店名称</label>' +
        '<input id="htName" type="text" placeholder="酒店名称"></div>' +
      '<div class="field"><label>地址（可选）</label>' +
        '<input id="htAddr" type="text" placeholder="街道、城市"></div>' +
      '<div class="pa-row2">' +
        '<div class="field" style="margin:0"><input id="htLat" type="number" step="any" ' +
          'placeholder="纬度 lat" inputmode="decimal"></div>' +
        '<div class="field" style="margin:0"><input id="htLng" type="number" step="any" ' +
          'placeholder="经度 lng" inputmode="decimal"></div>' +
      '</div>' +
      '<div class="pa-hint">有坐标才能「导航」与「在地图查看」；没有坐标也能先存名称和地址。</div>' +
      '<button class="btn block primary" id="htSave" style="margin-top:6px">' +
        icon('check') + '保存住宿</button>' +
      (existing.length
        ? '<div class="sheet-sep"></div><div class="dm-h">' + icon('pin') + '或直接使用已有酒店</div>' +
          '<div class="cs-list">' + existing.map(function (h) {
            const rg = REGIONS[h.region] || REGIONS.transit;
            return '<button class="cs-row" data-ht-use="' + esc(h.id) + '" style="--c:' + rg.color + '">' +
              '<span class="cs-dot" style="background:' + rg.color + '"></span>' +
              '<span class="cs-tx"><b>' + esc(h.name) + '</b><span>' +
                esc(h.city || '') + (h.address ? ' · ' + esc(h.address) : '') + '</span></span>' +
              '<span class="cs-go">' + icon('check') + '</span></button>';
          }).join('') + '</div>'
        : ''),
      function () {
        const inner = $('.sheet-inner');
        inner.addEventListener('click', function (ev) {
          const use = ev.target.closest('[data-ht-use]');
          if (use) { STORE.setDayMeta(day.id, { hotelId: use.dataset.htUse }); afterHotelChange(); return; }
          const r = ev.target.closest('[data-ht-pick]');
          if (r) {
            const c = results[Number(r.dataset.htPick)];
            if (!c) return;
            $('#htName').value = c.name;
            $('#htAddr').value = c.note || '';
            $('#htLat').value = c.lat;
            $('#htLng').value = c.lng;
            $('#htRes').innerHTML = '';
            toast('已填入，可修改后保存');
            return;
          }
        });

        const clr = $('#htClear');
        if (clr) clr.addEventListener('click', function () {
          STORE.setDayMeta(day.id, { hotelId: null });
          afterHotelChange();
          toast('已清除住宿');
        });

        const q = $('#htQ');
        if (q) q.addEventListener('input', function () {
          clearTimeout(timer);
          const v = q.value.trim();
          if (v.length < 2) { $('#htRes').innerHTML = ''; return; }
          $('#htRes').innerHTML = '<div class="egroup-empty">搜索中…</div>';
          const mine = ++seq;
          timer = setTimeout(function () {
            geocodeCity(v).then(function (list) {
              if (mine !== seq) return;
              results = list || [];
              $('#htRes').innerHTML = results.length ? results.map(function (c, i) {
                return '<button class="cs-row" data-ht-pick="' + i + '">' +
                  '<span class="cs-dot" style="background:var(--faint)"></span>' +
                  '<span class="cs-tx"><b>' + esc(c.name) + '</b><span>' +
                    esc(c.note || '') + ' · ' + c.lat.toFixed(3) + ', ' + c.lng.toFixed(3) +
                  '</span></span>' +
                  '<span class="cs-go">' + icon('plus') + '</span></button>';
              }).join('') : '<div class="egroup-empty">没找到，直接在下面手动填写</div>';
            }).catch(function (err) {
              if (mine === seq) $('#htRes').innerHTML = '<div class="egroup-empty">搜索失败：' +
                esc((err && err.message) || '网络错误') + '</div>';
            });
          }, 380);
        });

        $('#htSave').addEventListener('click', function () {
          const name = $('#htName').value.trim();
          if (!name) { toast('请填写酒店名称'); return; }
          const addr = $('#htAddr').value.trim();
          const lat = parseFloat($('#htLat').value);
          const lng = parseFloat($('#htLng').value);
          const id = 'ch' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
          STORE.setCustomHotel(id, {
            name: name, city: addr || name, address: addr,
            lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng,
            region: day.region,
          });
          STORE.setDayMeta(day.id, { hotelId: id });
          afterHotelChange();
          toast('已保存住宿「' + name + '」');
        });
      }, 'editor');
  }

  /* ---- add a day ------------------------------------------------------ */
  const WD_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const MON_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function dowEnFor(iso) {
    const d = new Date(iso + 'T12:00:00Z');
    return WD_EN[(d.getUTCDay() + 7) % 7] + ' ' + pad2(Number(iso.slice(8, 10))) +
      ' ' + MON_EN[Number(iso.slice(5, 7)) - 1];
  }
  function nextDayIso(iso) {
    const t = Date.parse(iso + 'T00:00:00Z') + 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }

  function openAddDay() {
    const last = DAYS[DAYS.length - 1];
    const nextDate = nextDayIso(last ? last.date : zurichToday());
    openSheet('添加一天', '手动增加一天的行程',
      '<div class="cs-note">新的一天会按日期插入到行程里，之后可在「编辑行程」中加地点与交通。</div>' +
      '<div class="field"><label>日期</label>' +
        '<input id="adDate" type="date" value="' + esc(nextDate) + '"></div>' +
      '<div class="field"><label>标题</label>' +
        '<input id="adTitle" type="text" placeholder="例如 卢塞恩一日游"></div>' +
      '<div class="field"><label>英文标题（可选）</label>' +
        '<input id="adTitleEn" type="text" placeholder="Lucerne day trip"></div>' +
      '<div class="field"><label>概述（可选）</label>' +
        '<textarea id="adSummary" rows="3" placeholder="这一天打算做什么…"></textarea></div>' +
      '<div class="field"><label>城市（可选，可搜索）</label>' +
        '<input id="adCityQ" type="search" placeholder="例如 卢塞恩 / Lucerne" ' +
          'autocomplete="off" autocapitalize="off"></div>' +
      '<div id="adCityRes" class="cs-res"></div>' +
      '<div id="adCityPick" class="cs-picked" style="display:none"></div>' +
      '<button class="btn block primary" id="adSave" style="margin-top:6px">' +
        icon('check') + '添加这一天</button>',
      function () {
        let results = [], timer = null, seq = 0, picked = null;
        const inner = $('.sheet-inner');
        inner.addEventListener('click', function (ev) {
          const nw = ev.target.closest('[data-ad-city]');
          if (!nw) return;
          const c = results[Number(nw.dataset.adCity)];
          if (!c) return;
          picked = c;
          $('#adCityPick').style.display = 'block';
          $('#adCityPick').innerHTML = '<span class="cs-dot" style="background:var(--ink)"></span>' +
            '<span class="cs-tx"><b>' + esc(c.name) + '</b><span>' + esc(c.note || '') +
            ' · ' + c.lat.toFixed(3) + ', ' + c.lng.toFixed(3) + '</span></span>';
          $('#adCityRes').innerHTML = '';
          if ($('#adCityQ')) $('#adCityQ').value = c.name;
        });

        const q = $('#adCityQ');
        if (q) q.addEventListener('input', function () {
          clearTimeout(timer);
          picked = null;
          const v = q.value.trim();
          if (v.length < 2) { $('#adCityRes').innerHTML = ''; return; }
          $('#adCityRes').innerHTML = '<div class="egroup-empty">搜索中…</div>';
          const mine = ++seq;
          timer = setTimeout(function () {
            geocodeCity(v).then(function (list) {
              if (mine !== seq) return;
              results = list || [];
              $('#adCityRes').innerHTML = results.length ? results.map(function (c, i) {
                return '<button class="cs-row" data-ad-city="' + i + '">' +
                  '<span class="cs-dot" style="background:var(--faint)"></span>' +
                  '<span class="cs-tx"><b>' + esc(c.name) + '</b><span>' +
                    esc(c.note || '') + '</span></span>' +
                  '<span class="cs-go">' + icon('plus') + '</span></button>';
              }).join('') : '<div class="egroup-empty">没找到</div>';
            }).catch(function (err) {
              if (mine === seq) $('#adCityRes').innerHTML = '<div class="egroup-empty">搜索失败：' +
                esc((err && err.message) || '网络错误') + '</div>';
            });
          }, 380);
        });

        $('#adSave').addEventListener('click', function () {
          const date = $('#adDate').value;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('请选择日期'); return; }
          const title = $('#adTitle').value.trim();
          if (!title) { toast('请填写标题'); return; }
          let region = last ? last.region : 'transit';
          let weatherPlace = last ? last.weatherPlace : 'gva';
          if (picked) {
            const key = cityKeyFor(picked.lat, picked.lng);
            const pal = cityPaletteFor(key);
            STORE.setCustomCity(key, {
              label: picked.name, labelEn: picked.nameEn || picked.name,
              lat: picked.lat, lng: picked.lng, color: pal.color, soft: pal.soft,
            });
            region = key; weatherPlace = key;
          }
          const di = dateInfo(date);
          const d = STORE.addDay({
            date: date, dow: di.wd, dowEn: dowEnFor(date),
            title: title, titleEn: $('#adTitleEn').value.trim(),
            summary: $('#adSummary').value.trim(),
            region: region, weatherPlace: weatherPlace,
          });
          closeSheet();
          const idx = DAYS.map(function (x) { return x.id; }).indexOf(d.id);
          if (idx >= 0) { state.sel = idx; state.mapFilter = String(idx); }
          refreshAfterCityChange();
          if (picked && typeof WEATHER !== 'undefined') WEATHER.refresh(true);
          toast('已添加 ' + di.md + '「' + title + '」');
        });
      }, 'editor');
  }

  function navSheet(lat, lng, name, sub, search, dayId) {
    const u = navUrl(lat, lng, name);
    const own = dayId ? STORE.placeTime(dayId, name) : null;
    openSheet(name, sub || '', 
      '<div class="btn-row" style="display:grid;gap:9px">' +
        '<a class="btn block primary" href="' + u.google + '" target="_blank" rel="noopener">' + icon('nav') + 'Google 地图导航</a>' +
        '<a class="btn block" href="' + u.apple + '" target="_blank" rel="noopener">' + icon('nav') + 'Apple 地图导航</a>' +
        '<button class="btn block ghost" data-xhs="' + esc(search || name) + '">' +
          icon('globe') + '在小红书搜「' + esc(search || name) + '」</button>' +
        (dayId
          ? '<button class="btn block ghost" data-place-time="' + esc(dayId) + '|' + esc(name) + '">' +
            icon('clock') + (own
              ? '时间要求：' + fmtClock(own[0]) + '–' + fmtClock(own[1])
              : '设置时间要求（给路线优化器）') + '</button>'
          : '') +
        '<a class="btn block ghost" href="' + u.geo + '">' + icon('pin') + '用手机默认地图打开</a>' +
        '<button class="btn block ghost" data-copy="' + lat + ',' + lng + '">复制坐标 ' + lat + ', ' + lng + '</button>' +
        '<button class="btn block ghost" data-map-here="' + lat + ',' + lng + '">在工作台地图中定位</button>' +
      '</div>');
  }

  /**
   * Set the traveller's own time requirement for one place. This is the piece
   * no dataset can supply — "the cable car's last ride is 17:00", "the museum
   * shuts on Mondays" — so it is stated by hand and honoured by the optimiser.
   */
  function openPlaceTimeSheet(dayId, name) {
    const own = STORE.placeTime(dayId, name);
    const val = function (min, dflt) { return min == null ? dflt : fmtClock(min * 60); };
    openSheet('时间要求 · ' + name, '路线优化时会优先满足',
      '<div style="font-size:13px;line-height:1.7;color:var(--ink-2);margin-bottom:12px">' +
        '填「从–到」表示这段时间内要到达（例如缆车末班 17:00，就填 到 17:00）。' +
        '留空表示不限。' +
      '</div>' +
      '<div class="tp-when">' +
        '<div class="field" style="flex:1"><label>从</label>' +
          '<input id="ptFrom" type="time" value="' + esc(val(own && own[0], '08:00')) + '"></div>' +
        '<div class="field" style="flex:1"><label>到</label>' +
          '<input id="ptTo" type="time" value="' + esc(val(own && own[1], '18:00')) + '"></div>' +
      '</div>' +
      '<button class="btn block primary" id="ptSave" style="margin-top:14px;height:46px">保存</button>' +
      '<button class="btn block ghost" id="ptClear" style="margin-top:8px">不限（清除）</button>',
      function () {
        const toMin = function (v) {
          const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ''));
          return m ? Number(m[1]) * 60 + Number(m[2]) : null;
        };
        $('#ptSave').addEventListener('click', function () {
          const a = toMin($('#ptFrom').value);
          const b2 = toMin($('#ptTo').value);
          if (a == null || b2 == null || b2 <= a) { toast('请填有效的起止时间'); return; }
          STORE.setPlaceTime(dayId, name, [a, b2]);
          mapSuggest = null;                       // recompute on next use
          closeSheet();
          renderMapContent();
          toast('已设时间要求 ' + fmtClock(a) + '–' + fmtClock(b2));
        });
        $('#ptClear').addEventListener('click', function () {
          STORE.setPlaceTime(dayId, name, null);
          mapSuggest = null;
          closeSheet();
          renderMapContent();
          toast('已清除时间要求');
        });
      }, 'editor');
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
    if (v === 'translate') renderTranslate();
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
    // leaving a day ends any reorder session, otherwise state.sorting keeps the
    // old dayId and the long-press guard would block reordering from now on
    state.sorting = null;
    store.set(K.sel, state.sel);
    state.mapFilter = String(state.sel);
    if (goToday !== false && state.view !== 'today') setView('today');
    else { renderHero(); renderChips(); if (state.view === 'today') renderToday(); }
  }

  /* ======================== GitHub sync =============================== */

  const GH_KEY = 'swiss.gh.v1';
  const GH_LAST = 'swiss.gh.last';

  function ghConfig() {
    try { return JSON.parse(localStorage.getItem(GH_KEY) || 'null') || {}; }
    catch (e) { return {}; }
  }

  function setGhConfig(c) {
    try {
      if (c) localStorage.setItem(GH_KEY, JSON.stringify(c));
      else localStorage.removeItem(GH_KEY);
    } catch (e) {}
  }

  function ghReady() {
    const c = ghConfig();
    return !!(c.repo && c.token);
  }

  function ghContentsUrl(c) {
    const path = String(c.path || 'sync/swiss-trip.json').split('/').map(encodeURIComponent).join('/');
    return 'https://api.github.com/repos/' + c.repo + '/contents/' + path;
  }

  function ghHeadersFor(c) {
    return {
      Authorization: 'Bearer ' + ((c && c.token) || ''),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  function ghHeaders() {
    return ghHeadersFor(ghConfig());
  }

  /**
   * Check a token before relying on it: who it belongs to, how broad it is, and
   * whether it can actually write to the chosen repo. Saves the user from a
   * confusing 403 later — and tells them when a token is far more powerful than
   * this app needs (a token made for `git push` usually is).
   */
  async function ghTest(cfg) {
    if (!cfg || !cfg.token) throw new Error('请先填 Token');
    const res = await fetch('https://api.github.com/user', { headers: ghHeadersFor(cfg) });
    if (!res.ok) throw new Error(await ghError(res));
    const me = await res.json();
    const scopes = res.headers.get('X-OAuth-Scopes') || '';

    const out = { login: me.login, scopes: scopes, repo: null, repoErr: '' };
    if (cfg.repo) {
      const r2 = await fetch('https://api.github.com/repos/' + cfg.repo, { headers: ghHeadersFor(cfg) });
      if (r2.ok) {
        const j = await r2.json();
        out.repo = {
          full: j.full_name,
          isPrivate: !!j.private,
          canPush: !!(j.permissions && j.permissions.push),
        };
      } else {
        out.repoErr = await ghError(r2);
      }
    }
    return out;
  }

  function ghTestReport(r, cfg) {
    const warn = function (s) { return '<b style="color:#c0392b">' + s + '</b>'; };
    const lines = ['✓ Token 有效，属于 <b>' + esc(r.login) + '</b>'];
    if (r.scopes) {
      const broad = /(^|,\s*)(repo|admin:org|delete_repo|workflow)(,|$)/.test(r.scopes);
      lines.push('类型：classic token · 权限 <b>' + esc(r.scopes) + '</b>' +
        (broad ? ' —— ' + warn('范围偏大（能读写你名下所有仓库）') +
          '，建议换成只给这一个仓库 Contents 权限的 fine-grained token' : ''));
    } else {
      lines.push('类型：fine-grained token（细粒度权限读不出来，用下面的仓库检查判断）');
    }
    if (r.repoErr) {
      lines.push(warn('✗ 仓库 ' + esc(cfg.repo) + '：' + esc(r.repoErr)));
    } else if (r.repo) {
      lines.push('✓ 仓库 <b>' + esc(r.repo.full) + '</b>（' +
        (r.repo.isPrivate ? '私有' : warn('公开')) + '）');
      lines.push(r.repo.canPush ? '✓ 有写入权限，可以上传' : warn('✗ 没有写入权限，上传会失败'));
      if (!r.repo.isPrivate) lines.push(warn('注意：公开仓库会让行程与账目对所有人可见'));
    }
    return lines.join('<br>');
  }

  async function ghError(res) {
    let msg = String(res.status);
    try {
      const j = await res.json();
      if (j && j.message) msg = res.status + ' ' + j.message;
    } catch (e) {}
    if (res.status === 401) msg += '（Token 无效或已过期）';
    else if (res.status === 403) msg += '（权限不足，或触发了限流）';
    else if (res.status === 404) msg += '（仓库 / 分支 / 路径不存在，或 Token 无权访问）';
    return msg;
  }

  /** one file from any repo we can reach, or null when it does not exist yet */
  async function ghReadAt(repo, branch, path) {
    const url = 'https://api.github.com/repos/' + repo + '/contents/' +
      String(path).split('/').map(encodeURIComponent).join('/') +
      '?ref=' + encodeURIComponent(branch || 'main');
    const res = await fetch(url, { headers: ghHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await ghError(res));
    return res.json();
  }

  async function ghWriteAt(repo, branch, path, text, message) {
    const existing = await ghReadAt(repo, branch, path);
    const body = {
      message: message,
      content: b64encode(text),
      branch: branch || 'main',
    };
    if (existing && existing.sha) body.sha = existing.sha;
    const res = await fetch('https://api.github.com/repos/' + repo + '/contents/' +
      String(path).split('/').map(encodeURIComponent).join('/'), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders()),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await ghError(res));
    return res.json();
  }

  /** the remote file, or null when it does not exist yet */
  function ghRead() {
    const c = ghConfig();
    return ghReadAt(c.repo, c.branch, c.path);
  }

  function ghWrite(text, message) {
    const c = ghConfig();
    return ghWriteAt(c.repo, c.branch, c.path, text, message);
  }

  /** overwrite the local store from a sync/share payload */
  function applyPayload(payload) {
    if (!payload || !payload.user) throw new Error('文件格式不对');
    const cur = STORE.raw();
    ['places', 'legs', 'legEdits', 'blocks', 'hidden', 'photoSpots', 'hiddenPhotos',
      'order', 'sortMode', 'placeTimes', 'presets', 'budget', 'rates', 'photoVisible',
      'dayMeta', 'customCities', 'customHotels', 'extraDays', 'removedDays'].forEach(function (k) {
      if (payload.user[k] !== undefined) cur[k] = payload.user[k];
    });
    // save() → apply() re-attaches extra days and re-registers custom cities
    STORE.save();
    if (Array.isArray(payload.expenses)) saveExpenses(payload.expenses);
  }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /**
   * What we push. Deliberately narrow:
   *   - NO images: ticket photos live in IndexedDB and are never read here
   *   - NO personal data: the traveller's own edits carry none, and the
   *     identity fields in data.js (card holder, contacts, passport notes) are
   *     code, not user data, so they can never end up in this payload
   *   - geoCache is dropped: a derived reverse-geocode cache, bulky and
   *     regenerated on demand
   */
  function ghPayload() {
    const user = Object.assign({}, STORE.raw());
    delete user.geoCache;
    return {
      app: 'swiss-trip-workbench',
      kind: 'sync',
      version: 1,
      syncedAt: new Date().toISOString(),
      user: user,
      expenses: expenses(),
    };
  }

  async function ghSyncPush() {
    if (!ghReady()) throw new Error('请先设置仓库与 Token');
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const info = await ghWrite(JSON.stringify(ghPayload(), null, 2), 'sync: swiss-trip 数据 · ' + stamp);
    store.set(GH_LAST, Date.now());
    // Also refresh the public copy friends read, so one tap keeps both current —
    // otherwise it is far too easy to upload your backup and leave friends on an
    // old version. Non-fatal: a token scoped only to the data repo must not make
    // the backup itself look like a failure.
    let shared = false;
    if (appRepo()) {
      try { await ghSharePush(); shared = true; } catch (e) { shared = false; }
    }
    return { path: (info.content && info.content.path) || ghConfig().path, shared: shared };
  }

  /** read + decode the remote sync file (throws with a readable message) */
  async function ghFetchPayload() {
    if (!ghReady()) throw new Error('请先设置仓库与 Token');
    const file = await ghRead();
    if (!file) throw new Error('远端还没有这个文件，先「上传到 GitHub」一次');
    const payload = JSON.parse(b64decode(file.content));
    if (!payload || payload.kind !== 'sync' || !payload.user) throw new Error('文件不是本应用的同步数据');
    return payload;
  }

  /** overwrite local data with an already-fetched payload — DESTRUCTIVE */
  function ghApplyPull(payload) {
    applyPayload(payload);
    store.set(GH_LAST, Date.now());
    return { syncedAt: payload.syncedAt };
  }

  async function ghSyncPull() {
    return ghApplyPull(await ghFetchPayload());
  }

  /* ---- sharing: publish a public copy friends can open without a token ---- */

  const SHARE_PATH = 'share.json';
  const SHARE_SNAP = 'swiss.preshare.v1';

  /** owner/name of the repo that serves this page (from the Pages URL) */
  function appRepo() {
    const host = location.hostname || '';
    if (!/\.github\.io$/i.test(host)) return '';
    const owner = host.split('.')[0];
    const seg = String(location.pathname || '/').split('/').filter(Boolean)[0] || '';
    return seg ? owner + '/' + seg : owner + '/' + owner + '.github.io';
  }

  function shareLink() {
    return location.origin + location.pathname.replace(/[^/]*$/, '') + '#share';
  }

  /**
   * Publish the itinerary for friends. It goes into THIS site's own repo, so
   * friends fetch it same-origin — no token, no CORS, and the link is just
   * "<site>/#share". GitHub Pages serves static files with
   * `Access-Control-Allow-Origin: *`, so this works from any device.
   */
  async function ghSharePush() {
    if (!ghReady()) throw new Error('请先设置仓库与 Token');
    const repo = appRepo();
    if (!repo) throw new Error('分享只在 GitHub Pages 上可用（当前域名 ' + location.hostname + '）');
    const payload = ghPayload();
    const stamp = payload.syncedAt.slice(0, 16).replace('T', ' ');
    await ghWriteAt(repo, ghConfig().branch, SHARE_PATH,
      JSON.stringify(payload, null, 2), 'share: 行程更新 · ' + stamp);
    store.set(GH_LAST, Date.now());
    return { repo: repo, link: shareLink(), syncedAt: payload.syncedAt };
  }

  /** friend side: pull the public share file and show it */
  async function loadShare() {
    const res = await fetch(SHARE_PATH + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('找不到分享文件（HTTP ' + res.status + '）');
    const payload = await res.json();
    if (!payload || !payload.user) throw new Error('分享文件格式不对');
    // Snapshot the viewer's own data ONCE so 「退出」 can put it back. Only when
    // no snapshot exists: on a refresh the store already holds the shared data,
    // so snapshotting again would destroy the viewer's real data.
    try {
      if (!localStorage.getItem(SHARE_SNAP)) {
        localStorage.setItem(SHARE_SNAP,
          JSON.stringify({ user: STORE.raw(), expenses: expenses() }));
      }
    } catch (e) {}
    applyPayload(payload);
    return payload;
  }

  /** re-fetch and re-apply the share — used by the banner 「刷新」 */
  function refreshShare() {
    loadShare().then(function (p) {
      showShareBar(p);
      refreshAfterEdit();
      toast('已更新到最新分享' + (p.syncedAt ? '（' + p.syncedAt.slice(0, 16).replace('T', ' ') + '）' : ''));
    }).catch(function (e) {
      toast('刷新失败：' + ((e && e.message) || e));
    });
  }

  function showShareBar(payload) {
    let el = $('#shareBar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'shareBar';
      el.className = 'share-bar';
      // sit in the flow right after the sticky header so it scrolls with the
      // page but stays pinned under the header
      const hdr = $('#hdr');
      if (hdr && hdr.parentNode) hdr.parentNode.insertBefore(el, hdr.nextSibling);
      else document.body.insertBefore(el, document.body.firstChild);
    }
    const when = payload.syncedAt ? payload.syncedAt.slice(0, 16).replace('T', ' ') : '';
    el.innerHTML = '<span>' + icon('link') + '朋友分享的行程' +
      (when ? ' · ' + esc(when) : '') + '</span>' +
      '<button class="btn sm ghost" data-share-refresh="1">刷新</button>' +
      '<button class="btn sm ghost" data-share-exit="1">退出</button>';
    el.hidden = false;
  }

  function maybeLoadShare(wanted) {
    if (!wanted) return;
    loadShare().then(function (p) {
      showShareBar(p);
      refreshAfterEdit();
      setView('today');
      toast('已载入朋友分享的行程');
    }).catch(function (e) {
      toast('载入分享失败：' + ((e && e.message) || e));
    });
  }

  function openGhSetup() {
    const c = ghConfig();
    openSheet('同步至 GitHub', '仓库与 Token 只保存在本机',
      '<div class="field"><label>仓库（owner/name）</label>' +
        '<input id="ghRepo" type="text" autocomplete="off" placeholder="例如 robinmarie628/swiss-trip-2026" value="' + esc(c.repo || '') + '"></div>' +
      '<div class="field"><label>分支</label>' +
        '<input id="ghBranch" type="text" autocomplete="off" placeholder="main" value="' + esc(c.branch || 'main') + '"></div>' +
      '<div class="field"><label>文件路径</label>' +
        '<input id="ghPath" type="text" autocomplete="off" placeholder="sync/swiss-trip.json" value="' + esc(c.path || 'sync/swiss-trip.json') + '"></div>' +
      '<div class="field"><label>Personal Access Token</label>' +
        '<input id="ghToken" type="password" autocomplete="off" placeholder="github_pat_… 或 ghp_…" value="' + esc(c.token || '') + '"></div>' +
      '<div class="hint" style="margin-top:12px;line-height:1.75">' +
        '<b>怎么拿 Token</b><br>' +
        '1. 打开 github.com → 右上角头像 → <b>Settings</b><br>' +
        '2. 左侧最下 <b>Developer settings</b> → Personal access tokens → <b>Fine-grained tokens</b><br>' +
        '3. <b>Generate new token</b>；Repository access 选 <b>Only select repositories</b>，勾上你的仓库<br>' +
        '4. Permissions → Repository permissions → <b>Contents</b> 改成 <b>Read and write</b><br>' +
        '5. Generate token，复制 <b>github_pat_…</b> 填到上面<br>' +
        '<b>仓库</b>填 owner/name（如 robinmarie628/swiss-trip-2026）；分支一般 main；' +
        '路径随便，默认 sync/swiss-trip.json，不存在会自动创建。<br>' +
        '<b>之前推送代码用的 Token 能用吗？</b>能用（只要有 Contents 写权限就行），' +
        '但那种多半是 classic token、能读写你名下<b>所有</b>仓库，放进网页风险更大；' +
        '建议新开一个只授权单仓库的 fine-grained token。拿不准就点下面的「测试连接」。<br>' +
        '仓库建议设为<b>私有</b> —— 公开仓库会让行程与账目对所有人可见。' +
        'Token 只保存在这台手机里，不会上传到任何地方。</div>' +
      '<button class="btn block primary" id="ghSave" style="margin-top:14px;height:46px">保存</button>' +
      '<button class="btn block ghost" id="ghTest" style="margin-top:8px">测试连接（先保存，或直接测上面填的）</button>' +
      '<div class="hint" id="ghTestOut" style="display:none;margin-top:10px;line-height:1.7"></div>' +
      '<button class="btn block ghost" id="ghClear" style="margin-top:8px">清除配置</button>',
      function () {
        const readForm = function () {
          return {
            repo: $('#ghRepo').value.trim(),
            branch: $('#ghBranch').value.trim() || 'main',
            path: $('#ghPath').value.trim() || 'sync/swiss-trip.json',
            token: $('#ghToken').value.trim(),
          };
        };
        $('#ghTest').addEventListener('click', function () {
          const btn = this;
          const out = $('#ghTestOut');
          btn.disabled = true;
          btn.textContent = '测试中…';
          out.style.display = 'block';
          out.innerHTML = '正在检查…';
          ghTest(readForm()).then(function (r) {
            btn.disabled = false;
            btn.textContent = '测试连接';
            out.innerHTML = ghTestReport(r, readForm());
          }, function (e) {
            btn.disabled = false;
            btn.textContent = '测试连接';
            out.innerHTML = '<b style="color:#c0392b">✗ ' + esc((e && e.message) || String(e)) + '</b>';
          });
        });
        $('#ghSave').addEventListener('click', function () {
          const repo = $('#ghRepo').value.trim();
          const token = $('#ghToken').value.trim();
          setGhConfig({
            repo: repo,
            branch: $('#ghBranch').value.trim() || 'main',
            path: $('#ghPath').value.trim() || 'sync/swiss-trip.json',
            token: token,
          });
          closeSheet();
          renderMore();
          toast(repo && token ? '已保存 GitHub 配置' : '已保存（仓库或 Token 还空着）');
        });
        $('#ghClear').addEventListener('click', function () {
          setGhConfig(null);
          closeSheet();
          renderMore();
          toast('已清除 GitHub 配置');
        });
      }, 'editor');
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
      // keep the app's "current day" in step with the map filter, so anything
      // added from here (a photo spot, lodging…) defaults to the day you clicked
      if (/^\d+$/.test(state.mapFilter)) {
        state.sel = clamp(Number(state.mapFilter), 0, DAYS.length - 1);
        store.set(K.sel, state.sel);
        renderChips();
        renderHero();
      }
      renderMapLegend();
      renderMapContent();
    });

    // FAB
    $('#fab').addEventListener('click', function () { expenseSheet(); });

    // sheet close
    $('#sheetX').addEventListener('click', closeSheet);
    $('#sheetBg').addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheetOpen) closeSheet(); });

    bindLinkGesture();

    // A friend re-tapping the share link only changes the hash, which does NOT
    // reload the page — so without this they'd keep seeing the copy they loaded
    // the first time. Re-run the share load whenever #share comes back.
    window.addEventListener('hashchange', function () {
      if (/^#share\b/i.test(location.hash || '')) maybeLoadShare(true);
    });

    // delegated clicks
    document.addEventListener('click', function (e) {
      const t = e.target;

      // an armed A→B link swallows the tap that completes it
      if (linkSwallowClick) { linkSwallowClick = false; return; }
      if (linkFrom && linkTap(t)) return;

      // While a list is being reordered, a tap inside it must not fire the row's
      // normal action. The click that the browser fires when the finger lifts can
      // land on a re-rendered row, which would otherwise pop a sheet over the
      // sort UI. Only the sort controls stay live.
      if (state.sorting && t.closest('#tlList, #placeList, #legList') &&
          !t.closest('[data-move-kind], [data-sort-done], [data-sort-auto]')) {
        return;
      }

      const ptBtn = t.closest('[data-place-time]');
      if (ptBtn) {
        const parts = String(ptBtn.dataset.placeTime).split('|');
        openPlaceTimeSheet(parts[0], parts.slice(1).join('|'));
        return;
      }

      // 小红书：hand the query to the app (its mobile web search 404s)
      const xhsBtn = t.closest('[data-xhs]');
      if (xhsBtn) {
        const q = xhsBtn.dataset.xhs;
        openAppScheme(xhsScheme(q), xhsUrl(q), '小红书');
        return;
      }

      const dayBtn = t.closest('[data-day]');
      if (dayBtn && !t.closest('#dayChips')) { selectDay(Number(dayBtn.dataset.day)); return; }

      const hotelEdit = t.closest('[data-hotel-edit]');
      if (hotelEdit) { openHotelEditor(hotelEdit.dataset.hotelEdit); return; }

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
        if (p) {
          // a bare "大喷泉" is ambiguous on 小红书 — lead the search with the city
          const city = d.region && d.region !== 'transit' ? (regionOf(d).label || '') : '';
          const q = city && p.name.indexOf(city) < 0 ? city + ' ' + p.name : p.name;
          navSheet(p.lat, p.lng, p.name,
            deEn(p.nameDe, p.nameEn) + (p.note ? ' · ' + p.note : ''), q, d.id);
        }
        return;
      }

      const maplot = t.closest('[data-maplot]');
      if (maplot) {
        const ll = maplot.dataset.maplot.split(',').map(Number);
        pulseMapMarker(ll[0], ll[1], 15);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const mapHere = t.closest('[data-map-here]');
      if (mapHere) {
        const ll = mapHere.dataset.mapHere.split(',').map(Number);
        closeSheet();
        setView('map');
        setTimeout(function () { pulseMapMarker(ll[0], ll[1], 15); }, 260);
        return;
      }

      const mapAct = t.closest('[data-map-action]');
      if (mapAct && map) {
        const a = mapAct.dataset.mapAction;
        if (a === 'fit') renderMapContent();
        if (a === 'route') {
          // the suggested route replaces the itinerary line, so when it is up
          // this button switches back to the real itinerary instead of toggling
          const sugOn = !!(mapSuggest && mapSuggest.filter === state.mapFilter);
          if (sugOn) {
            mapSuggest = null;
            state.mapRoute = true;
            renderMapContent();
            toast('已切回行程路线');
            return;
          }
          state.mapRoute = !state.mapRoute;
          renderMapContent();
          toast(state.mapRoute ? '已显示行程路线' : '已隐藏行程路线');
        }
        if (a === 'suggest') toggleSuggest();
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

      const dme = t.closest('[data-day-meta]');
      if (dme) { openDayMetaEditor(); return; }

      const addDay = t.closest('[data-add-day]');
      if (addDay) { openAddDay(); return; }

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
        const id = preset.dataset.preset;
        const p = STORE.presets().filter(function (x) { return x.id === id; })[0];
        if (!p) return;
        addExpense({ amount: p.amount, cat: p.cat, note: p.label });
        renderWallet();
        toast('已记录 ' + p.label + ' CHF ' + fmtCHF(p.amount));
        return;
      }

      /* ---- expense preset editing ---------------------------------- */
      const pe = t.closest('[data-preset-edit]');
      if (pe) {
        state.presetEdit = pe.dataset.presetEdit === '1';
        renderWallet();
        return;
      }
      const pdel = t.closest('[data-pdel]');
      if (pdel) {
        STORE.removePreset(pdel.dataset.pdel);
        renderWallet();
        toast('已删除');
        return;
      }
      const padd = t.closest('[data-padd]');
      if (padd) {
        const cats = EXPENSE_CATEGORIES.map(function (c) {
          return '<option value="' + c.id + '"' + (c.id === 'food' ? ' selected' : '') + '>' +
            esc(c.label) + '</option>';
        }).join('');
        openSheet('添加常用项', '会出现在记账页的一键添加里',
          '<div class="field"><label>名称</label>' +
            '<input id="npLabel" type="text" placeholder="例如 缆车往返"></div>' +
          '<div class="field"><label>分类</label><select id="npCat">' + cats + '</select></div>' +
          '<div class="field"><label>金额 (CHF)</label>' +
            '<input id="npAmt" type="number" inputmode="decimal" step="0.05" min="0" placeholder="0.00"></div>' +
          '<button class="btn block primary" id="npSave" style="height:46px">' + icon('check') + '添加</button>',
          function () {
            $('#npLabel').focus();
            $('#npSave').addEventListener('click', function () {
              const label = $('#npLabel').value.trim();
              const amt = parseFloat($('#npAmt').value);
              if (!label) { toast('请填写名称'); return; }
              if (!amt || amt <= 0) { toast('请填写金额'); return; }
              STORE.addPreset({ label: label, amount: amt, cat: $('#npCat').value });
              closeSheet();
              renderWallet();
              toast('已添加');
            });
          });
        return;
      }
      const pres = t.closest('[data-preset-reset]');
      if (pres) {
        STORE.resetPresets();
        renderWallet();
        toast('已恢复默认常用项');
        return;
      }

      /* ---- live FX -------------------------------------------------- */
      const fxr = t.closest('[data-fx-refresh]');
      if (fxr) {
        fxr.textContent = '更新中…';
        fxRefresh(true).then(function (r) {
          toast('汇率已更新 · 1 CHF ≈ ¥' + r.cny.toFixed(2));
          renderWallet();
        });
        return;
      }

      /* ---- day editors ---------------------------------------------- */
      const ed = t.closest('[data-edit-day]');
      if (ed) { openDayEditor(state.sel); return; }

      const apd = t.closest('[data-add-place-day]');
      if (apd) { openPlaceSearch(state.sel, null); return; }

      const ald = t.closest('[data-add-leg-day]');
      if (ald) {
        const ps = DAYS[state.sel].places;
        openTransportPicker(state.sel, ps.length ? ps[0] : null,
          ps.length > 1 ? ps[ps.length - 1] : null);
        return;
      }

      /* ---- reordering ------------------------------------------------ */
      const mv = t.closest('[data-move-kind]');
      if (mv && state.sorting) {
        const moved = moveKey(state.sorting.dayId, mv.dataset.moveKind,
          mv.dataset.moveKey, Number(mv.dataset.moveDir));
        if (moved) {
          renderToday();
          toast('顺序已保存');
        } else {
          toast(mv.dataset.moveDir === '-1' ? '已经是最上面了' : '已经是最下面了');
        }
        return;
      }

      const sd = t.closest('[data-sort-done]');
      if (sd) { state.sorting = null; renderToday(); return; }

      const sa = t.closest('[data-sort-auto]');
      if (sa && state.sorting) {
        STORE.setSortMode(state.sorting.dayId, state.sorting.kind, 'auto');
        state.sorting = null;
        renderToday();
        toast('已改回按时间排序');
        return;
      }

      /* ---- photo spots ----------------------------------------------- */
      const pt = t.closest('[data-photo-toggle]');
      if (pt) {
        STORE.setPhotoVisible(!STORE.photosVisible());
        renderMapContent();
        toast(STORE.photosVisible() ? '已显示拍照点' : '已隐藏拍照点');
        return;
      }
      const pa = t.closest('[data-photo-add]');
      if (pa) { openPhotoAdd(); return; }
      const prst = t.closest('[data-photo-restore]');
      if (prst) {
        STORE.restorePhotos();
        renderMapContent();
        toast('已恢复隐藏的拍照点');
        return;
      }
      const ph = t.closest('[data-photo-hide]');
      if (ph) {
        const wasUser = STORE.allPhotoSpots().filter(function (s) {
          return s.id === ph.dataset.photoHide;
        })[0];
        STORE.removePhotoSpot(ph.dataset.photoHide);
        if (map) map.closePopup();
        closeSheet();
        renderMapContent();
        toast(wasUser && wasUser._user ? '已删除' : '已隐藏，可点「恢复」找回');
        return;
      }

      const pOpen = t.closest('[data-photo-open]');
      if (pOpen) {
        const s = photoById(pOpen.dataset.photoOpen);
        if (s) photoSheet(s);
        return;
      }

      const pCopy = t.closest('[data-photo-copy]');
      if (pCopy) {
        const s = photoById(pCopy.dataset.photoCopy);
        if (s) copyPhotoAddress(s);
        return;
      }

      const pMap = t.closest('[data-photo-map]');
      if (pMap) {
        const s = photoById(pMap.dataset.photoMap);
        if (!s) return;
        const di = DAYS.map(function (d) { return d.id; }).indexOf(s.day);
        closeSheet();
        if (di >= 0) state.mapFilter = String(di);
        setView('map');
        setTimeout(function () {
          renderMapContent();
          pulseMapMarker(s.lat, s.lng, 15);
        }, 240);
        return;
      }

      /* ---- translation ----------------------------------------------- */
      const tg = t.closest('[data-tr-group]');
      if (tg) { tr.group = tg.dataset.trGroup; tr.q = ''; renderTranslate(); return; }
      // speech first: the speaker sits inside a phrase row, so the row's own
      // handler must not also fire
      const sy = t.closest('[data-say-phrase]');
      if (sy) { speakPhrase(Number(sy.dataset.sayPhrase), sy.dataset.sayLang); return; }
      const sr = t.closest('[data-say-result]');
      if (sr) { if (tr.result) speak(tr.result.text, sr.dataset.sayLang); return; }
      const tb = t.closest('[data-tr-big]');
      if (tb) { openPhrase(Number(tb.dataset.trBig)); return; }
      const ts = t.closest('[data-tr-swap]');
      if (ts) {
        const a = tr.from; tr.from = tr.to; tr.to = a;
        tr.result = null; tr.error = null;
        renderTranslate();
        return;
      }
      const tfrom = t.closest('[data-tr-from]');
      if (tfrom) {
        tr.from = nextLang(tr.from, 1);
        if (tr.from === tr.to) tr.to = nextLang(tr.from, 1);
        tr.result = null; tr.error = null;
        renderTranslate();
        return;
      }
      const tto = t.closest('[data-tr-to]');
      if (tto) {
        tr.to = nextLang(tr.to, 1);
        if (tr.to === tr.from) tr.from = nextLang(tr.to, 1);
        tr.result = null; tr.error = null;
        renderTranslate();
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
      if (cp) { copyText(cp.dataset.copy); return; }

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
              STORE.setBudget(parseFloat($('#bIn').value) || 0);
              closeSheet(); renderWallet(); renderMore(); toast('预算已更新');
            });
          });
        return;
      }

      const er = t.closest('[data-edit-rates]');
      if (er) {
        const r = rates();
        openSheet('手动设置汇率', '平时不用管 —— 会自动取实时汇率',
          '<div class="field"><label>1 CHF = ? CNY</label>' +
            '<input id="rCny" type="number" step="0.01" value="' + r.cny + '"></div>' +
          '<div class="field"><label>1 CHF = ? EUR</label>' +
            '<input id="rEur" type="number" step="0.01" value="' + r.eur + '"></div>' +
          '<button class="btn block primary" id="rSave" style="height:46px">保存</button>' +
          '<button class="btn block ghost" id="rAuto" style="height:46px;margin-top:9px">改回自动获取</button>',
          function () {
            $('#rSave').addEventListener('click', function () {
              STORE.setRates({
                cny: parseFloat($('#rCny').value) || 8.85,
                eur: parseFloat($('#rEur').value) || 1.06,
                date: zurichToday(),
                source: '手动设置',
                at: Date.now(),
              });
              closeSheet(); renderWallet(); renderMore(); toast('汇率已更新');
            });
            $('#rAuto').addEventListener('click', function () {
              STORE.setRates(null);
              closeSheet();
              fxRefresh(true).then(function (x) {
                renderWallet(); renderMore();
                toast('已切回实时汇率 · 1 CHF ≈ ¥' + x.cny.toFixed(2));
              });
            });
          });
        return;
      }

      /* ---- github sync ---------------------------------------------- */
      const ghSetupBtn = t.closest('[data-gh-setup]');
      if (ghSetupBtn) { openGhSetup(); return; }

      const ghPushBtn = t.closest('[data-gh-push]');
      if (ghPushBtn) {
        ghPushBtn.disabled = true;
        ghPushBtn.textContent = '上传中…';
        const back = function () { ghPushBtn.disabled = false; ghPushBtn.textContent = '上传到 GitHub'; };
        ghSyncPush().then(function (r) {
          toast('已同步到 GitHub：' + r.path + (r.shared ? '，并更新了分享' : ''));
          back();
          renderMore();
        }, function (e) {
          toast('同步失败：' + ((e && e.message) || e));
          back();
        });
        return;
      }

      const ghPullBtn = t.closest('[data-gh-pull]');
      if (ghPullBtn) {
        ghPullBtn.disabled = true;
        ghPullBtn.textContent = '读取中…';
        const back = function () { ghPullBtn.disabled = false; ghPullBtn.textContent = '从 GitHub 拉取'; };
        // Read first, then CONFIRM. Pulling overwrites the local store wholesale,
        // so it must never happen on a single stray tap.
        ghFetchPayload().then(function (payload) {
          back();
          const when = payload.syncedAt ? payload.syncedAt.slice(0, 16).replace('T', ' ') : '（未知时间）';
          const last = store.get(GH_LAST, 0);
          openSheet('从 GitHub 拉取', '会用远端数据覆盖本机',
            '<div style="font-size:13.5px;line-height:1.8;color:var(--ink-2);margin-bottom:12px">' +
              '远端文件时间：<b>' + esc(when) + '</b><br>' +
              '本机上次同步：<b>' + esc(last ? new Date(last).toLocaleString('zh-CN') : '从未') + '</b>' +
            '</div>' +
            '<div style="font-size:13.5px;line-height:1.8;color:var(--ink-2);margin-bottom:12px">' +
              '拉取会把本机的<b>地点、交通、安排、拍照点、记账、预算</b>整体替换成 GitHub 上那一份。' +
              '<b style="color:#c0392b">本机尚未上传的改动会丢失，且不可撤销。</b>' +
            '</div>' +
            '<div class="hint" style="margin-bottom:14px">' +
              '<b>什么时候该拉取：</b>换了手机、清过浏览器数据、或想用另一台设备上的最新版本。<br>' +
              '如果本机才是最新的，请改用「上传到 GitHub」——不要拉取。' +
            '</div>' +
            '<button class="btn block primary" id="doGhPull" style="background:#c0392b">确认覆盖本机数据</button>' +
            '<button class="btn block ghost" id="doGhPullCancel" style="margin-top:8px">取消</button>',
            function () {
              $('#doGhPull').addEventListener('click', function () {
                closeSheet();
                ghApplyPull(payload);
                refreshAfterEdit();
                renderMore();
                toast('已从 GitHub 恢复（' + when + '）');
              });
              $('#doGhPullCancel').addEventListener('click', closeSheet);
            }, 'editor');
        }, function (e) {
          back();
          toast('读取失败：' + ((e && e.message) || e));
        });
        return;
      }

      const ghShareBtn = t.closest('[data-gh-share]');
      if (ghShareBtn) {
        ghShareBtn.disabled = true;
        ghShareBtn.textContent = '发布中…';
        const back = function () { ghShareBtn.disabled = false; ghShareBtn.textContent = '更新分享'; };
        ghSharePush().then(function (r) {
          toast('已发布分享：' + r.repo + '/' + SHARE_PATH);
          back();
          renderMore();
        }, function (e) {
          toast('发布失败：' + ((e && e.message) || e));
          back();
        });
        return;
      }

      const ghShareLink = t.closest('[data-gh-sharelink]');
      if (ghShareLink) {
        copyText(shareLink(), '已复制分享链接');
        return;
      }

      const shareRefresh = t.closest('[data-share-refresh]');
      if (shareRefresh) { refreshShare(); return; }

      const shareExit = t.closest('[data-share-exit]');
      if (shareExit) {
        // put the viewer's own edits back before leaving the shared view
        try {
          const raw = localStorage.getItem(SHARE_SNAP);
          if (raw) {
            applyPayload(JSON.parse(raw));
            localStorage.removeItem(SHARE_SNAP);
          }
        } catch (e) {}
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
        location.reload();
        return;
      }

      /* ---- backup / restore ----------------------------------------- */
      const rdays = t.closest('[data-restore-days]');
      if (rdays) {
        const n = STORE.removedDays().length;
        STORE.restoreDays();
        state.sel = clamp(state.sel, 0, DAYS.length - 1);
        state.mapFilter = String(state.sel);
        refreshAfterEdit();
        toast('已恢复 ' + n + ' 天');
        return;
      }

      const bk = t.closest('[data-backup]');
      if (bk) {
        const blob = new Blob([STORE.exportJson()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'swiss-trip-my-edits.json';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        toast('已导出备份文件');
        return;
      }

      const rs2 = t.closest('[data-restore]');
      if (rs2) {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'application/json,.json';
        inp.addEventListener('change', function () {
          const f = inp.files && inp.files[0];
          if (!f) return;
          const rd = new FileReader();
          rd.onload = function () {
            try {
              STORE.importJson(String(rd.result));
              refreshAfterEdit();
              toast('已导入备份');
            } catch (e) { toast('导入失败：' + e.message); }
          };
          rd.readAsText(f);
        });
        inp.click();
        return;
      }

      const ce = t.closest('[data-clear-edits]');
      if (ce) {
        openSheet('清空我的修改', '不可撤销',
          '<div style="font-size:13.5px;line-height:1.7;color:var(--ink-2);margin-bottom:16px">' +
            '会删除你新增的地点、交通、安排、自定义常用消费，以及被隐藏的项目。' +
            '行程本身（来自仓库的原始内容）不受影响。' +
            '<br><br>账目记录和票据照片<b>不会</b>被删除。' +
          '</div>' +
          '<button class="btn block primary" id="doClearEdits" style="background:#c0392b">确定清空</button>',
          function () {
            $('#doClearEdits').addEventListener('click', function () {
              STORE.resetAll();
              closeSheet();
              refreshAfterEdit();
              toast('已清空修改');
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
      if (ol) { openExternal(ol.dataset.openLink); return; }

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

      const swUp = t.closest('[data-sw-update]');
      if (swUp) { forceUpdate(); return; }

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

    /* ---- preset field edits (fire on blur / enter, not per keystroke) --- */
    document.addEventListener('change', function (e) {
      const t = e.target;
      if (!t || !t.dataset) return;

      if (t.dataset.pamt) {
        const v = parseFloat(t.value);
        if (!isNaN(v) && v >= 0) {
          STORE.updatePreset(t.dataset.pamt, { amount: v }, true);
          toast('金额已更新为 ' + fmtCHF(v));
        }
        return;
      }
      if (t.dataset.plabel) {
        const v = String(t.value).trim();
        if (v) STORE.updatePreset(t.dataset.plabel, { label: v }, true);
        return;
      }
      if (t.dataset.pcat) {
        STORE.updatePreset(t.dataset.pcat, { cat: t.value }, true);
        renderWallet();
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

    // Beijing time, shown alongside the Swiss clock in the header top-right
    const b = beijingParts();
    const be = $('#bjTime');
    if (be) be.textContent = b.hour + ':' + b.minute;
  }

  /* ======================== boot ====================================== */
  let booted = false;

  function boot() {
    // guard against a double DOMContentLoaded: registering the delegated
    // listeners twice would make every tap fire twice
    if (booted) return;
    booted = true;

    // user edits must be merged into DAYS before anything renders
    STORE.load();

    // Read the share intent NOW: setView() below rewrites location.hash to the
    // active view, which would wipe the "#share" marker before we look at it.
    const shareWanted = /^#share\b/i.test(location.hash || '');

    initSel();
    state.mapFilter = String(state.sel);
    bind();
    tickClock();
    setInterval(tickClock, 20000);

    // speech voices arrive asynchronously on most browsers
    ttsRefresh();
    if (ttsSupported()) {
      try { speechSynthesis.addEventListener('voiceschanged', ttsRefresh); }
      catch (e) { try { speechSynthesis.onvoiceschanged = ttsRefresh; } catch (e2) {} }
    }

    // header subtitle
    const st = tripStatus();
    if (st.phase === 'before') $('#hdrSub').textContent = '距出发 ' + st.days + ' 天 · 8 天 7 晚';
    else if (st.phase === 'during') $('#hdrSub').textContent = '行程第 ' + (st.index + 1) + ' 天 / 共 ' + DAYS.length + ' 天';
    else $('#hdrSub').textContent = '行程已结束 · 8 天 7 晚';

    setView(state.view, { keepScroll: true });

    // a friend opening <site>/#share gets the owner's published itinerary
    maybeLoadShare(shareWanted);

    // weather: paint from cache immediately, then refresh in the background
    if (typeof WEATHER !== 'undefined') {
      WEATHER.loadCache();
      WEATHER.onUpdate(function () {
        if (state.view === 'today') renderHero();
        repaintWeatherSheet();
      });
      WEATHER.refresh();
    }

    // live CHF rates: cached 12 h, refreshed quietly in the background
    if (typeof SERVICES !== 'undefined') {
      fxRefresh(false).then(function () {
        if (state.view === 'wallet' || state.view === 'more') refreshAfterEdit();
      });
    }

    // offline indicator
    const off = () => $('#offlineBar').classList.toggle('is-on', !navigator.onLine);
    window.addEventListener('online', off);
    window.addEventListener('offline', off);
    off();

    // service worker: register, look for updates, and adopt a new version at
    // once. Without this a phone can keep serving a stale cached shell, which
    // makes a shipped fix look like it never arrived.
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        // a new worker took over → reload once so the fresh shell is used
        if (hadController) location.reload();
      });
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').then(function (reg) {
          reg.update().catch(function () {});
          const promote = function (w) {
            if (w && w.state === 'installed' && navigator.serviceWorker.controller) {
              w.postMessage('skipWaiting');
            }
          };
          promote(reg.waiting);
          reg.addEventListener('updatefound', function () {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener('statechange', function () { promote(nw); });
          });
        }).catch(function () {});
      });
    }

    // expose a little for debugging
    window.__swissTrip = { state, DAYS, HOTELS, BOOKINGS, setView, selectDay,
      version: APP_VERSION };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
