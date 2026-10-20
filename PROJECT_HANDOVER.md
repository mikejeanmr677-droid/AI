# 大模型 API 统一管理平台 — 项目交接文档

## 一、项目简介

这是一个大模型 API 余额监控与自动充值管理平台。**不转发业务请求**，只负责：

- 统一管理各大模型平台的面板信息（余额查询配置、阈值、充值金额）
- 定时查询各平台余额，低于阈值时自动生成充值提醒
- 页面红色预警横幅 + 桌面弹窗 + 手机推送（Server酱/Bark）提醒充值
- 登记打款 → 系统跟踪到账 → 自动计入资金统计

适用场景：公司同时使用多个大模型平台（OpenAI、DeepSeek、火山引擎、月之暗面、智谱、MiniMax、阿里云百炼、腾讯云混元等），需要统一监控余额和自动化充值流程。

---

## 二、技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 运行时 | Node.js ≥ 20 | ES Module（`"type": "module"`） |
| Web 框架 | Fastify 5 | 启动快、内置 JSON 序列化 |
| 数据库 | sql.js（SQLite WASM） | 纯 JS 实现，无需原生编译，数据库文件在 `data/llm-manager.db` |
| 浏览器抓取 | Playwright | 登录态（storageState）复用，无头抓取钱包页余额 |
| 前端 | 原生 HTML/JS/CSS | 单文件 `public/index.html`，零构建零依赖 |

依赖只有 4 个包：`fastify`、`@fastify/static`、`sql.js`、`nodemailer`。

---

## 三、快速启动

```bash
# 1. 安装依赖
npm install

# 2. 启动服务
npm start

# 开发模式（文件改动自动重启）
npm run dev
```

启动后访问 **http://localhost:3000**，数据库会在首次启动时自动创建。

给别人部署时的完整顺序：npm install → npm start → 添加平台（页面添加或 `node scripts/setup-wallet-platforms.mjs`）→ 浏览器抓取型平台跑一次 `node scripts/wallet-login.mjs` 登录生成登录态 → 正常使用（登录态注意事项见第五节）。

---

## 四、配置说明

### config.json

```json
{
  "port": 3000,
  "host": "0.0.0.0",
  "monitor": {
    "intervalMs": 3600000,
    "defaultThreshold": 200
  },
  "notify": {
    "serverchan": "",
    "bark": ""
  }
}
```

| 字段 | 说明 |
|---|---|
| `port` | 服务端口，默认 3000 |
| `host` | 监听地址，`0.0.0.0` 允许外部访问 |
| `monitor.intervalMs` | 余额巡检间隔（毫秒），默认 3600000（1 小时） |
| `monitor.defaultThreshold` | 默认低余额阈值，默认 200 |
| `notify.serverchan` | Server酱 SendKey（微信推送），留空不推 |
| `notify.bark` | Bark 推送 Key（iOS），留空不推 |

未配置推送时：低余额仍会在页面显示红色预警横幅 + 桌面弹窗，手机推送跳过。

---

## 五、已支持的余额查询方式

### 内置专用查询器（provider 匹配）

| 平台 | provider 值 | 需要的凭证 | 凭证存储位置 | 查询方式 |
|---|---|---|---|---|
| OpenAI | `openai` | Admin Key | `api_key` | `/v1/organization/costs` 算本月消耗，余额 = 预付额 - 消耗 |
| DeepSeek | `generic` | API Key | `api_key` | 通用 GET + JSON path |
| 月之暗面 (Kimi) | `moonshot` | API Key | `api_key` | `GET /v1/users/me/balance` |
| MiniMax | `generic` | API Key | `api_key` | 通用 GET + JSON path |
| 火山引擎 (豆包) | `volcengine` | AK + SK | `api_key`(AK) + `api_key_secret`(SK) | HMAC-SHA256 签名调费用中心 `QueryBalanceAcct` |
| 阿里云百炼 | `dashscope` | AccessKey ID + Secret | `api_key`(ID) + `api_key_secret`(Secret) | BssOpenAPI `QueryAccountBalance`，HMAC-SHA1 签名 |
| 腾讯云(混元) | `tencent` | SecretId + SecretKey | `api_key`(Id) + `api_key_secret`(Key) | TC3-HMAC-SHA256 签名调 `DescribeAccountBalance`，分→元 |
| 智谱 AI | `zhipu` | 模型 API Key + 控制台 Token(JWT) | `api_key`(模型Key) + `api_key_secret`(JWT) | 控制台内部接口，**非官方 API，Token 会过期** |

### 通用查询器（generic）

对于有标准 HTTP 余额接口的平台，填两个字段即可：
- **balance_api_url**：余额查询接口地址
- **balance_json_path**：返回 JSON 中余额值的路径（如 `data.balance`、`result.available`）

### 浏览器抓取（scrape）

没有官方余额 API 或需登录控制台才能看余额的平台（腾讯云TokenHub、小米MiMo、Kimi、阿里云百炼、MiniMax、火山引擎）：
- `balance_type=scrape`，`balance_api_url` 填钱包页面地址，`balance_json_path` 填提取规则（纯关键字如 `可用额度`，或 JSON `{"keyword":"可用额度","max":10000000}`）
- 实现：`src/services/scraper_wallets.mjs`，用 playwright 加载登录态打开钱包页，在页面文本中按「关键字 + 正则」提取余额
- 登录态：首次运行 `node scripts/wallet-login.mjs` 在浏览器中手动登录一次（保存到 `src/wallet-states/storage_<平台>.json`），之后定时巡检无头自动抓取
- 验证：`node scripts/wallet-check.mjs` 无头抓取全部 scrape 平台并打印结果
- 初始化：`node scripts/setup-wallet-platforms.mjs` 把 6 个平台写入数据库（可重复执行）

### 登录态注意事项（给他人部署必读）

- **登录态会过期**：各平台有效期不同（几天到几周不等）。过期后巡检会抓取失败 / 读不到余额，重新跑一次 `node scripts/wallet-login.mjs`（或双击 重新登录.bat）登录即可，属正常维护
- **登录态绑定环境**：换电脑、换 IP / 网络环境后可能失效，需要重新登录一次；同一台电脑上长期稳定
- 登录态文件含 cookie，保存在 `src/wallet-states/`，已被 .gitignore 排除、**绝不上传 Git**
- 别人 clone 项目后没有 node_modules 和数据库：先 `npm install`，再 `npm start`（数据库自动创建），再按本节流程配置平台 + 登录一次

### 手动录入（manual）

没有 API 的平台，设 `balance_type=manual`，在页面点「录入余额」手动填入。

---

## 六、各平台添加方式

### 快速添加

页面顶部「⚡快速添加」区域列出了预设平台，点击后只需填写凭证（API Key / Secret），常量字段（查询 URL、JSON path、币种、阈值）已预填，可修改。

### 手动添加

点「+ 添加平台」填全表单。

### OpenAI 特殊说明

- 需要使用 **Admin Key**（`sk-admin-...`），普通 API Key 无法查余额
- `balance_json_path` 字段填一个数字作为**预付总额**（默认 100，单位 USD）
- 系统调 `/v1/organization/costs` 查本月消耗，余额 = 预付总额 - 本月消耗
- **需要出境代理**：启动时设置环境变量 `NODE_USE_ENV_PROXY=1` 和 `HTTPS_PROXY=http://代理地址:端口`

### 智谱 AI 特殊说明

- 智谱没有官方余额 API，用的是控制台内部接口
- `api_key_secret` 存的是控制台登录 JWT Token（不是模型 API Key）
- Token 会过期，过期后需重新登录 `open.bigmodel.cn`，从浏览器 DevTools 的 Authorization 头复制新 Token
- 可运行 `node scripts/zhipu-token-refresh.mjs --token "新token"` 更新

---

## 七、充值流程

### 状态机

```
pending（待通知）→ notified（已通知）→ paid（已打款）→ credited（已到账）
```

### 自动化流程

1. **巡检触发**：定时器每 `intervalMs` 毫秒跑一次巡检
2. **余额查询**：对所有 `active=1` 的平台逐一查余额
3. **阈值判断**：余额 < 阈值 → 生成 `pending` 充值单
4. **提醒通知**：自动推送（页面横幅 / 桌面弹窗 / 手机推送，按配置）→ 状态变 `notified`
5. **财务打款**：财务去网银打款，在页面点「登记打款」→ `paid`
6. **到账跟踪**：下次巡检时检测余额是否上涨，上涨则自动 `credited` + 计入资金统计
7. **手动确认**：也可在页面点「确认到账」直接跳过自动检测

### 充值金额规则

- 默认固定金额充值（`recharge_amount`，默认 500）
- 若配置了 `target_amount`（补足目标），则充 `目标 - 当前余额` 的差额
- 幂等：同一平台有未完成单子时不重复生成

### 资金统计（原资金池，已改为纯记账）

- 每笔充值确认到账后自动计入「累计充值总额」
- 资金统计页：累计充值总额 + 月度充值明细（按平台汇总、扇形占比图、CSV 导出），用于评估各平台月消耗、规划下月充值
- 所有到账有流水记录（`fund_transactions` 表，type=recharge_deduct）

---

## 八、API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/platforms` | 平台列表（密钥掩码，附最新余额） |
| GET | `/api/platforms/:id` | 单个平台详情（含真实密钥） |
| POST | `/api/platforms` | 添加平台 |
| PUT | `/api/platforms/:id` | 更新平台 |
| DELETE | `/api/platforms/:id` | 删除平台 |
| POST | `/api/platforms/:id/refresh` | 刷新单个平台余额 |
| POST | `/api/platforms/:id/balance` | 手动录入余额 `{balance: 数值}` |
| GET | `/api/platforms/:id/history` | 余额历史 `?limit=50` |
| GET | `/api/orders` | 充值提醒列表 |
| POST | `/api/orders/:id/notify` | 发送充值通知（推送/弹窗） |
| POST | `/api/orders/:id/paid` | 登记打款 |
| POST | `/api/orders/:id/unmark-paid` | 撤销打款（改回已通知） |
| POST | `/api/orders/:id/credit` | 检测到账（自动） |
| POST | `/api/orders/:id/credit-force` | 手动确认到账 |
| POST | `/api/orders/:id/note` | 修改用途备注 |
| GET | `/api/fund` | 资金统计 + 流水 |
| GET | `/api/fund/monthly?month=YYYY-MM` | 月度充值明细（各平台到账汇总） |
| POST | `/api/monitor/run` | 立即执行一次巡检 |

---

## 九、目录结构

```
xkzoom-apiManager/
├── src/
│   ├── server.js              # 入口：启动 Fastify、初始化数据库、启动监控
│   ├── routes.js              # API 路由（平台 CRUD、充值提醒、资金统计、巡检）
│   ├── db/
│   │   └── index.js           # 数据库模块（sql.js 封装，兼容 better-sqlite3 接口）
│   └── services/
│       ├── balance.js         # 余额查询（8 个内置 provider + generic + manual）
│       ├── recharge.js        # 充值自动化（生成单 → 通知 → 打款 → 到账 → 记账）
│       ├── monitor.js         # 监控调度器（定时巡检循环，平台并行抓取）
│       ├── mailer.js          # 邮件模块（遗留，未配置 SMTP 时跳过）
│       └── push.js            # 手机推送（Server酱 / Bark）
├── public/
│   └── index.html             # 前端单页（平台面板、充值提醒、资金统计三个标签页）
├── scripts/                   # 工具脚本（脱敏、各平台余额查询测试）
│   ├── sanitize-db.mjs        # 数据库脱敏脚本（交付前跑）
│   ├── tencent-check.mjs      # 腾讯云余额查询测试
│   ├── zhipu-check.mjs       # 智谱余额查询测试
│   ├── zhipu-token-refresh.mjs # 智谱 Token 更新
│   └── ...
├── config.json                # 配置文件（端口、监控间隔、手机推送）
├── package.json               # 依赖与脚本
└── .gitignore                 # Git 忽略规则
```

### 数据库表结构

```
platforms          平台面板（name, provider, api_key, api_key_secret, balance_type, 
                   balance_api_url, balance_json_path, currency, threshold, 
                   recharge_amount, target_amount, active）

balance_history     余额历史（platform_id, balance, currency, checked_at）

recharge_orders     充值单（platform_id, amount, currency, reason, status, 
                   notified_at, paid_at, credited_at）

fund_pool           资金统计（累计充值，balance 单行；充值提醒到账时累加）

fund_transactions   资金流水（type, amount, balance_after, ref_id, note, created_at）

settings            键值设置（预留）
```

---

## 十、安全注意事项

1. **密钥存储在数据库中**（`data/llm-manager.db`），API 列表接口返回掩码 `••••••••`
2. **`.gitignore` 已配置**忽略数据库、config 目录、.env 文件
3. **交付前脱敏**：运行 `node scripts/sanitize-db.mjs` 清空所有密钥
4. **无身份认证**：当前版本没有登录/鉴权，部署时需：
   - 绑定 `127.0.0.1` 仅本机访问，或
   - 放在内网/VPN 后面，或
   - 加 Nginx 反向代理 + Basic Auth
5. **建议密钥轮换**：如果密钥曾经泄露过（聊天记录、旧提交），在各平台后台重新生成新密钥

---

## 十一、常见问题

**Q: 启动报错 `Cannot find module`？**
A: 先跑 `npm install` 安装依赖。

**Q: 数据库在哪？**
A: `data/llm-manager.db`，首次启动自动创建。删掉后重启会重新建空库（平台配置、充值记录会丢）。

**Q: OpenAI 余额显示 0？**
A: OpenAI 用「预付额 - 本月消耗」算余额。`balance_json_path` 字段填预付总额（美元）。确认 Admin Key 有效且配了出境代理。

**Q: 智谱 Token 过期怎么办？**
A: 登录 open.bigmodel.cn → F12 打开 DevTools → Network → 随便点一个请求 → 复制 Authorization 头里的 Bearer 后面那串 → 编辑智谱平台，粘贴到 Secret Key 字段。或运行 `node scripts/zhipu-token-refresh.mjs --token "新token"`。

**Q: 火山引擎 / 阿里云 / 腾讯云查余额报错？**
A: 确认 AK/SK 有费用中心（Billing）的读权限，不是模型调用权限。

**Q: 手机没收到提醒？**
A: 检查 config.json 的 `notify` 字段：`serverchan`（Server酱微信推送）和 `bark`（iOS）需填对应的 Key 并重启服务。未配置时低余额仍会在页面显示红色预警横幅 + 桌面弹窗。

**Q: 如何修改巡检间隔？**
A: 改 config.json 的 `monitor.intervalMs`，重启生效。

---

## 十二、后续可扩展方向

- 加用户登录鉴权（JWT / Session）
- 余额趋势图表（已有月度扇形图，可加折线趋势）
- 钉钉/飞书/企业微信通知（当前已有 Server酱/Bark 手机推送）
- 对公汇款回单 OCR 自动识别到账
- 多用户 + 权限角色
