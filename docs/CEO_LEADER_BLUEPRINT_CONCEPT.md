# CEO / Leader 与蓝图审批概念稿

Status: Draft for approval
Last updated: 2026-05-23
Scope: Hiveward company workspace, CEO / Leader role layer, architecture blueprint, business blueprint, chat-to-inbox approval loop

## 目标

Hiveward 在公司 workspace 上提供 agent command layer。底层执行仍由 OpenClaw、Codex、Claude Code 等原生 harness 负责；Hiveward 只负责把这些 harness 放进公司角色、蓝图、审批、运行记录和收件箱流程中。

用户默认和 CEO 对话。需要落到某个业务蓝图时，CEO 发起 Leader 委派请求；Leader 在自己绑定的业务蓝图范围内生成可导入内容包，并提交到收件箱等待最终审批。

## 核心边界

- Hiveward 不重新实现 agent runtime。
- CEO / Leader 是对话启动配置，不是 Hiveward 自研 agent。
- Agent 生成 proposal、blueprint JSON、patch、preview、diff summary。
- Hiveward 后端只负责 schema 校验、权限校验、审批状态校验、导入和审计记录。
- 聊天确认只是方向确认；收件箱审批才是最终生效确认。
- Workspace 保存 Hiveward 平台数据，不保存 harness secrets、私有配置或外部 agent 内部记忆。

## Workspace Scope

每个公司有固定本地 workspace，并保留 manifest：

```json
{
  "companyId": "acme",
  "companyName": "Acme",
  "workspaceRoot": "D:/HiveWard/workspaces/acme",
  "openclawProfile": "default"
}
```

请求级 scope 必须明确 company、blueprint、leader 和 role：

```json
{
  "companyId": "acme",
  "blueprintId": "video-production",
  "leaderId": "video-leader",
  "role": "leader"
}
```

## 蓝图板块

Blueprint 模块分为两个语义不同的板块：

- 架构蓝图：展示 CEO -> Leader 的公司管理结构，不是业务执行 DAG。
- 业务蓝图：展示真实业务流程，由 worker agent 节点执行；Leader 可以作为管理覆盖层显示，但不进入业务 DAG。

第一版建议一个公司一个 CEO，一个业务蓝图绑定一个 Leader，一个 Leader 只管理一个业务蓝图。

## CEO

CEO 是公司级管理入口，可以读取公司 workspace 下的全局摘要、蓝图状态、Leader 报告、审批和运行记录。

CEO 可以讨论方案、判断需求归属、生成 Leader 委派请求，并将委派请求提交到收件箱。CEO 不直接写业务蓝图 JSON / patch，不直接修改正式蓝图数据，也不替代业务节点执行工作。

## Leader

Leader 是单个业务蓝图的负责人，只能读取自己绑定的业务蓝图 workspace。

Leader 可以和用户或 CEO 讨论方案，生成可导入蓝图内容包、蓝图 patch、运行请求、preview 和 diff summary，并提交到收件箱等待审批。Leader 不直接绕过审批写正式 store，也不承担业务 DAG 中普通 worker agent 的任务。

## 审批和导入

标准流程：

```text
聊天确认方向
  -> Agent 生成可导入内容包
  -> 提交 Hiveward 收件箱
  -> 用户在收件箱审批具体内容包
  -> 后端校验 schema / scope / 权限 / 审批状态
  -> 后端导入正式蓝图并生成审计记录
```

收件箱可以承载 CEO 委派、蓝图新建草案、蓝图修改包、运行请求、配置修改请求、异常处理建议、Leader 汇报和 CEO 汇总。

## Manager / Slot 业务蓝图说明

Manager 和 Slot 是业务蓝图中的特殊控制结构，不是普通线性链路。

- Manager 通过编号端口把工作分派到 Slot。
- Slot 是容器，可以包含子节点，也可以作为规划占位。
- 完整可运行的业务蓝图通常应该在每个具体阶段 Slot 内放置 agent 或 parallel_agents 子节点。
- 子节点通过 `parentId` 归属到 Slot。
- 外部连线使用 `manager-out-N -> manager-slot-in` 和 `manager-slot-out -> manager-in-N`。
- Slot 内部连线使用 `manager-slot-inner-out` 和 `manager-slot-inner-in`。

## 第一版范围

- 一个公司一个固定 workspace。
- 一个公司一个 CEO。
- 蓝图模块提供架构蓝图 / 业务蓝图切换。
- 架构蓝图只展示 CEO -> Leader。
- 一个业务蓝图绑定一个 Leader。
- CEO 召集 Leader 需要进入收件箱确认。
- Leader 生成可导入内容包。
- 用户在收件箱最终确认。
- Hiveward 后端校验并导入正式蓝图。

第一版暂不做多 CEO、一个 Leader 管多个蓝图、跨业务蓝图读取、CEO 直接写业务蓝图 JSON / patch、agent 直接改正式数据库或正式 store 文件。

## 关键风险

- 不要把 Leader 误做成业务执行节点。
- 不要把自然语言草案当最终审批对象。
- 不要把后端导入误解为后端生成方案。
- 不要只靠 prompt 做权限边界；请求 scope 和后端校验必须参与。
- 不要让实时动画依赖 agent 在线。
- 不要让 workspace 接管 harness 内部状态。
