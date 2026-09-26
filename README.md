# 瑞士行 · 旅行工作台

Switzerland 4–11 Oct 2026 · 手机端行程工作台。
一个纯静态网页（无框架、无构建、无后端），推到 GitHub Pages 后用手机打开即可，
可以「添加到主屏幕」当 App 用，**离线也能查行程、酒店和票据**。

---

## 它能做什么

| 页面 | 内容 |
| --- | --- |
| **今日** | 当天行程时间轴、今晚住哪、今日交通（含已订车次发车时间）、当天地点、小贴士 |
| **行程** | 全部 8 天，可展开看每天的时间安排 / 交通 / 住宿 / 地点 / 贴士；也可切成「总览表」一屏看完 |
| **地图** | Leaflet 交互地图，可按天筛选，显示当天所有地点编号、酒店位置、地点连线与铁路走向；点任意点可直接跳 Google / Apple 地图导航 |
| **钱包** | ① 记账：CHF 记账 + 预算进度 + 分类占比 + 常见消费一键添加 + 导出 CSV；② 票据：半价卡、机票信息 + 可自行上传票据照片 |
| **更多** | 4 家酒店（可导航 / 复制地址）、5 段已订 SBB 车次、航班信息、实用链接、紧急电话、行程说明、设置 |

几个细节：

- **自动按瑞士时间判断"今天"**（`Europe/Zurich`），不受手机时区影响；顶部常驻瑞士当前时间。
- 出发前显示**倒计时**，行程中自动定位到当天，行程结束后显示总结。
- 支持**深色模式**（跟随系统）。
- 所有个人数据（账目、预算、票据照片）**只存在手机本地**，不上传、不进仓库。

---

## 文件结构

```
swiss-trip/
├── index.html                     页面结构 + SVG 图标
├── manifest.webmanifest           PWA 配置
├── sw.js                          Service Worker（离线缓存）
├── .nojekyll                      让 GitHub Pages 不做 Jekyll 处理
├── assets/
│   ├── css/app.css                全部样式
│   ├── js/data.js                 ★ 所有行程数据都在这里
│   ├── js/app.js                  逻辑（视图 / 地图 / 记账 / 票据）
│   ├── icons/                     App 图标
│   └── vendor/leaflet/            本地化的 Leaflet 1.9.4（不依赖 CDN）
└── README.md
```

**要改行程，只需要动 `assets/js/data.js` 一个文件。**

---

## 部署到 GitHub Pages

在 `swiss-trip` 目录里执行（把 `<你的用户名>` 和 `<仓库名>` 换成你自己的）：

```bash
git init
git add .
git commit -m "Swiss trip workbench"

git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

然后到 GitHub 仓库页面：

1. **Settings → Pages**
2. **Source** 选 `Deploy from a branch`
3. **Branch** 选 `main`，目录选 `/ (root)`，保存
4. 等 1–2 分钟，访问：

```
https://<你的用户名>.github.io/<仓库名>/
```

### 手机上打开

- **iPhone**：Safari 打开上面的网址 → 分享按钮 → **添加到主屏幕**
- **Android**：Chrome 打开 → 右上角 ⋮ → **添加到主屏幕** / **安装应用**

装好后图标会出现在桌面，打开是全屏无地址栏，行程、地图、酒店、票据离线可用
（地图底图第一次看过的区域会被缓存，完全没网时新区域会显示空白，但地点列表和导航按钮仍可用）。

> 如果仓库名是 `<你的用户名>.github.io`，访问地址就是 `https://<你的用户名>.github.io/`。

---

## 隐私：关于票据二维码

半价卡二维码里有你的姓名和出生日期。**本仓库不要放任何证件或票据照片。**

所以工作台的做法是：票据页里只放文字信息（卡号、有效期、航班信息），
**二维码和票据照片由你在手机上现场拍照上传**，保存在手机浏览器的本地存储（IndexedDB）里，
永远不会被提交到 Git，也不会上传到任何服务器。

换手机、清除浏览器数据、或换浏览器后这些照片会丢失 —— 到时重新拍一次即可。

---

## 怎么改内容

### 改行程

打开 `assets/js/data.js`，里面的结构很直白：

- `DAYS` — 8 天的行程。每天包含 `title`（标题）、`headline`（一句话亮点）、`stat`（首页右上角小标签）、
  `blocks`（时间轴）、`transport`（交通，`booked: '08:45'` 会显示成红色「已预订」徽章）、
  `hotelId`（住哪家）、`places`（地点，带经纬度）、`tips`（贴士）
- `HOTELS` — 4 家酒店，含地址与经纬度
- `BOOKINGS` — 5 段已订的 SBB 车次（来自 SBB App 的 Trips 截图）
- `FLIGHTS` — 去程 / 回程航班
- `TICKETS` — 票据文字信息
- `STATIONS` / `RAIL_ROUTES` — 火车站坐标与铁路走向（画在地图上）
- `EXPENSE_PRESETS` — 记账页的「常见消费」快捷项
- `TRIP.budgetTarget` — 默认预算（也可在 App 里改）

改完保存、刷新页面即可看到。要加一个地点，就往对应那天的 `places` 里加一条：

```js
{ name: '新地点', nameEn: 'New Place', lat: 46.6, lng: 8.0, kind: 'sight', note: '备注' }
```

`kind` 可选 `sight`（景点）/ `area`（区域）/ `transit`（车站），只影响图标。

### 改配色

`assets/css/app.css` 顶部的 `:root` 是全部设计变量，浅色和深色各一套。
每天的主题色在 `data.js` 的 `REGIONS` 里（日内瓦=青蓝，格林德瓦=深绿，翁根=靛蓝，苏黎世=紫）。

### 改了文件后，手机上看不到更新？

Service Worker 会缓存旧版本。手机上把页面下拉刷新两次，或在浏览器设置里清一次该站点的缓存即可。
（如果改了 `app.js` / `app.css`，也可以把 `sw.js` 里的 `VERSION = 'v1.0.0'` 改一个数字，强制更新。）

---

## 说明

行程数据来自本人的旅行行程单与 SBB App 订单截图，仅供个人出行使用。
所有交通时间为约数，实际发车时间与站台请以 **SBB Mobile App** 或车站现场为准；
山地缆车、游船与瀑布受天气和季节性开放影响。
