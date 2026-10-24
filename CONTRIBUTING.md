# 贡献报价与代码

来源可靠与报价完整是两回事。官方商品列表可能不提供周期，官方定价配置可能对账号有生效条件；提交时必须保留这些边界。

## 自动官方数据

- iOS：固定 ChatGPT App ID 的各地区 App Store 页面。保留原始商品名、原价文字、币种证据、采集时间与来源指纹。金额必须能从原价文字重新解析得到，不推断月付/年付。
- 网页：`https://chatgpt.com/backend-anon/checkout_pricing_config/configs/{COUNTRY}` 的官方 JSON。只取对应套餐 `month` 分支，逐套餐读取税费，保留 `pricing_rollout_gate`。原始 JSON 保存在 `prices.json.documents` 中，并通过标准化 JSON 的 SHA-256 复核。
- Android：Google Play 主应用的全部内购范围。范围两端不对应具体套餐，不进入 Plus/Pro 月费排名。

网页接口没有公开的稳定 API 合约。自动采集环境可能返回 403；此时记录访问失败并保留原观测时间。不得为了让数据看起来更新而修改时间、复制别的渠道价格或采用未确认的接口。

## 提交安卓账号实测报价

在对应地区 Google Play 账号登录的真实安卓设备或模拟器中，打开官方 ChatGPT 的套餐/订阅确认页面，记录：

1. Google Play 商店账号地区、设备类型、ChatGPT 应用版本。
2. 完整套餐档位、当地币种与金额、续订周期。
3. 税费是否已包含；是否是标准续费价、首次优惠或旧用户价格。
4. 观测时间与可复核的来源截图/页面文字。

读取确认页的价格即可，不需要完成付款。请先去除账号邮箱、姓名、卡号、订单号及账单地址等个人信息；不要提交 Cookie、访问令牌或密码。

不同地区账号实测是可行来源，但不能仅凭语言、IP或一张孤立金额截图认定地区和续订周期。当前项目没有可供实测的设备或地区账号，因此安卓单品月费保持待核验。

## 候选报价导入

通过 Issue/PR 提交资料，经维护者整理后可执行：

```bash
npm run import:quotes -- candidate-quotes.json
```

输入为 `{ "quotes": [记录] }`。每条需包含 `id`、`origin: "reviewed_submission"`、`region`、`channel`、`planId`、`sourceName`、`amount`、`currency`、`displayPrice`、HTTPS `sourceUrl`、`sourceSha256`、`observedAt`、`reviewedAt` 与周期说明 `periodEvidence`。

**候选导入只能使用 `verification: "observed"`。** 手工填写 `verified`、任意 HTTPS 链接或一段摘要，不能建立已验证身份。候选报价不进入官方默认列表与排名。完整验证流程建立前，真实账号实测结果也会保留其来源类型和审核状态。

`verification: "official_config"` 仅由官方配置解析器产生，必须与保留的官方国家 JSON、套餐路径、金额、币种、周期、税费和摘要全部一致。不能手工挪用此标记。

## 检查

```bash
npm test
npm run validate
npm run audit
npm run build
```

新增地区时不要按本地法币猜测商店币种。变更解析器时须覆盖数字缩写、分组符号、不同套餐税费、月度与年度折算的隔离，以及源文档与数值不一致的情况。
