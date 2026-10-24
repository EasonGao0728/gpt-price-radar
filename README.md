# GPT Price Radar

一个可追溯的 ChatGPT 地区价格看板。查看当地公开列价，折合人民币 / 美元，筛选套餐并比较低价地区。

**当前阶段：v0.1，真实公开列价采集 + 每日参考汇率 + 可运行的看板。不是已完成全球月费核验的数据集。**

## 已实现

- iOS App Store 多地区采集，分别保留同名商品的所有列价。
- Plus、Pro 100、Pro 200、Pro 500 单独筛选。
- CNY / USD 换算、最低列价 Top 5、地区搜索、同档位美国列价基准比较。
- 公开列价参考 / 已核验月费两种比较口径，税费分别比较。
- 来源链接、HTML SHA-256 指纹、独立的价格时间和汇率日期。
- 详情、原始 JSON、CSV 导出、URL 参数保存筛选。
- 采集失败保留旧价，过期数据退出当前排名。
- Node 原生测试、CI、每日数据更新工作流、可选 GitHub Pages 发布工作流。
- 响应式中文界面、键盘访问和无追踪脚本。

## 必须了解的数据边界

公开 App Store 内购列表通常只有商品名和金额。同一个 `ChatGPT Plus` 名称可能出现两个价格；列表不提供可确认月付 / 年付的证据，也未说明税费或适用资格。

因此自动采集的记录一律写入 `period: "unknown"`、`taxStatus: "unknown"`、`verification: "observed"`。**不按较低价格猜测月费，不把较高价格猜成年费。**

默认的“公开列价参考”每地区取所选套餐的最低公开列价，只能说明列价的货币换算大小。“已核验月费”仅纳入有证据的标准月度报价；初始数据尚无这样的报价，该榜会如实为空。

网页和 Android 暂未接入。公开页面无法访问不代表该地区无法订阅。排名也不代表任意账户都可按对应价格购买。

汇率来源 [Frankfurter](https://frankfurter.dev/)，使用央行数据聚合的每日参考汇率，保留各币种的日期和供应方。不提供分钟级行情，不含银行卡点差 / 手续费。EUR/GBP 等币种与 TWD 等币种的来源可能不同。最终支付以结账页面为准。

## 本地运行

要求 Node.js 22 或更高版本，无第三方运行依赖，不需要 OpenAI API Key。

```bash
npm test
npm run dev
```

打开 `http://127.0.0.1:4173`。`dev` 启动时会构建静态文件；修改源文件后重新运行。

```bash
npm run update                       # 全部地区 + 汇率
npm run update -- --markets=us,jp,in  # 只更新指定地区 + 汇率
npm run update -- --fx-only          # 只更新汇率
npm run update -- --prices-only      # 只更新价格
npm run validate
npm run build                       # 生成 dist/，可部署在任意静态托管服务
```

采集串行进行并限速，每个请求设有超时。404 记录为 `unavailable`，其他请求 / 解析失败返回非零退出码并保留旧数据。失败地区不会自动获得新的观测时间。过期规则：价格超过 7 天或所需汇率超过 5 天后不进入当前排名。

## 开源与部署

源码使用 MIT 许可证。本地源码不包含任何账户凭据；`.openai/hosting.json` 仅绑定当前私有预览站点。

上传到自己的 GitHub 仓库前，若不使用当前 Sites 站点，删除 `.openai/hosting.json` 中的站点绑定文件，或移除整个 `.openai` 目录。不要复用他人的 project ID。

GitHub Actions：

- `ci.yml`：提交与 PR 时执行测试、数据校验、静态构建。
- `update-data.yml`：每日 UTC 00:17（北京时间 08:17）与手动执行，提交最新数据。工作流首次上传到 GitHub 并启用 Actions 后才运行。
- `pages.yml`：手动发布到 GitHub Pages。先在仓库 Settings → Pages 中选择 GitHub Actions，之后手动执行该工作流。`update-data.yml` 完成后会触发更新部署。

当前私有 Sites 预览使用本次构建的价格快照；页面“更新汇率”可取得最新可用汇率，但不会修改公开价格数据。要让长期运行的网站持续更新价格，请启用仓库中的每日采集与 Pages 工作流。尚未在用户 GitHub 账户上创建公开仓库或启用这些工作流。

## 数据模型

`data/prices.json` 中一条记录包含：

```json
{
  "id": "ios-us-plus-0",
  "region": "us",
  "channel": "ios",
  "planId": "plus",
  "sourceName": "ChatGPT Plus",
  "amount": 19.99,
  "currency": "USD",
  "displayPrice": "$19.99",
  "period": "unknown",
  "verification": "observed",
  "taxStatus": "unknown",
  "offerType": "unknown",
  "periodEvidence": null,
  "taxEvidence": null,
  "observedAt": "观测时刻的 ISO 8601 值",
  "sourceUrl": "https://apps.apple.com/us/app/chatgpt/id6448311069",
  "sourceSha256": "原始响应 HTML 的 SHA-256"
}
```

该示例说明字段结构，不用于覆盖真实数据。核验流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。不要修改 `observedAt` 来掩盖数据陈旧。

## 项目结构

```text
public/           页面、样式、交互
src/config.mjs    地区、币种、套餐和过期阈值
src/apple.mjs     公开 App Store 列表提取与地区数字格式解析
src/domain.mjs    核验规则、换算、排名、CSV、数据校验
data/             可追溯的价格与汇率快照
scripts/          采集、校验、构建、本地服务
test/             核心数据逻辑测试
.github/          CI、每日采集、Pages、报价贡献模板
```

## 后续工作

1. 为月度周期、税费和标准价格补充可复核证据，建立人工审核流程。
2. 验证网页和 Android 数据源，新增适配器与渠道隔离。
3. 价格变更历史可视化和可核验的条件筛选。
4. 如确有需要，添加明确注明频率的小时 / 分钟级汇率供应方。

## 许可证与来源

源码：[MIT](LICENSE)。第三方价格事实来自各地区公开 App Store 页面，汇率数据遵循 [Frankfurter 文档及供应方条款](https://frankfurter.dev/)。本项目与 OpenAI、Apple 无隶属关系。
