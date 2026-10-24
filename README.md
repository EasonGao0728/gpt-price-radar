# GPT Price Radar

[在线查看](https://easongao0728.github.io/gpt-price-radar/) · [每日更新运行记录](https://github.com/EasonGao0728/gpt-price-radar/actions/workflows/update-data.yml) · [提交报价证据](https://github.com/EasonGao0728/gpt-price-radar/issues/new/choose)

可追溯的 ChatGPT 地区价格看板。支持网页 / iOS / 安卓三渠道并列表、Plus / Pro 分档、人民币与美元换算、低价参考 Top 5、渠道与大洲筛选、地区搜索、分页、来源详情和 CSV 导出。MIT 许可，无第三方运行依赖，无需 OpenAI API Key。

## 数据覆盖与边界

配置 **109 个国家/地区**。配置数量不等于已有价格数量，实际覆盖数、采集错误和观测时间以看板及 JSON 数据为准。

| 渠道 | 当前自动采集内容 | 能否作为地区套餐月费 |
|---|---|---|
| iOS / App Store | 商品名称、格式化列价、同页商店币种及来源 | 按月费展示低位报价，保留同名其他价格和原始记录 |
| 网页版 | 官方地区月度定价配置：初始9地区、36条具体配置价，另保留GLOBAL基线 | 月度与税费字段明确；账号结账资格和生效条件仍需核验 |
| Android / Google Play | 主应用全部内购商品的价格范围 | 范围涵盖不同商品，不能当作 Plus / Pro 单品月费 |
| 候选账号实测报价 | 真实地区Google Play账号在安卓订阅确认页观察的具体报价 | 当前没有实测设备/账号；提交后先为候选，不凭自填审核字段进入官方榜 |

**不能自动取得的数据保持未知。不会把 iOS 价格复制给网页或安卓，不会把美元基线复制给所有国家，也不会将 Google Play 范围下限当成 Plus 价格。**

App Store 同一个套餐名可能有不同金额，全部保留。按本看板采用的月费展示口径，每地区选取该套餐低位报价。界面着重显示“官方来源”和采集时间；原始 `period` 字段仍按来源记录保存，展示口径不冒充周期的独立官方认证。网页月费必须绑定保留的官方配置JSON，含税与未含税分别比较。三渠道并列表会明确保留各自的证据边界。

币种来自原始商品 ISO 或同页 `SoftwareApplication.offers.priceCurrency` 并检查价格符号。后者属于页面商店币种线索，用于内购时会标注推定范围。某些国家的商店使用 USD 等外币，不能按国家法币猜测。缺失/冲突币种不换算。

## 来源校验与可复核证据

网页配置的精确来源是 OpenAI 自有域名：

- [印度官方配置](https://chatgpt.com/backend-anon/checkout_pricing_config/configs/IN)
- [加拿大官方配置](https://chatgpt.com/backend-anon/checkout_pricing_config/configs/CA)

套餐映射为 `plus / prolite / pro / promax`，对应 Plus / Pro 100 / Pro 200 / Pro 500，仅读取 `month.amount` 与本套餐的 `month.tax`。不将年度折算字段或 `psp_override` 税前金额替换为月度展示价。保留币种、税率和定价生效条件，所有配置价均注明账号结账资格未核验。

`data/prices.json.documents` 保存取得的官方 JSON；`data/audit.json` 公开来源白名单、金额重算、源JSON字段绑定和摘要校验结果。通过网页检索工具读取的响应使用 `canonical_json` 指纹，明确不伪称网络原始字节哈希。哈希证明保存内容的一致性，不是发布方的数字签名。

校验拒绝数值与原价文字不一致、地区不匹配、月度配置与源JSON不一致、自填 `verified`、以及把安卓范围当作单品的记录。安卓范围汇率过期时停止换算并提示状态。

## 每日自动更新

- `Update price data`：每日 **北京时间 08:17 / UTC 00:17**，也可在 Actions 中手动运行。GitHub 调度可能排队。
- 自动采集 iOS 列价、Android 范围、网页基线与每日汇率，并尝试刷新官方地区配置；来源审计后提交 `data/`。
- 已验证：GitHub运行环境访问地区配置接口会返回403。因此目前网页9地区配置来自已实际读取的官方JSON快照，不能宣称它们已由GitHub每日刷新。访问受阻时保留原时间与配置，记录错误/访问阻断状态，过期后退出排名。
- 个别来源失败时保留旧数据和原观测时间，详细错误进入 Actions summary；整条渠道失败或汇率获取失败会报告任务失败。
- 数据更新任务结束后，`Publish dashboard` 构建并更新 GitHub Pages；源码推送到 main 也会触发发布。
- 私有 Sites 预览会读取同一 GitHub 数据源；访问数据源失败时退回构建快照，并显示来源状态。GitHub Pages 使用每日构建的同源快照。
- 价格超过 7 天、所需汇率超过 5 天后退出当前排名，仍保留原始观测供查看。

汇率来自 [Frankfurter](https://frankfurter.dev/) 的央行数据聚合，每日更新，保留各币种日期与供应方。不是分钟级行情，不含银行卡点差/手续费；实际支付以结账页面为准。

## 本地运行

Node.js 22+，无需安装运行依赖：

```bash
npm test
npm run dev
```

打开 `http://127.0.0.1:4173`。修改源文件后重新运行 `dev`。

```bash
npm run update                              # 全渠道、全部109地区与汇率
npm run update -- --channels=ios --markets=us,jp,in
npm run update -- --channels=android --markets=us,in,tr
npm run update -- --channels=web --prices-only
npm run update -- --fx-only
npm run update -- --allow-partial             # 允许少量来源失败；整体失败仍返回非零
npm run validate
npm run build                                # dist/ 可部署到任意静态托管
```

每个来源使用有限并发和请求间隔；网络错误有限重试，403/404/429 不尝试绕过，限流会触发等待或延后采集。109 地区的完整采集可能需要数分钟。

## 导入有证据的网页/安卓套餐报价

先通过 Issue/PR 提交原始证据，维护者审核后执行：

```bash
npm run import:quotes -- reviewed-quotes.json
npm run update -- --channels=web --prices-only
npm test
npm run build
```

输入为 `{ "quotes": [ ... ] }`，仅接受 `verification: "observed"` 的候选报价，不进入默认官方列表或排名。每条需要 `origin: "reviewed_submission"`、地区、渠道、套餐、真实金额/币种、原始来源 HTTPS URL、来源 SHA-256、观测与审核时间、周期证据。完整字段及核验要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。导入不能凭空生成价格，也不会凭手工填报升级成已验证价格。

## 数据与实现

```text
data/prices.json       具体商品报价、Android范围、各地区/渠道采集状态
data/fx.json           每日汇率快照
data/quotes.json       人工审核并导入的报价
src/config.mjs         地区目录、渠道、套餐、过期阈值与数据源地址
src/currency.mjs       页面币种、数字格式与符号校验
src/apple.mjs          App Store 名称/价格对提取
src/android.mjs        Google Play 主应用内购范围提取
src/web.mjs            官方地区月度配置、源JSON证据及GLOBAL基线提取
public/compare.mjs     三渠道并列表
scripts/audit.mjs      来源、金额、配置原文和摘要一致性审计
src/domain.mjs         换算、筛选、排名、CSV与数据校验
scripts/collect.mjs    限速采集、失败保留和数据合并
scripts/import-quotes.mjs  审核报价导入
public/               响应式中文看板
test/                 核心数据逻辑测试
.github/workflows/    CI、每日采集、Pages发布
```

`schemaVersion: 3` 额外保留官方网页源文档 `documents`，并将 `observations`（具体商品/基线）与 `ranges`（全部内购范围）分开。每项保留 `sourceUrl`、`sourceSha256`、`observedAt`。`markets[]` 区分成功、缺少公开数据、等待结账核验、页面不可用和采集失败。来源指纹用于追踪本次响应，不意味着公开页面能证明订阅周期。

## Fork 与部署

1. Fork 后在仓库 Settings → Actions 启用工作流，在 Settings → Pages 选择 GitHub Actions。
2. 修改 `src/config.mjs` 中的 `REPOSITORY` 与 `LIVE_DATA_ORIGIN` 为自己的仓库。
3. 手动执行 `Update price data`，并查看 summary。无需设置支付/API密钥。
4. 保持 `.openai`、`.git`、本地依赖及账户凭据不进入公开发布包。Sites 的站点身份只保存在私有预览工作目录，不随本公开仓库分发。

## 来源与许可

源码 [MIT](LICENSE)。价格事实来自各地区公开 App Store / Google Play 页面；网页基线来自 [官方定价说明](https://learn.chatgpt.com/docs/pricing)。[官方多币种帮助](https://help.openai.com/en/articles/10421635-multicurrency-billing)列出支持币种，但不提供各地区金额。汇率依 Frankfurter 及供应方条款使用。本项目与 OpenAI、Apple、Google 无隶属关系。
