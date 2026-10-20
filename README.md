# 大模型 API 统一管理平台（AI 钱包余额监控）

纯监控 + 充值管理的大模型平台面板系统。不转发业务请求，只负责：余额监控、低余额告警、充值提醒、到账跟踪、资金统计。

## 功能

- **平台面板管理**：增删改查各平台；支持两种类型——API 接口型（官方余额接口）与浏览器抓取型（登录态复用抓钱包页）；快速添加预设 + 品牌图标
- **余额监控**：定时巡检（平台并行抓取），余额低于阈值自动生成充值提醒；低余额顶部红色预警横幅 + 桌面弹窗 + 手机推送
- **充值提醒**：余额低于阈值 → 自动生成充值单 → 登记打款 → 巡检检测到账 → 自动计入资金统计；支持用途备注、撤销打款、分页
- **资金统计**：累计充值总额 + 月度充值明细（按平台汇总、扇形占比图、CSV 导出），方便决定下个月给各平台充多少
- **手机推送**：Server酱（微信）/ Bark（iOS）双通道，低余额与到账事件可推送到手机
- **历史记录**：余额历史、到账流水

## 技术栈

- Node.js ≥ 20 + Fastify 5（ES Module）
- sql.js（SQLite WASM，无需原生编译）
- Playwright（浏览器抓取型平台，复用登录态）
- 前端：原生 HTML/JS 单页（零构建零依赖）

## 快速开始（自己用 / 给别人部署）

```bash
# 1. 安装依赖（别人 clone 下来后没有 node_modules，必须执行这步）
npm install

# 2. 启动服务
npm start
# 或直接双击 启动项.bat（提供菜单：启动/查看服务、打开汇总页）
```

启动后访问 http://localhost:3000，数据库（data/llm-manager.db）首次启动自动创建，会被 .gitignore 排除、不上传。

### 添加平台

- 页面「添加平台」：选「API 接口型」填官方余额接口，或选「浏览器抓取型」填钱包余额网址
- 或一键写入 6 个预设（腾讯云/MIMO/Kimi/阿里云/MiniMax/火山引擎）：

```bash
node scripts/setup-wallet-platforms.mjs
```

### 浏览器抓取型：一次性登录（关键步骤）

```bash
node scripts/wallet-login.mjs          # 登录全部平台
node scripts/wallet-login.mjs tencent  # 只登录指定平台
```

或双击 重新登录.bat。脚本会弹出浏览器窗口，逐个平台打开登录页——在窗口里手动登录一次，登录成功后自动把登录态保存到 src/wallet-states/storage_<平台>.json，之后定时巡检自动加载该登录态抓取余额，不用再登录。

验证抓取是否正常：

```bash
node scripts/wallet-check.mjs
```

## 登录态注意事项（重要）

- 登录态文件保存在 `src/wallet-states/`，内含 cookie，属敏感数据，已被 .gitignore 排除、**绝不上传 GitHub**
- **登录态会过期**：各平台有效期不同（几天到几周不等）。过期后巡检会抓取失败 / 读不到余额，重新跑一次 wallet-login.mjs 登录即可，属正常维护
- **登录态绑定环境**：换电脑、换 IP / 网络环境后可能失效，需要重新登录一次；同一台电脑上长期稳定
- 环境依赖：需要 Node.js ≥ 20 和 Playwright（含 Chrome）——`npm install` 会一并安装

## 手机推送配置

config.json 的 `notify` 字段：

```json
{
  "port": 3000,
  "host": "0.0.0.0",
  "monitor": { "intervalMs": 3600000, "defaultThreshold": 200 },
  "notify": { "serverchan": "你的Server酱SendKey", "bark": "你的Bark推送Key" }
}
```

- `serverchan`：微信推送（sct.ftqq.com 申请 SendKey）
- `bark`：iOS 推送（bark 推送 App 的设备 Key）
- 留空表示不推送，只保留页面横幅 + 桌面弹窗；填好后重启服务生效

## 余额查询方式

每个平台可配置 `balance_type`：

- **api**：官方接口，填 `balance_api_url` + `balance_json_path`（返回 JSON 中余额值的路径）
- **scrape**：浏览器抓取钱包页（见上「一次性登录」）；`balance_api_url` 填钱包页面网址，`balance_json_path` 填提取规则（纯关键字如 `可用额度`，或 `{"keyword":"可用额度","max":10000000}`）
- **manual**：手动录入，页面「录入余额」按钮

## 充值流程状态机

```
pending（待通知）→ notified（已通知）→ paid（已打款）→ credited（已到账）
```

- 阈值触发 → 自动生成 pending 单 → notified（推送/弹窗）
- 打款后在页面点「登记打款」→ paid
- 巡检检测到余额上涨 → 自动 credited 并计入资金统计；也可手动「确认到账」

## 启动脚本

- `启动项.bat`：菜单式启动/查看监控服务、打开汇总页
- `重新登录.bat`：单独重跑浏览器抓取型平台的登录流程

## API 概览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/platforms | 平台列表（含最新余额） |
| POST | /api/platforms | 添加平台 |
| PUT | /api/platforms/:id | 更新平台 |
| DELETE | /api/platforms/:id | 删除平台 |
| POST | /api/platforms/:id/refresh | 刷新余额 |
| POST | /api/platforms/:id/balance | 手动录入余额 |
| GET | /api/orders | 充值提醒列表 |
| POST | /api/orders/:id/notify | 发送通知 |
| POST | /api/orders/:id/paid | 登记打款 |
| POST | /api/orders/:id/unmark-paid | 撤销打款 |
| POST | /api/orders/:id/credit | 检测到账 |
| POST | /api/orders/:id/credit-force | 手动确认到账 |
| POST | /api/orders/:id/note | 修改用途备注 |
| GET | /api/fund | 资金统计 + 流水 |
| GET | /api/fund/monthly | 月度充值明细 ?month=YYYY-MM |
| POST | /api/monitor/run | 立即巡检 |

## 目录结构

```
src/
  server.js                入口（Fastify + 数据库初始化 + 启动监控）
  routes.js                API 路由
  db/index.js              数据库 schema（sql.js）
  services/
    balance.js             余额查询
    recharge.js            充值自动化 + 桌面弹窗 + 手机推送
    monitor.js             监控调度（并行巡检）
    scraper_wallets.mjs    浏览器抓取器（登录态复用）
    push.js                手机推送（Server酱 / Bark）
public/
  index.html               前端单页（平台面板 / 充值提醒 / 资金统计）
scripts/
  wallet-login.mjs         一次性登录（保存登录态）
  wallet-check.mjs         无头抓取验证
  setup-wallet-platforms.mjs  写入 6 个预设平台
src/wallet-states/         登录态文件（敏感，gitignore，不上传）
config.json                配置（端口、监控间隔、手机推送）
```

## 安全

- 平台密钥存在数据库（data/llm-manager.db），列表接口返回掩码
- 登录态/cookie 在 src/wallet-states/ 与 src/chrome-user-data/，已被 .gitignore 排除、绝不上传
- 当前无鉴权：只在本机用可绑定 127.0.0.1；对外部署建议放内网 / 加反向代理认证
