/* ============================================================================
   Swiss Trip Workbench — trip data
   Source: personal travel itinerary (Switzerland, October 2026)
           + SBB Mobile "Trips" screenshot (booked connections)
           + Swiss Half Fare Card (order confirmation)
   Everything the app renders comes from this file. Edit here to change content.

   NOTE — this repo is public. The traveller's real name and date of birth are
   deliberately NOT stored here. If you want them shown on your own device,
   edit `traveller` below and the half-fare-card rows in TICKETS — but keep
   those edits local (don't commit them), or the details become public.
   ========================================================================== */

const TRIP = {
  traveller: '本人',
  title: '瑞士 8 日行程',
  subtitle: 'Switzerland · 4–11 October 2026',
  purpose: 'Tourism / Visa application',
  entryExit: 'Geneva, Switzerland',
  duration: '8 days / 7 nights',
  startDate: '2026-10-04',
  endDate: '2026-10-11',
  timezone: 'Europe/Zurich',
  homeTimezone: 'Asia/Shanghai',
  currency: 'CHF',
  budgetTarget: 1500,
};

/* ---- region theming ---------------------------------------------------- */
const REGIONS = {
  geneva:   { label: '日内瓦',   labelEn: 'Geneva',        color: '#2E7D9A', soft: '#E6F1F5' },
  alps:     { label: '格林德瓦', labelEn: 'Grindelwald',    color: '#1F6F4A', soft: '#E5F2EC' },
  valley:   { label: '劳特布龙嫩', labelEn: 'Lauterbrunnen', color: '#3B6EA5', soft: '#E7EEF7' },
  zurich:   { label: '苏黎世',   labelEn: 'Zurich',         color: '#6B4E9E', soft: '#EFEAF7' },
  transit:  { label: '在途',     labelEn: 'In transit',     color: '#5A6572', soft: '#EDEFF2' },
};

/* ---- flights ----------------------------------------------------------- */
const FLIGHTS = [
  {
    id: 'out',
    direction: '去程 · Outbound',
    airline: 'Air China',
    code: 'CA861',
    date: '2026-10-04',
    from: '北京首都 PEK · T3',
    to: '日内瓦 GVA · T1',
    dep: '02:45',
    arr: '07:40',
    duration: '约 10 小时 55 分',
    note: '直飞 · 当地到达时间为 10 月 4 日早上',
    terminal: 'PEK T3 → GVA T1',
  },
  {
    id: 'ret',
    direction: '回程 · Return',
    airline: 'Air China',
    code: 'CA862',
    date: '2026-10-11',
    from: '日内瓦 GVA · T1',
    to: '北京首都 PEK · T3',
    dep: '13:20',
    arr: '05:25',
    arrDate: '2026-10-12',
    duration: '直飞',
    note: '建议 10:20 前抵达航站楼（国际航班提前约 3 小时）',
    terminal: 'GVA T1 → PEK T3',
  },
];

/* ---- booked SBB connections (from the SBB Mobile app) ------------------ */
const BOOKINGS = [
  { id: 'b1', date: '2026-10-05', dow: '周一', from: 'Genève-Aéroport', to: 'Grindelwald',  dep: '08:45', dayRef: 'd2' },
  { id: 'b2', date: '2026-10-07', dow: '周三', from: 'Grindelwald',     to: 'Lauterbrunnen', dep: '08:47', dayRef: 'd4' },
  { id: 'b3', date: '2026-10-07', dow: '周三', from: 'Lauterbrunnen',   to: 'Wengen',        dep: '10:30', dayRef: 'd4' },
  { id: 'b4', date: '2026-10-08', dow: '周四', from: 'Lauterbrunnen',   to: 'Zürich HB',     dep: '09:31', dayRef: 'd5' },
  { id: 'b5', date: '2026-10-10', dow: '周六', from: 'Zürich HB',       to: 'Genève-Aéroport', dep: '12:22', dayRef: 'd7' },
];

/* ---- hotels ------------------------------------------------------------ */
const HOTELS = [
  {
    id: 'h1',
    name: 'Holiday Inn Express Geneva Airport by IHG',
    city: '日内瓦机场 Meyrin',
    address: 'Rte de Pré-Bois 16, 1215 Meyrin',
    checkIn: '10-04', checkOut: '10-05',
    nights: 1,
    nightsText: '1 晚',
    region: 'geneva',
    lat: 46.2250, lng: 6.0950,
    tel: '',
    note: '机场区酒店，去程到达当晚与回程前一晚各住一次。提供机场接驳（视运营情况）。',
  },
  {
    id: 'h2',
    name: 'Sunstar Hotel & Spa Grindelwald',
    city: '格林德瓦',
    address: 'Dorfstrasse 168, 3818 Grindelwald',
    checkIn: '10-05', checkOut: '10-07',
    nights: 2,
    nightsText: '2 晚',
    region: 'alps',
    lat: 46.6244, lng: 8.0414,
    tel: '',
    note: '位于村中心 Dorfstrasse，步行 3–5 分钟到 Firstbahn 缆车站。',
  },
  {
    id: 'h3',
    name: 'Hotel Regina',
    city: 'Wengen 翁根',
    address: 'Zentrum, 3823 Wengen',
    checkIn: '10-07', checkOut: '10-08',
    nights: 1,
    nightsText: '1 晚',
    region: 'valley',
    lat: 46.6050, lng: 7.9226,
    tel: '',
    note: 'Wengen 为无车小镇，只能乘缆车/齿轨火车抵达，自驾车辆无法进入。',
  },
  {
    id: 'h4',
    name: 'Acasa Suites Hotel Zurich Oerlikon',
    city: '苏黎世 Oerlikon',
    address: 'Binzmühlestrasse 72, 8050 Zurich',
    checkIn: '10-08', checkOut: '10-10',
    nights: 2,
    nightsText: '2 晚',
    region: 'zurich',
    lat: 47.4113, lng: 8.5447,
    tel: '',
    note: 'Zurich Oerlikon 站附近，乘 S-Bahn 到 Zürich HB 约 10–20 分钟。',
  },
];

/* ---- tickets & passes -------------------------------------------------- */
/* holder / 持卡人 / 出生日期 intentionally omitted — see the note at the top. */
const TICKETS = [
  {
    id: 't1',
    kind: 'rail',
    title: '瑞士半价卡 Swiss Half Fare Card',
    holder: 'Swiss Half Fare Card',
    price: 'CHF 150.00',
    validFrom: '2026-10-04',
    validTo: '2026-11-03',
    facts: [
      ['卡类型', 'Swiss Half Fare Card（半价卡）'],
      ['价格', 'CHF 150.00'],
      ['有效期', '2026-10-04 → 2026-11-03'],
      ['权益', '1 个月内，1 等 / 2 等车票享 50% 折扣'],
    ],
    note: '使用时须与护照或身份证件同时出示。扫码请用瑞士铁路官方小程序 / SBB 官方渠道生成的二维码。',
  },
  {
    id: 't2',
    kind: 'flight',
    title: '去程机票 CA861',
    holder: '本人',
    facts: [
      ['航班', 'Air China CA861'],
      ['日期', '2026-10-04'],
      ['起飞', '北京首都 PEK T3 · 02:45'],
      ['到达', '日内瓦 GVA T1 · 07:40'],
    ],
    note: '直飞，飞行约 10 小时 55 分。',
  },
  {
    id: 't3',
    kind: 'flight',
    title: '回程机票 CA862',
    holder: '本人',
    facts: [
      ['航班', 'Air China CA862'],
      ['日期', '2026-10-11'],
      ['起飞', '日内瓦 GVA T1 · 13:20'],
      ['到达', '北京首都 PEK T3 · 次日 05:25'],
    ],
    note: '建议 10:20 前抵达航站楼。',
  },
];

/* ---- day by day -------------------------------------------------------- */
const DAYS = [
  /* ================= DAY 1 ================= */
  {
    id: 'd1',
    date: '2026-10-04',
    dow: '周日',
    dowEn: 'SUN 04 OCT',
    region: 'geneva',
    weatherPlace: 'geneva',
    title: '北京 → 日内瓦',
    titleEn: 'Beijing → Geneva',
    headline: '落地、进城、湖畔半日',
    stat: '湖畔半日',
    summary:
      '07:40 抵达日内瓦机场，入境取行李后进城。下午游览日内瓦湖与老城，傍晚回机场区酒店休息。',
    blocks: [
      { time: '07:40', label: '抵达', text: '乘 CA861 抵达日内瓦机场；完成入境与行李提取。' },
      { time: '上午', label: '上午', text: '前往酒店寄存行李，随后进入日内瓦市中心。' },
      {
        time: '下午',
        label: '下午',
        text: '大喷泉 Jet d\'Eau、英国花园花钟（Jardin Anglais）、日内瓦老城、圣皮埃尔大教堂外景、Bourg-de-Four 广场。',
      },
      { time: '傍晚', label: '傍晚', text: '沿日内瓦湖散步，返回机场区酒店休息。' },
    ],
    transport: [
      { from: '机场', to: '酒店', mode: '接驳车 / 巴士 / 出租车', duration: '约 5–15 分钟' },
      { from: '机场', to: '市中心', mode: '火车', duration: '单程约 7 分钟', note: '再以步行 / 电车接驳' },
    ],
    hotelId: 'h1',
    places: [
      { name: '大喷泉', nameEn: "Jet d'Eau", lat: 46.2074, lng: 6.1556, kind: 'sight', note: '日内瓦地标，140 米水柱' },
      { name: '花钟 / 英国花园', nameEn: 'Flower Clock · Jardin Anglais', lat: 46.2043, lng: 6.1524, kind: 'sight' },
      { name: '圣皮埃尔大教堂', nameEn: 'St Pierre Cathedral', lat: 46.2011, lng: 6.1479, kind: 'sight', note: '外景' },
      { name: 'Bourg-de-Four 广场', nameEn: 'Place du Bourg-de-Four', lat: 46.2006, lng: 6.1460, kind: 'sight', note: '老城最古老的广场' },
      { name: '日内瓦老城', nameEn: 'Geneva Old Town', lat: 46.2010, lng: 6.1470, kind: 'area' },
    ],
    tips: ['日内瓦机场到市区火车仅 7 分钟，非常方便', '抵达当天时差较大，行程安排较松，注意补水休息'],
  },

  /* ================= DAY 2 ================= */
  {
    id: 'd2',
    date: '2026-10-05',
    dow: '周一',
    dowEn: 'MON 05 OCT',
    region: 'alps',
    weatherPlace: 'grindelwald',
    title: '日内瓦 → 格林德瓦',
    titleEn: 'Geneva → Grindelwald',
    headline: '横穿瑞士，抵达少女峰脚下',
    stat: '横穿瑞士',
    summary:
      '早餐后退房，乘火车经伯尔尼、因特拉肯东站前往格林德瓦。下午入住并逛村庄，傍晚在村里晚餐。',
    blocks: [
      { time: '上午', label: '上午', text: '早餐并退房，乘火车前往格林德瓦。' },
      { time: '下午', label: '下午', text: '酒店入住，随后游览格林德瓦村庄、Dorfstrasse 主街与周边山景观景点。' },
      { time: '傍晚', label: '傍晚', text: '在格林德瓦晚餐、休整。' },
    ],
    transport: [
      { from: '酒店', to: '日内瓦机场站', mode: '接驳车 / 巴士 / 出租车', duration: '约 5–15 分钟' },
      {
        from: 'Genève-Aéroport', to: 'Grindelwald', mode: '火车（经 Bern、Interlaken Ost）',
        duration: '约 3 小时 55 分', note: '2 次换乘', booked: '08:45', bookingId: 'b1',
      },
      { from: '村内观光', to: '', mode: '步行 / 当地巴士', duration: '' },
    ],
    hotelId: 'h2',
    places: [
      { name: '格林德瓦村', nameEn: 'Grindelwald Village', lat: 46.6244, lng: 8.0414, kind: 'area' },
      { name: 'Dorfstrasse 主街', nameEn: 'Dorfstrasse', lat: 46.6230, lng: 8.0405, kind: 'area' },
      { name: 'Firstbahn 缆车站', nameEn: 'Firstbahn Valley Station', lat: 46.6242, lng: 8.0455, kind: 'transit', note: '明天从这里上山' },
    ],
    tips: ['格林德瓦住宿两晚，不必每天搬行李', '火车全程约 4 小时，建议提前买好车上零食'],
  },

  /* ================= DAY 3 ================= */
  {
    id: 'd3',
    date: '2026-10-06',
    dow: '周二',
    dowEn: 'TUE 06 OCT',
    region: 'alps',
    weatherPlace: 'first',
    title: '格林德瓦 First 冒险日',
    titleEn: 'Grindelwald-First Adventure Day',
    headline: '悬崖步道 · 巴赫阿尔卑湖 · 飞索 + 山地卡丁车',
    stat: 'First 冒险',
    summary:
      '步行至 Firstbahn 谷站，乘缆车上 First。走 First View 与 First Cliff Walk 悬崖步道，视路况徒步 Bachalpsee。之后玩 First Flyer 飞索与 Mountain Cart 山地卡丁车。',
    blocks: [
      {
        time: '上午', label: '上午',
        text: '步行至 Firstbahn 谷站，乘缆车到 First。游览 First View 与 First Cliff Walk 悬崖步道。若路况允许，徒步往返 Bachalpsee（约 1 小时 50 分）。',
      },
      {
        time: '下午', label: '冒险活动',
        text: '从 First 乘 First Flyer 飞索到 Schreckfeld，再从 Schreckfeld 乘 Mountain Cart 山地卡丁车到 Bort。天气、排队与开放情况允许的话，可选玩 First Glider 或 Trottibike。',
      },
      { time: '傍晚', label: '傍晚', text: '返回格林德瓦村晚餐、休息。' },
    ],
    transport: [
      { from: '酒店', to: 'Firstbahn 谷站', mode: '步行', duration: '约 3–5 分钟' },
      { from: 'Grindelwald', to: 'First', mode: '缆车', duration: '约 25 分钟' },
      { from: 'First', to: 'Schreckfeld', mode: 'First Flyer 飞索', duration: '约 10 分钟 + 排队' },
      { from: 'Schreckfeld', to: 'Bort', mode: 'Mountain Cart 山地卡丁车', duration: '约 30 分钟' },
      { from: 'Bort', to: 'Grindelwald', mode: '缆车 或 Trottibike', duration: '约 15–30 分钟' },
    ],
    hotelId: 'h2',
    places: [
      { name: 'First 观景台', nameEn: 'Grindelwald First', lat: 46.6570, lng: 8.0530, kind: 'sight', note: '海拔 2168 m' },
      { name: 'First 悬崖步道', nameEn: 'First Cliff Walk', lat: 46.6562, lng: 8.0540, kind: 'sight' },
      { name: '巴赫阿尔卑湖', nameEn: 'Bachalpsee', lat: 46.6697, lng: 8.0247, kind: 'sight', note: '往返约 1 小时 50 分' },
      { name: 'Schreckfeld 站', nameEn: 'Schreckfeld', lat: 46.6480, lng: 8.0583, kind: 'transit' },
      { name: 'Bort 站', nameEn: 'Bort', lat: 46.6349, lng: 8.0553, kind: 'transit' },
    ],
    tips: [
      'First 项目受当天天气、安全状态、排队与身高体重限制影响，建议早到',
      '持半价卡缆车享 50% 折扣，冒险项目通常不适用',
      '山上气温比村里低 5–8°C，注意保暖与防滑鞋',
    ],
  },

  /* ================= DAY 4 ================= */
  {
    id: 'd4',
    date: '2026-10-07',
    dow: '周三',
    dowEn: 'WED 07 OCT',
    region: 'valley',
    weatherPlace: 'wengen',
    title: '格林德瓦 → 劳特布龙嫩 → 翁根',
    titleEn: 'Grindelwald → Lauterbrunnen → Wengen',
    headline: '瀑布谷 + 无车小镇',
    stat: '瀑布谷',
    summary:
      '退房前往劳特布龙嫩，看施陶河瀑布、逛村庄山谷。下午视情况去特吕默尔巴赫冰川瀑布，再乘齿轨火车上无车小镇翁根。',
    blocks: [
      { time: '上午', label: '上午', text: '退房前往劳特布龙嫩。游览施陶河瀑布 Staubbach Falls，步行穿过村庄与山谷。' },
      { time: '下午', label: '下午', text: '若开放且天气允许，可选去特吕默尔巴赫瀑布。随后前往无车小镇翁根，入住并步行至观景点。' },
      { time: '傍晚', label: '傍晚', text: '在翁根晚餐并过夜。' },
    ],
    transport: [
      {
        from: 'Grindelwald', to: 'Lauterbrunnen', mode: '火车（经 Zweilütschinen）',
        duration: '约 39 分钟', booked: '08:47', bookingId: 'b2',
      },
      { from: '劳特布龙嫩站', to: '施陶河瀑布', mode: '步行', duration: '约 15–20 分钟' },
      { from: '', to: '特吕默尔巴赫瀑布', mode: '当地巴士', duration: '约 10–15 分钟' },
      {
        from: 'Lauterbrunnen', to: 'Wengen', mode: '齿轨火车',
        duration: '约 12 分钟', booked: '10:30', bookingId: 'b3',
      },
    ],
    hotelId: 'h3',
    places: [
      { name: '施陶河瀑布', nameEn: 'Staubbach Falls', lat: 46.5899, lng: 7.9087, kind: 'sight', note: '落差约 297 米' },
      { name: '劳特布龙嫩谷', nameEn: 'Lauterbrunnen Valley', lat: 46.5930, lng: 7.9080, kind: 'area' },
      { name: '特吕默尔巴赫瀑布', nameEn: 'Trümmelbach Falls', lat: 46.5658, lng: 7.9148, kind: 'sight', note: '可选 · 看开放情况' },
      { name: '翁根', nameEn: 'Wengen', lat: 46.6050, lng: 7.9226, kind: 'area', note: '无车小镇' },
    ],
    tips: ['翁根禁止汽车通行，行李需从劳特布龙嫩坐齿轨火车带上山', '特吕默尔巴赫瀑布为冰川内部瀑布，季节性开放'],
  },

  /* ================= DAY 5 ================= */
  {
    id: 'd5',
    date: '2026-10-08',
    dow: '周四',
    dowEn: 'THU 08 OCT',
    region: 'zurich',
    weatherPlace: 'zurich',
    title: '翁根 → 苏黎世',
    titleEn: 'Wengen → Zurich',
    headline: '下山，进城',
    stat: '进城苏黎世',
    summary: '早餐后退房，下山到劳特布龙嫩，继续乘火车前往苏黎世。下午逛班霍夫大街、林登霍夫与老城，傍晚沿利马特河与苏黎世湖散步。',
    blocks: [
      { time: '上午', label: '上午', text: '早餐、退房，下山至劳特布龙嫩，继续乘火车前往苏黎世。' },
      { time: '下午', label: '下午', text: '入住后游览班霍夫大街 Bahnhofstrasse、林登霍夫 Lindenhof 与苏黎世老城 Altstadt。' },
      { time: '傍晚', label: '傍晚', text: '沿利马特河与苏黎世湖滨步道散步。' },
    ],
    transport: [
      { from: 'Wengen', to: 'Lauterbrunnen', mode: '齿轨火车', duration: '约 12 分钟' },
      {
        from: 'Lauterbrunnen', to: 'Zürich HB', mode: '火车（经 Interlaken Ost、Bern）',
        duration: '约 2 小时 27 分', booked: '09:31', bookingId: 'b4',
      },
      { from: 'Zürich HB', to: '酒店', mode: 'S-Bahn 至 Zürich Oerlikon + 步行 / 电车', duration: '约 10–20 分钟' },
      { from: '市区景点', to: '', mode: '电车 + 步行', duration: '' },
    ],
    hotelId: 'h4',
    places: [
      { name: '班霍夫大街', nameEn: 'Bahnhofstrasse', lat: 47.3705, lng: 8.5395, kind: 'area' },
      { name: '林登霍夫', nameEn: 'Lindenhof', lat: 47.3730, lng: 8.5409, kind: 'sight' },
      { name: '苏黎世老城', nameEn: 'Altstadt', lat: 47.3720, lng: 8.5430, kind: 'area' },
      { name: '利马特河', nameEn: 'Limmat River', lat: 47.3735, lng: 8.5425, kind: 'area' },
      { name: '苏黎世湖滨', nameEn: 'Lake Zurich Promenade', lat: 47.3660, lng: 8.5410, kind: 'area' },
    ],
    tips: ['苏黎世住宿两晚，可把大件行李留在酒店', '苏黎世市内交通以电车为主，半价卡同样适用'],
  },

  /* ================= DAY 6 ================= */
  {
    id: 'd6',
    date: '2026-10-09',
    dow: '周五',
    dowEn: 'FRI 09 OCT',
    region: 'zurich',
    weatherPlace: 'rheinfall',
    title: '苏黎世 & 莱茵瀑布',
    titleEn: 'Zurich & Rhine Falls',
    headline: '欧洲最大瀑布一日往返',
    stat: '莱茵瀑布',
    summary:
      '上午前往莱茵瀑布，从 Neuhausen / 劳芬城堡一侧观景，可选乘船（看季节与天气）。下午回苏黎世逛大教堂、圣母大教堂外景与老城小巷，傍晚湖畔休闲。',
    blocks: [
      { time: '上午', label: '上午', text: '莱茵瀑布一日游。从 Neuhausen / Schloss Laufen 一侧观景；可选乘船（视季节运营与天气）。' },
      { time: '下午', label: '下午', text: '返回苏黎世。游览苏黎世大教堂 Grossmünster、圣母大教堂 Fraumünster 外景与老城小巷、苏黎世湖滨。' },
      { time: '傍晚', label: '傍晚', text: '在苏黎世自由活动、晚餐。' },
    ],
    transport: [
      {
        from: 'Zürich Oerlikon / HB', to: 'Neuhausen Rheinfall 或 Schloss Laufen am Rheinfall',
        mode: '火车', duration: '单程约 50–70 分钟', note: '视接驳而定',
      },
      { from: '车站', to: '观景点', mode: '步行', duration: '约 5–15 分钟' },
      { from: '苏黎世市区', to: '', mode: '电车 + 步行', duration: '' },
    ],
    hotelId: 'h4',
    places: [
      { name: '莱茵瀑布', nameEn: 'Rhine Falls · Rheinfall', lat: 47.6779, lng: 8.6151, kind: 'sight', note: '欧洲流量最大的瀑布' },
      { name: '劳芬城堡', nameEn: 'Schloss Laufen', lat: 47.6767, lng: 8.6147, kind: 'sight' },
      { name: '苏黎世大教堂', nameEn: 'Grossmünster', lat: 47.3701, lng: 8.5441, kind: 'sight' },
      { name: '圣母大教堂', nameEn: 'Fraumünster', lat: 47.3698, lng: 8.5417, kind: 'sight', note: '外景' },
    ],
    tips: ['瀑布观景平台建议走劳芬城堡一侧，视野更好', '往返约 2 小时车程，建议预留充足时间'],
  },

  /* ================= DAY 7 ================= */
  {
    id: 'd7',
    date: '2026-10-10',
    dow: '周六',
    dowEn: 'SAT 10 OCT',
    region: 'geneva',
    weatherPlace: 'geneva',
    title: '苏黎世 → 日内瓦',
    titleEn: 'Zurich → Geneva',
    headline: '横穿瑞士回到起点',
    stat: '回日内瓦',
    summary: '早餐后退房，乘火车前往日内瓦。下午在老城与宗教改革墙一带游览，傍晚回到机场区酒店，整理证件准备次日返程。',
    blocks: [
      { time: '上午', label: '上午', text: '早餐、退房，乘火车前往日内瓦。' },
      { time: '下午', label: '下午', text: '如需可先在酒店寄存行李。游览日内瓦老城、圣皮埃尔大教堂外景、Bourg-de-Four 广场与宗教改革墙。' },
      { time: '傍晚', label: '傍晚', text: '返回机场区酒店，准备旅行证件，休息。' },
    ],
    transport: [
      { from: '酒店', to: 'Zürich HB', mode: 'S-Bahn / 电车', duration: '约 10–20 分钟' },
      {
        from: 'Zürich HB', to: 'Genève-Aéroport', mode: '火车',
        duration: '约 3 小时 15 分', booked: '12:22', bookingId: 'b5',
      },
      { from: 'Genève-Aéroport', to: '机场酒店', mode: '接驳车 / 巴士 / 出租车 / 当地交通', duration: '合计约 20 分钟' },
    ],
    hotelId: 'h1',
    places: [
      { name: '宗教改革墙', nameEn: 'Reformation Wall', lat: 46.1990, lng: 6.1443, kind: 'sight' },
      { name: '圣皮埃尔大教堂', nameEn: 'St Pierre Cathedral', lat: 46.2011, lng: 6.1479, kind: 'sight', note: '外景' },
      { name: 'Bourg-de-Four 广场', nameEn: 'Place du Bourg-de-Four', lat: 46.2006, lng: 6.1460, kind: 'sight' },
      { name: '日内瓦老城', nameEn: 'Geneva Old Town', lat: 46.2010, lng: 6.1470, kind: 'area' },
    ],
    tips: ['苏黎世到日内瓦机场约 3 小时 15 分，别错过 12:22 那班', '当晚把护照、登机牌、退税单整理好'],
  },

  /* ================= DAY 8 ================= */
  {
    id: 'd8',
    date: '2026-10-11',
    dow: '周日',
    dowEn: 'SUN 11 OCT',
    region: 'transit',
    weatherPlace: 'gva',
    title: '日内瓦 → 北京',
    titleEn: 'Geneva → Beijing',
    headline: '返程',
    stat: '返程日',
    summary: '早餐后退房，前往日内瓦机场，办理登机、安检与出境。13:20 起飞回北京首都机场。',
    blocks: [
      { time: '上午', label: '上午', text: '早餐、酒店退房，前往日内瓦机场。' },
      { time: '机场', label: '机场', text: '办理登机、安检与出境手续。' },
      { time: '13:20', label: '起飞', text: '乘 CA862 从日内瓦飞往北京首都机场，次日 05:25 抵达。' },
    ],
    transport: [
      { from: '酒店', to: '日内瓦机场', mode: '酒店接驳 / 当地巴士 / 出租车', duration: '约 5–15 分钟' },
      { from: '', to: '航站楼', mode: '建议到达时间', duration: '约 10:20（国际航班提前约 3 小时）' },
    ],
    hotelId: null,
    places: [
      { name: '日内瓦机场', nameEn: 'Geneva Airport GVA', lat: 46.2381, lng: 6.1089, kind: 'transit' },
    ],
    tips: ['无住宿，当天返程', '预留 3 小时办理手续，旺季排队较长'],
  },
];

/* ---- travel notes ------------------------------------------------------ */
const NOTES = [
  '所有铁路与市内交通时间均为约数，用于行程 / 签证说明。最终发车时间与站台以 SBB Mobile App 或车站现场为准。',
  '山地游览、缆车、游船与瀑布受天气、季节性开放时间与检修影响；若景点不可用，将改去附近同等景点。',
  'First 冒险项目计划在 2026 年公布的运营季内进行，但能否参与仍取决于当天天气、安全状态、排队、身高体重要求与余位。建议早到，必要时改玩其他开放项目。',
];

/* ---- quick-add expense presets (Swiss flavoured) ----------------------- */
const EXPENSE_PRESETS = [
  { label: 'SBB 火车票',       amount: 25,  cat: 'transport' },
  { label: '缆车 / 登山火车',   amount: 34,  cat: 'transport' },
  { label: '市内交通日票',      amount: 9,   cat: 'transport' },
  { label: '咖啡 / 热饮',       amount: 6,   cat: 'food' },
  { label: '午餐',              amount: 22,  cat: 'food' },
  { label: '晚餐',              amount: 38,  cat: 'food' },
  { label: 'Coop / Migros 超市', amount: 15, cat: 'food' },
  { label: '景点门票',          amount: 12,  cat: 'ticket' },
  { label: '纪念品',            amount: 20,  cat: 'shopping' },
];

const EXPENSE_CATEGORIES = [
  { id: 'transport', label: '交通',   icon: 'train',  color: '#3B6EA5' },
  { id: 'food',      label: '餐饮',   icon: 'cup',    color: '#C4703A' },
  { id: 'ticket',    label: '门票',   icon: 'ticket', color: '#6B4E9E' },
  { id: 'hotel',     label: '住宿',   icon: 'bed',    color: '#1F6F4A' },
  { id: 'shopping',  label: '购物',   icon: 'bag',    color: '#C0392B' },
  { id: 'other',     label: '其他',   icon: 'dot',    color: '#5A6572' },
];

/* ---- emergency / practical contacts ----------------------------------- */
const CONTACTS = [
  { label: '欧洲紧急电话（通用）', value: '112', kind: 'tel' },
  { label: '瑞士报警', value: '117', kind: 'tel' },
  { label: '瑞士火警', value: '118', kind: 'tel' },
  { label: '瑞士救护车', value: '144', kind: 'tel' },
  { label: '中国驻瑞士大使馆（伯尔尼）', value: '+41 31 352 7333', kind: 'tel' },
  { label: 'SBB 瑞士铁路客服', value: '+41 848 44 66 88', kind: 'tel' },
];

/* ---- useful links ------------------------------------------------------ */
const LINKS = [
  { label: 'SBB Mobile / 瑞士铁路', desc: '查时刻表、买票、看站台', url: 'https://www.sbb.ch/en' },
  { label: '瑞士官方旅游官网', desc: '景点开放时间与天气', url: 'https://www.myswitzerland.com/en/' },
  { label: '格林德瓦 First 官网', desc: '缆车与冒险项目运营状态', url: 'https://www.jungfrau.ch/en-gb/grindelwaldfirst/' },
  { label: '少女峰地区交通', desc: 'Jungfrau 区域线路与票务', url: 'https://www.jungfrau.ch/en-gb/' },
  { label: '莱茵瀑布官网', desc: '开放时间与游船信息', url: 'https://www.rheinfall.ch/en' },
  { label: '瑞士天气 MeteoSwiss', desc: '逐小时山区天气', url: 'https://www.meteoswiss.admin.ch/' },
];

/* ---- railway stations & hubs (lat, lng) -------------------------------- */
const STATIONS = {
  gva:        [46.2325, 6.1090],  // Genève-Aéroport
  geneva:     [46.2103, 6.1425],  // Genève Cornavin
  bern:       [46.9489, 7.4391],
  interlaken: [46.6905, 7.8690],  // Interlaken Ost
  zweilutsch: [46.6340, 7.8950],  // Zweilütschinen
  grindelwald:[46.6244, 8.0414],
  lauterbrunn:[46.5930, 7.9080],
  wengen:     [46.6050, 7.9226],
  zurichHB:   [47.3782, 8.5402],
  oerlikon:   [47.4113, 8.5447],
  rheinfall:  [47.6779, 8.6151],  // Neuhausen Rheinfall
  laufen:     [47.6767, 8.6147],  // Schloss Laufen am Rheinfall
};

/* ---- rail corridors per day, as ordered station waypoints -------------- */
const RAIL_ROUTES = {
  d1: [
    { label: '机场 → 日内瓦市区', path: ['gva', 'geneva'] },
  ],
  d2: [
    { label: 'Genève-Aéroport → Grindelwald', path: ['gva', 'bern', 'interlaken', 'zweilutsch', 'grindelwald'] },
  ],
  d4: [
    { label: 'Grindelwald → Lauterbrunnen', path: ['grindelwald', 'zweilutsch', 'lauterbrunn'] },
    { label: 'Lauterbrunnen → Wengen', path: ['lauterbrunn', 'wengen'] },
  ],
  d5: [
    { label: 'Wengen → Lauterbrunnen', path: ['wengen', 'lauterbrunn'] },
    { label: 'Lauterbrunnen → Zürich HB', path: ['lauterbrunn', 'interlaken', 'bern', 'zurichHB'] },
    { label: 'Zürich HB → Oerlikon', path: ['zurichHB', 'oerlikon'] },
  ],
  d6: [
    { label: 'Zürich HB → Neuhausen Rheinfall', path: ['zurichHB', 'oerlikon', 'rheinfall'] },
  ],
  d7: [
    { label: 'Zürich HB → Genève-Aéroport', path: ['zurichHB', 'bern', 'geneva', 'gva'] },
  ],
};

/* ---- weather query points (one per distinct outlook we care about) ------ */
const WEATHER_PLACES = {
  geneva:      { lat: 46.2044, lng: 6.1432, label: '日内瓦',       elev: '约 375 m' },
  grindelwald: { lat: 46.6244, lng: 8.0414, label: '格林德瓦',     elev: '约 1030 m' },
  first:       { lat: 46.6570, lng: 8.0530, label: 'First 观景台', elev: '约 2168 m', mountain: true },
  wengen:      { lat: 46.6050, lng: 7.9226, label: '翁根',         elev: '约 1274 m' },
  zurich:      { lat: 47.3769, lng: 8.5417, label: '苏黎世',       elev: '约 408 m' },
  rheinfall:   { lat: 47.6779, lng: 8.6151, label: '莱茵瀑布',     elev: '约 380 m' },
  gva:         { lat: 46.2381, lng: 6.1089, label: '日内瓦机场',   elev: '约 430 m' },
};

/* ---- WMO weather codes -> plain Chinese + visual group ----------------- */
const WMO = {
  0:  { zh: '晴',           en: 'Clear',            g: 'clear'   },
  1:  { zh: '大部晴朗',     en: 'Mainly clear',     g: 'clear'   },
  2:  { zh: '多云',         en: 'Partly cloudy',    g: 'partly'  },
  3:  { zh: '阴',           en: 'Overcast',         g: 'cloudy'  },
  45: { zh: '有雾',         en: 'Fog',              g: 'fog'     },
  48: { zh: '雾凇',         en: 'Depositing rime',  g: 'fog'     },
  51: { zh: '小毛毛雨',     en: 'Light drizzle',    g: 'drizzle' },
  53: { zh: '毛毛雨',       en: 'Drizzle',          g: 'drizzle' },
  55: { zh: '大毛毛雨',     en: 'Dense drizzle',    g: 'drizzle' },
  56: { zh: '冻毛毛雨',     en: 'Freezing drizzle', g: 'sleet'   },
  57: { zh: '强冻毛毛雨',   en: 'Freezing drizzle', g: 'sleet'   },
  61: { zh: '小雨',         en: 'Light rain',       g: 'rain'    },
  63: { zh: '中雨',         en: 'Rain',             g: 'rain'    },
  65: { zh: '大雨',         en: 'Heavy rain',       g: 'rain'    },
  66: { zh: '冻雨',         en: 'Freezing rain',    g: 'sleet'   },
  67: { zh: '强冻雨',       en: 'Freezing rain',    g: 'sleet'   },
  71: { zh: '小雪',         en: 'Light snow',       g: 'snow'    },
  73: { zh: '中雪',         en: 'Snow',             g: 'snow'    },
  75: { zh: '大雪',         en: 'Heavy snow',       g: 'snow'    },
  77: { zh: '雪粒',         en: 'Snow grains',      g: 'snow'    },
  80: { zh: '阵雨',         en: 'Rain showers',     g: 'rain'    },
  81: { zh: '中阵雨',       en: 'Rain showers',     g: 'rain'    },
  82: { zh: '强阵雨',       en: 'Violent showers',  g: 'rain'    },
  85: { zh: '阵雪',         en: 'Snow showers',     g: 'snow'    },
  86: { zh: '强阵雪',       en: 'Snow showers',     g: 'snow'    },
  95: { zh: '雷阵雨',       en: 'Thunderstorm',     g: 'thunder' },
  96: { zh: '雷阵雨伴冰雹', en: 'Storm with hail',  g: 'thunder' },
  99: { zh: '强雷雨伴冰雹', en: 'Storm with hail',  g: 'thunder' },
};

/* ---- clothing bands, keyed on the daytime "feels like" high ------------ */
const WX_CLOTHING = [
  { min: 25, text: '短袖 + 短裤或薄长裤，做好防晒' },
  { min: 20, text: '短袖或薄长袖，早晚加一件薄外套' },
  { min: 16, text: '长袖上衣 + 薄外套 / 卫衣' },
  { min: 12, text: '毛衣或抓绒 + 防风外套' },
  { min: 8,  text: '抓绒 + 厚外套，围巾备用' },
  { min: 3,  text: '保暖内衣 + 厚外套或薄羽绒' },
  { min: -99, text: '羽绒服 + 帽子、手套、围巾' },
];

/* ---- recommended photo spots -------------------------------------------
   Coordinates resolved via OpenStreetMap / Nominatim. `best` is when and from
   where to shoot; `day` ties a spot to the itinerary so the map can filter.
   ---------------------------------------------------------------------- */
const PHOTO_SPOTS = [
  /* --- Day 1 · Geneva --- */
  { id: 'ph1', day: 'd1', region: 'geneva', name: '大喷泉', nameEn: "Jet d'Eau",
    lat: 46.20738, lng: 6.15589, best: '清晨顺光，从 Bains des Pâquis 一侧拍水柱与湖面',
    tip: '水柱高 140 米。风大时会溅到岸上，镜头注意防水。' },
  { id: 'ph2', day: 'd1', region: 'geneva', name: '旧城圣彼得大教堂塔顶', nameEn: 'Cathedrale Saint-Pierre tower',
    lat: 46.20109, lng: 6.1485, best: '上午顺光，登塔俯拍旧城红色屋顶与湖',
    tip: '塔楼需买票，台阶较窄，上午人少。' },
  { id: 'ph3', day: 'd1', region: 'geneva', name: 'Bourg-de-Four 广场', nameEn: 'Place du Bourg-de-Four',
    lat: 46.20032, lng: 6.14914, best: '傍晚金色光线，喷泉与露天咖啡座',
    tip: '旧城最古老的广场，傍晚人多但光线最好。' },
  { id: 'ph4', day: 'd1', region: 'geneva', name: '断椅', nameEn: 'Broken Chair',
    lat: 46.2228, lng: 6.13885, best: '任何时间，低角度拍出巨大的尺度感',
    tip: '联合国门前，纪念地雷受害者的地标。' },

  /* --- Day 2 · Geneva → Grindelwald (train day) --- */
  { id: 'ph5', day: 'd2', region: 'alps', name: '施皮茨城堡', nameEn: 'Schloss Spiez',
    lat: 46.689379, lng: 7.687468, best: '列车经过时靠右窗；下车可拍城堡与图恩湖',
    tip: '从日内瓦到因特拉肯的车窗右侧，图恩湖段最美。' },
  { id: 'ph6', day: 'd2', region: 'alps', name: 'Iseltwald 码头', nameEn: 'Iseltwald pier',
    lat: 46.71046, lng: 7.96346, best: '上午无风时拍倒影',
    tip: '《爱的迫降》取景地，从因特拉肯坐 103 路公交约 15 分钟。' },
  { id: 'ph7', day: 'd2', region: 'alps', name: 'Harder Kulm 观景台', nameEn: 'Harder Kulm',
    lat: 46.69968, lng: 7.85614, best: '傍晚，拍因特拉肯两湖与少女峰剪影',
    tip: '斜坡火车上去约 10 分钟，山顶有悬空观景台。' },

  /* --- Day 3 · Grindelwald First --- */
  { id: 'ph8', day: 'd3', region: 'alps', name: '巴赫阿尔卑湖倒影', nameEn: 'Bachalpsee',
    lat: 46.66958, lng: 8.02095, best: '清晨 9-10 点风小、湖面平静时最好',
    tip: '从 First 步行约 50 分钟。早上云少，午后起风就拍不到倒影了。' },
  { id: 'ph9', day: 'd3', region: 'alps', name: 'First 悬崖步道', nameEn: 'First Cliff Walk',
    lat: 46.66033, lng: 8.05301, best: '上午，悬崖边拍人像与艾格尔峰',
    tip: '铁索悬崖步道，风大时注意帽子和手机。' },
  { id: 'ph10', day: 'd3', region: 'alps', name: '艾格尔山北壁（Grosse Scheidegg）', nameEn: 'Grosse Scheidegg',
    lat: 46.65588, lng: 8.10187, best: '下午顺光，拍北壁全景',
    tip: '从 First 再往前的高地，能看到整面艾格尔北壁。' },
  { id: 'ph11', day: 'd3', region: 'alps', name: '冰川峡谷', nameEn: 'Gletscherschlucht',
    lat: 46.611, lng: 8.05029, best: '正午，峡谷里光线最好时才能拍出水色',
    tip: '进入峡谷要带防水外套，水汽很大。' },

  /* --- Day 4 · Lauterbrunnen valley --- */
  { id: 'ph12', day: 'd4', region: 'valley', name: '施陶河瀑布', nameEn: 'Staubbach Falls',
    lat: 46.589776, lng: 7.905429, best: '下午至黄昏，从村里拍瀑布与教堂',
    tip: '近 300 米高。村口小山坡上的角度最经典。' },
  { id: 'ph13', day: 'd4', region: 'valley', name: '特吕默尔巴赫瀑布', nameEn: 'Trummelbach Falls',
    lat: 46.57005, lng: 7.91303, best: '上午到午前，洞内漫射光较强',
    tip: '洞内禁止三脚架，很湿滑，穿防滑鞋。' },
  { id: 'ph14', day: 'd4', region: 'valley', name: '劳特布龙嫩谷地全景', nameEn: 'Lauterbrunnen valley view',
    lat: 46.5939, lng: 7.9078, best: '清晨有雾时最有层次',
    tip: '从 Wengen 下来的列车窗口就能拍到整条谷地。' },
  { id: 'ph15', day: 'd4', region: 'valley', name: '翁根村', nameEn: 'Wengen',
    lat: 46.60544, lng: 7.92172, best: '傍晚，木屋与山谷同框',
    tip: '无汽车小镇，上山只能坐火车。' },
  { id: 'ph16', day: 'd4', region: 'valley', name: '米伦村', nameEn: 'Murren',
    lat: 46.55914, lng: 7.89288, best: '晴天下 午，正对雪山三峰',
    tip: '在悬崖上的无车小镇，观景台看少女峰最正。' },

  /* --- Day 5 · Zurich --- */
  { id: 'ph17', day: 'd5', region: 'zurich', name: 'Lindenhof 小丘', nameEn: 'Lindenhof',
    lat: 47.37292, lng: 8.54018, best: '傍晚，拍旧城屋顶与利马特河',
    tip: '老城高处的小广场，有石棋盘，可以坐一会儿。' },
  { id: 'ph18', day: 'd5', region: 'zurich', name: '苏黎世大教堂塔顶', nameEn: 'Grossmunster tower',
    lat: 47.37012, lng: 8.54391, best: '上午，登塔拍利马特河与老城',
    tip: '双塔可以上去，台阶很多，但视野是老城最好的。' },
  { id: 'ph19', day: 'd5', region: 'zurich', name: '苏黎世湖畔（Bürkliplatz）', nameEn: 'Burkliplatz',
    lat: 47.36638, lng: 8.54119, best: '日落前后，湖面与远山',
    tip: '可以从这里坐游船，也是看夕阳的好位置。' },
  { id: 'ph20', day: 'd5', region: 'zurich', name: 'Polyterrasse 平台', nameEn: 'Polyterrasse',
    lat: 47.37617, lng: 8.54671, best: '黄昏与夜景，俯瞰老城全景',
    tip: 'ETH 前的平台，坐 Polybahn 红色小缆车上去很有意思。' },

  /* --- Day 6 · Rhine Falls --- */
  { id: 'ph21', day: 'd6', region: 'zurich', name: '莱茵瀑布观景台', nameEn: 'Rheinfall',
    lat: 47.67836, lng: 8.61487, best: '上午，水量大时最壮观',
    tip: '欧洲最大的瀑布。坐船到岩石上能最近距离看。' },
  { id: 'ph22', day: 'd6', region: 'zurich', name: '劳芬城堡', nameEn: 'Schloss Laufen',
    lat: 47.6768, lng: 8.61485, best: '下午，从城堡侧拍瀑布全景',
    tip: '城堡内有悬空观景廊，可以走到瀑布正上方。' },
];

/* ---- travel phrasebook (Chinese / English / German) ---------------------
   Offline by design: this is the part that has to work with no signal.
   ---------------------------------------------------------------------- */
const PHRASE_GROUPS = [
  {
    id: 'transport', label: '交通出行', labelEn: 'Transport', icon: 'train',
    items: [
      ['请问去……怎么走？', 'How do I get to …?', 'Wie komme ich nach …?', '怎么去 路线 在哪'],
      ['这趟车去苏黎世吗？', 'Does this train go to Zurich?', 'Fährt dieser Zug nach Zürich?'],
      ['单程票 / 往返票', 'One way / return', 'Einfach / Hin und zurück', '单程 往返 来回 来回票'],
      ['我要去机场', 'I would like to go to the airport', 'Ich möchte zum Flughafen'],
      ['下一班是几点？', 'What time is the next one?', 'Wann fährt der nächste?', '班次 时刻 时间表 时刻表'],
      ['在哪个站台？', 'Which platform is it?', 'Auf welchem Gleis?', '站台 月台 几号站台'],
      ['需要换乘吗？', 'Do I need to change?', 'Muss ich umsteigen?', '换乘 转车 倒车'],
      ['这班车取消了吗？', 'Is this service cancelled?', 'Fällt dieser Zug aus?', '取消 晚点 延误 停运'],
    ],
  },
  {
    id: 'food', label: '点餐饮食', labelEn: 'Food & drink', icon: 'coins',
    items: [
      ['两位，谢谢', 'A table for two, please', 'Einen Tisch für zwei, bitte', '位子 桌子 订位 几个人'],
      ['请给我菜单', 'Could I see the menu?', 'Könnte ich die Speisekarte haben?', '菜单 菜谱'],
      ['有中文菜单吗？', 'Do you have a Chinese menu?', 'Haben Sie eine chinesische Speisekarte?'],
      ['我要这个', 'I will have this one', 'Ich nehme das'],
      ['不要猪肉', 'No pork, please', 'Ohne Schweinefleisch, bitte', '猪肉 不吃'],
      ['我对……过敏', 'I am allergic to …', 'Ich bin allergisch gegen …', '过敏 忌口'],
      ['买单，谢谢', 'The bill, please', 'Die Rechnung, bitte', '结账 付钱 账单 埋单'],
      ['可以刷卡吗？', 'Can I pay by card?', 'Kann ich mit Karte zahlen?', '刷卡 信用卡 支付 支付宝 微信'],
    ],
  },
  {
    id: 'hotel', label: '住宿', labelEn: 'Hotel', icon: 'bed',
    items: [
      ['我预订了房间', 'I have a reservation', 'Ich habe eine Reservierung', '预订 订房 前台 登记'],
      ['几点可以入住？', 'What time is check-in?', 'Ab wann kann ich einchecken?'],
      ['可以寄存行李吗？', 'Can I leave my luggage here?', 'Kann ich mein Gepäck aufbewahren?', '行李 寄存 存放'],
      ['房间的 Wi-Fi 密码是？', 'What is the Wi-Fi password?', 'Wie lautet das WLAN-Passwort?', 'wifi 网络 密码 上网'],
      ['房间里没有热水', 'There is no hot water in my room', 'In meinem Zimmer gibt es kein warmes Wasser', '热水 洗澡'],
      ['可以晚一点退房吗？', 'Could I have a late check-out?', 'Kann ich später auschecken?'],
      ['请帮我叫一辆出租车', 'Could you call me a taxi?', 'Könnten Sie mir ein Taxi rufen?'],
    ],
  },
  {
    id: 'shopping', label: '购物付款', labelEn: 'Shopping', icon: 'coins',
    items: [
      ['多少钱？', 'How much is it?', 'Wie viel kostet das?', '价格 价钱 贵'],
      ['太贵了，可以便宜点吗？', 'That is expensive — any discount?', 'Das ist teuer — geht da noch etwas?', '便宜 打折 砍价 贵'],
      ['我可以试穿吗？', 'Can I try it on?', 'Kann ich das anprobieren?'],
      ['可以退税吗？', 'Can I get a tax refund?', 'Bekomme ich die Mehrwertsteuer zurück?', '退税 免税 增值税'],
      ['只要这个', 'Just this one, please', 'Nur das, bitte'],
      ['请给我发票', 'Could I have a receipt?', 'Könnte ich eine Quittung haben?', '发票 收据 小票'],
      ['有更大的尺码吗？', 'Do you have a bigger size?', 'Haben Sie eine grössere Grösse?', '尺码 尺寸 大小'],
    ],
  },
  {
    id: 'ask', label: '问路求助', labelEn: 'Asking for help', icon: 'pin',
    items: [
      ['请问洗手间在哪里？', 'Where is the toilet?', 'Wo ist die Toilette?', '厕所 卫生间 洗手间 盥洗室 WC 方便'],
      ['可以帮我拍张照吗？', 'Could you take a photo for me?', 'Könnten Sie ein Foto von mir machen?', '拍照 照相 合影'],
      ['我听不懂，请说慢一点', 'I do not understand — please speak slowly', 'Ich verstehe nicht — bitte sprechen Sie langsam', '听不懂 慢 重复 再说一遍'],
      ['你会说英语吗？', 'Do you speak English?', 'Sprechen Sie Englisch?', '英语 中文 语言'],
      ['这里可以拍照吗？', 'May I take photos here?', 'Darf ich hier fotografieren?', '拍照 照相 禁止'],
      ['我迷路了', 'I am lost', 'Ich habe mich verirrt', '迷路 走丢 找不到'],
    ],
  },
  {
    id: 'sight', label: '观光', labelEn: 'Sightseeing', icon: 'map',
    items: [
      ['门票多少钱？', 'How much is the ticket?', 'Wie viel kostet der Eintritt?', '门票 票价 价格'],
      ['学生有折扣吗？', 'Is there a student discount?', 'Gibt es einen Studentenrabatt?', '学生 折扣 优惠'],
      ['缆车今天运行吗？', 'Is the cable car running today?', 'Fährt die Seilbahn heute?', '缆车 索道 运行 停运'],
      ['最后一班下山是几点？', 'When is the last descent?', 'Wann geht die letzte Talfahrt?', '末班 下山 最后一班'],
      ['山顶天气怎么样？', 'What is the weather like at the top?', 'Wie ist das Wetter oben?', '山顶 天气'],
      ['这个观景台怎么走？', 'How do I get to this viewpoint?', 'Wie komme ich zu diesem Aussichtspunkt?', '观景台 怎么走 路线'],
    ],
  },
  {
    id: 'sos', label: '紧急情况', labelEn: 'Emergency', icon: 'sos',
    items: [
      ['请帮帮我！', 'Please help me!', 'Bitte helfen Sie mir!', '救命 帮忙 求助 紧急'],
      ['叫救护车', 'Call an ambulance', 'Rufen Sie einen Krankenwagen', '救护车 急救'],
      ['叫警察', 'Call the police', 'Rufen Sie die Polizei', '警察 报警'],
      ['我需要医生', 'I need a doctor', 'Ich brauche einen Arzt', '医生 看病 医院'],
      ['我的护照丢了', 'I have lost my passport', 'Ich habe meinen Pass verloren', '护照 丢了 遗失'],
      ['我的钱包被偷了', 'My wallet has been stolen', 'Meine Geldbörse wurde gestohlen', '钱包 偷 被盗 抢劫'],
      ['最近的医院在哪里？', 'Where is the nearest hospital?', 'Wo ist das nächste Krankenhaus?', '医院 最近 急诊'],
    ],
  },
];
