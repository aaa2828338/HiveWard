# Manager 自分发烟测蓝图 Proposal

## Proposal text

建议新增蓝图 `manager-self-dispatch-smoke-blueprint`，名称为“Manager 自分发烟测：需求-HTML-QA”。

目标是验证 Manager 在 `self_dispatch` 模式下是否会根据真实 Agent 回执逐步派发任务，而不是只根据 `delegationRoster` 槽位菜单宣布完成。

## Scope

- 1 个 Manager 节点：`self-dispatch-manager`
- 3 个子 Agent 槽位：
  - Slot 1：需求分析 Agent，只输出报告，不生成文件。
  - Slot 2：页面制作 Agent，生成一个 HTML artifact，并在报告的 Delivery location / 交付位置里声明。
  - Slot 3：QA 验收 Agent，读取需求报告和 HTML artifact，输出验收报告，不生成文件。

## Manager dispatch contract

Manager runtime 使用 `codex`，因为这次测试是在 Codex harness 下运行；`self_dispatch` Manager 需要真实决策模型，不能落到默认 OpenClaw 占位返回。

Manager 必须遵守以下顺序：

1. 没有需求分析真实回执时，派发 Slot 1。
2. 看到需求分析报告后，派发 Slot 2。
3. 看到 HTML artifact 链接或 artifact 条目后，派发 Slot 3。
4. 只有 QA 明确通过，并说明检查了哪个 HTML 产物后，才允许 complete。

每次 Manager 决策都必须只返回 JSON，并写 `reason`。`reason` 必须说明它看到了哪个真实回执或产物链接，以及为什么派给下一个槽位或完成。

## Preview

蓝图运行时应呈现为：

```text
Manager reason -> Slot 1 需求分析报告
Manager reason -> Slot 2 HTML artifact
Manager reason -> Slot 3 QA 验收报告
Manager reason -> complete
```

测试输入示例：

```text
请做一个用于展示自分发测试结果的简单网页。
```

页面制作 Agent 生成的 HTML 应包含：

- 标题：自分发测试页面
- 一段说明文字
- 一个彩色状态卡片

## Delivery location / 交付位置

- Portable blueprint package: `docs/blueprint-proposals/manager-self-dispatch-smoke-blueprint.package.json`
- Proposal document: `docs/blueprint-proposals/manager-self-dispatch-smoke-blueprint.proposal.md`

## Diff summary

- 新增一个可导入 portable blueprint package JSON。
- 新增一个审批说明 proposal 文档。
- 未修改 `data/blueprints`。
- 未导入 HiveWard backend。
- 未创建 HiveWard inbox item。

## Validation

- 已用 `readPortableBlueprintPackage` 校验 `manager-self-dispatch-smoke-blueprint.package.json` 可被当前 shared schema 读取。
- 校验结果：1 个 `self_dispatch` Manager、3 个 `manager_slot`、3 个子 Agent、12 条边。

## Governance note

这只是蓝图草案包。它尚未被审批、尚未导入，也尚未成为公司正式蓝图。正式变更仍需要 HiveWard inbox approval 和 backend import 成功后才算生效。
