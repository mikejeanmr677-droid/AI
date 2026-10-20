# 大模型 API 统一管理平台

纯监控 + 充值管理的大模型平台面板系统。不转发业务请求，只负责：余额监控、低余额告警、自动生成充值单、邮件通知财务、到账跟踪、公司资金池账本。

## 功能

- **平台面板管理**：增删改查各大模型平台（API Key、余额查询配置、阈值、充值金额）
- **余额监控**：定时刷新各平台余额，记录历史；有 API 的走官方接口，无 API 的抓取或手动录入
- **自动充值**：余额低于阈值自动生成充值单 → 邮件通知财务 → 财务网银打款 → 标记已打款 → 系统跟踪到账 → 资金池扣减记账
- **资金池账本**：公司预存资金、充值扣减、流水记录

## 技术栈

- Node.js + Fastify（响应快）
- SQLite（better-sqlite3）
- 前端：原生 HTML/JS 单页（零构建）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 config.json（SMTP 邮件、端口、监控间隔）

# 3. 启动
npm start
# 或开发模式（自动重启）
npm run dev
```

启动后访问 http://localhost:3000

## 配置 config.json

```json
{
  "port": 3000,
  "host": "0.0.0.0",
  "email": {
    "host": "smtp.example.com",
    "port": 465,
    "secure": true,
    "user": "发件邮箱",
    "pass": "授权码",
    "from": "发件人",
    "to": "财务收件邮箱"
  },
  "monitor": {
    "intervalMs": 600000,
    "defaultThreshold": 200
  }
}
```

- `monitor.intervalMs`：余额巡检间隔（毫秒），默认 10 分钟
- 未配置 SMTP 时，充值单照常生成，邮件通知会跳过并打印警告

## 余额查询方式

每个平台可配置 `balance_type`：

- **api**：官方接口。OpenAI 内置支持（`provider=openai`），其它用 `generic` 填 `balance_api_url` + `balance_json_path`
- **manual**：手动录入，页面「录入余额」按钮
- **scrape**：浏览器抓取钱包页余额（`src/services/scraper_wallets.mjs`）。配 `balance_api_url` 为钱包页面地址，`balance_json_path` 为提取规则（纯关键字或 `{"keyword":"可用额度","max":10000000}`）；首次需运行 `node scripts/wallet-login.mjs` 登录一次保存登录态，之后定时巡检自动抓取

## 充值流程状态机

```
pending（待通知）→ notified（已通知）→ paid（已打款）→ credited（已到账）
```

- 阈值触发 → 自动生成 `pending` 单 + 发邮件 → `notified`
- 财务打款后在页面点「标记已打款」→ `paid`
- 系统巡检时检测到余额上涨 → 自动 `credited` 并扣减资金池；也可手动「确认到账」

## 充值金额规则

- 默认固定金额充值（`recharge_amount`，默认 500）
- 若配置了 `target_amount`（补足目标），则充「目标 - 当前余额」的差额

## API 概览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/platforms | 平台列表（含最新余额） |
| POST | /api/platforms | 添加平台 |
| PUT | /api/platforms/:id | 更新平台 |
| DELETE | /api/platforms/:id | 删除平台 |
| POST | /api/platforms/:id/refresh | 刷新余额 |
| POST | /api/platforms/:id/balance | 手动录入余额 |
| GET | /api/platforms/:id/history | 余额历史 |
| GET | /api/orders | 充值单列表 |
| POST | /api/orders/:id/notify | 发送通知 |
| POST | /api/orders/:id/paid | 标记已打款 |
| POST | /api/orders/:id/credit | 检测到账 |
| POST | /api/orders/:id/credit-force | 手动确认到账 |
| GET | /api/fund | 资金池 + 流水 |
| POST | /api/fund/deposit | 预存资金 |
| POST | /api/monitor/run | 立即巡检 |

## 目录结构

```
src/
  server.js        入口
  routes.js        API 路由
  db/index.js      数据库 schema
  services/
    balance.js     余额查询
    recharge.js    充值自动化
    mailer.js      邮件通知
    monitor.js     监控调度
public/
  index.html       前端页面
config.json        配置
```
