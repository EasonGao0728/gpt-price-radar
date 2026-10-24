# 贡献价格与代码

欢迎补充有证据的报价。单纯的截图金额、博客转述或按价格大小猜测周期，不能进入已核验月费榜。

## 提交报价

使用仓库的 Price observation Issue 模板，或提交 PR。请附上：

- 地区与商店渠道、完整套餐档位。
- 当地金额和币种，订阅周期，是否标准续费价。
- 明确的月度周期证据：公开可访问来源链接，或隐去个人信息的订阅确认页面截图。
- 明确的税费证据：含税 / 未含税及其适用地区口径。
- 核验时刻和必要的账户 / 付款条件。

请移除姓名、邮箱、账单地址、卡号、订单号、会话信息等个人资料。不要提交 Cookie、访问令牌或支付信息。

## 将公开列价提升为已核验月费

仅维护者审核后修改对应记录：

```json
{
  "period": "month",
  "verification": "verified",
  "taxStatus": "included",
  "offerType": "standard",
  "periodEvidence": {
    "url": "https://可访问的周期证据页面",
    "note": "明确显示本报价按月自动续订"
  },
  "taxEvidence": {
    "url": "https://可访问的税费证据页面",
    "note": "明确说明此地区和报价包含税费"
  },
  "reviewedAt": "审核时刻的 ISO 8601 值"
}
```

证据必须对应当前金额、币种、档位、地区和渠道。不要将其他地区、网页或不同周期的说明当成当前 iOS 报价的证据。保留原始 `sourceUrl`、`sourceSha256` 和 `observedAt`。如价格发生变化，采集器会移除此前的核验状态，等待再次审核。

首次优惠、试用、礼品卡折扣、年付折算和旧用户保留价均不属于标准月度价格。若记录它们，需要扩展数据模型和独立比较规则。

## 代码与验证

## 网页和安卓单品报价导入字段

将审核后的记录放在 `{ "quotes": [记录] }` 中，通过 `npm run import:quotes -- 文件路径` 导入。记录必须包含：

- `id`：唯一 ID，例如 `reviewed-web-in-plus-20261024`；`origin` 必须为 `reviewed_submission`。
- `region`：已配置的小写地区代码；`channel` 为 `web`、`android` 或 `ios`。
- `planId`、`sourceName`、`amount`、`currency`、`displayPrice`。
- `sourceUrl`（HTTPS 原始证据）、`sourceSha256`（原证据 SHA-256）、`observedAt`（真实观测 ISO 时间）。
- `reviewedAt` 与 `periodEvidence`（HTTPS 链接及明确的周期说明）。
- `period`、`verification`、`taxStatus`、`offerType`：不确定的字段仍为 `unknown` / `observed`。

只有税费、周期、标准续费价都已核验的记录，才能设为 `verification: "verified"` 并补充 `taxEvidence`。来源页面的金额必须对应具体地区与渠道。不要用 Google Play 全内购范围代替套餐报价，不要把 GLOBAL 美元价格分发到各地区。

自动采集保留 `data/quotes.json` 的审核报价，不会刷新其原观测时间。超过价格有效期后仍会退出当前排名，需要重新核验。

## 代码检查

Node 22+，无依赖安装步骤：

```bash
npm test
npm run validate
npm run build
```

新增地区时配置明确的 ISO 币种及价格格式，确认采集到的是目标地区的原始页面；为数字格式和失败情况增加必要测试。改变数据源结构时，应先保持未知字段，再补充证据，禁止静默推断。
