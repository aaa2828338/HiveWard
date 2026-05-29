# Manager Dispatch and Agent Handoff Rules

本文档记录当前已确认的 HiveWard Manager 调度规则、Agent 输出规范、产物交接规则和下游上下文组装规则。

这是一份阶段性规则文档，不是实现方案。后续实现应以本文档为产品口径。

## 1. 总体目标

HiveWard 的蓝图执行应像一个真实团队协作流程：

- Manager 负责调度，不负责替槽位执行工作。
- Agent 负责执行具体工作。
- Agent 写给人的报告，也是下游 Agent 的主要交接内容。
- 自然语言交接放在报告里。
- 非自然语言产物放到工作区或产物库，只把地址交给下游。
- Manager 只能根据真实回执判断进度，不能根据槽位菜单宣布完成。

一句话：

```text
Manager 派活，Agent 干活。
报告负责交接，产物负责落地。
菜单只能告诉 Manager 能派谁，回执才能告诉 Manager 谁干完了。
```

## 2. Manager 的职责

Manager 是调度员，不是执行者。

Manager 每次做判断时，只应该看三类信息：

```text
1. upstream
上游给 Manager 的任务、目标、背景和限制。
上游可能是用户，也可能是更高层 Manager 或 Leader。

2. previousResults
本轮里已经真实跑完的槽位结果。
这是判断执行进度和完成度的唯一成绩单。

3. delegationRoster
当前可用槽位菜单。
里面应包含槽位信息，以及槽位内部 Agent 的名称、描述、提示词等。
```

核心规则：

```text
delegationRoster 是菜单，不是成绩单。
previousResults 才是成绩单。

Manager 可以根据 delegationRoster 判断下一步派谁。
Manager 不能根据 delegationRoster 宣布某个槽位已经完成。
Manager 只能根据 previousResults 里的真实回执判断谁完成了。
```

## 3. 三种执行模式

### 3.1 顺序执行

顺序执行模式下，平台按连接顺序自动运行槽位。

例如：

```text
Slot 1 -> Slot 2 -> Slot 3
```

这个模式不需要 Manager 自己判断 `nextSlot`。

顺序执行模式下，不应灌入自分发规则，避免 Manager 误以为自己需要做调度判断。

### 3.2 自分发

自分发模式下，Manager 每次只做一个调度决定。

Manager 应根据以下信息判断下一步：

```text
upstream + previousResults + delegationRoster
```

Manager 可以返回：

```text
continue + nextSlot
继续派发给某个槽位。

retry + nextSlot
某个槽位跑过，但结果无效，打回重做。

complete
确认任务完成。
```

自分发运行记录应呈现为 Manager 和槽位交替出现：

```text
Manager：说明为什么派 Slot 1
Slot 1：执行并返回报告

Manager：根据 Slot 1 的报告，说明为什么派 Slot 3
Slot 3：执行并返回报告

Manager：根据 Slot 3 的报告，继续派发、打回重做，或确认完成
```

每次 Manager 调度都必须写 `reason`。

`reason` 应进入运行记录，给人看，而不是只给机器看。

`reason` 至少应说明：

```text
我看到了什么上游任务；
我看到了哪些已完成结果；
我为什么下一步派这个槽位。
```

### 3.3 自迭代

自迭代是特殊模式。

如果调研口、提需口或预检口已经连接了专门槽位：

```text
交给已连接槽位执行。
Manager 不自己做这部分工作。
```

只有在对应连接口没有连接槽位时，平台才允许 Manager 临时补这部分职责。

这套特殊规则只允许灌入自迭代模式：

```text
顺序执行模式不灌。
自分发模式不灌。
只有自迭代模式，并且缺少对应连接口时才灌。
```

## 4. Manager 的完成与打回规则

Manager 不能轻易 `complete`。

允许 `complete` 的前提：

```text
previousResults 里已经有真实槽位回执；
真实回执能证明任务已经完成；
如果任务要求产物，必须能看到产物地址或产物索引；
如果任务要求测试或验收，必须能看到测试或验收结果。
```

禁止 `complete` 的情况：

```text
没有 previousResults。
没有真实槽位回执。
只有 delegationRoster。
只有槽位说明，没有槽位返回。
槽位跑过但没有有效结果。
```

没结果时的兜底规则：

```text
槽位还没跑过：
返回 continue + nextSlot，正常派发。

槽位跑过，但没有返回有效结果：
返回 retry + nextSlot，打回这个槽位重做或补交结果。

不能编造结果。
不能宣布完成。
不能直接把无结果当成成功。
```

一句话：

```text
没有回执，不算完成。
回执无效，打回重做。
```

## 5. Agent 输出规范

每个 Agent 的主要交接物是报告。

报告是自然语言，可以自由写，不要限制太死。

但报告必须把事情说清楚：

```text
我做了什么；
结论是什么；
有没有产物；
如果有产物，产物在哪；
有什么风险或注意事项；
其他自由输出。
```

硬规则：

```text
报告必有。
产物可无。
有报告、没产物，也是一种合法完成。
```

不是每个 Agent 都必须交文件，也不是每个 Agent 都必须生成 artifact。

例如以下 Agent 可以只有报告，没有产物：

```text
调研 Agent：只给调研结论。
判断 Agent：只给可行性判断。
审核 Agent：只给通过、不通过和原因。
规划 Agent：只给执行建议。
```

## 6. 报告与硬字段

Agent 输出应同时包含两层：

```text
1. 自然语言报告
给人看，也给下游 Agent 看。

2. 少量硬字段
给平台识别，也帮助下游快速定位关键内容。
```

硬字段可以填“无”，但如果有内容，必须填清楚。

建议硬字段：

```text
status
本节点状态，例如：完成、阻塞、需要重做。

summary
一句话总结本节点做了什么。

artifacts
产物索引。没有产物就填“无”。

handoff
给下游的交接要点。没有额外交接就填“无”。
```

这些硬字段不应限制 Agent 的正常表达。

Agent 仍然可以在报告里自由解释、补充背景、说明判断过程和风险。

## 7. 什么算产物

自然语言报告本身不算产物。

普通文字交接也不算产物。

这些内容应直接写在报告里：

```text
研究结论；
判断理由；
计划建议；
审核意见；
风险说明；
下一步建议；
普通文字说明。
```

真正需要走产物地址的是非自然语言产物。

例如：

```text
HTML 页面；
JSON 文件；
代码文件；
图片；
视频；
表格；
压缩包；
可下载文件；
网页链接；
测试报告文件；
其他不能直接作为自然语言报告阅读的大内容。
```

规则：

```text
自然语言写进报告。
非自然语言产物给地址。
大内容不要塞给下游。
```

## 8. 产物字段规则

如果没有产物：

```text
artifacts: 无
```

如果有产物，必须写清楚：

```text
产物名；
产物类型；
产物位置；
产物用途；
下游是否需要使用它。
```

示例：

```text
artifacts:
- title: 最终 HTML 页面
  kind: html
  location: /artifacts/objects/sha256/xx/xxx.html
  description: 给 QA 或发布节点检查的页面产物
```

重要约束：

```text
不要把完整 HTML 源码塞给下游。
不要把完整 JSON 大包塞给下游。
不要把完整日志塞给下游。
给下游地址，让下游自己读取。
```

## 9. 下游 Agent 应收到什么

下游 Agent 主要应收到上游 Agent 的报告。

下游看到的内容应和人看到的运行记录报告基本一致。

下游 Agent 应收到：

```text
上游 Agent 的自然语言报告；
上游 Agent 的产物索引；
Manager 本次调度 reason；
必要的结构化上下文。
```

下游 Agent 不应默认收到：

```text
完整 raw JSON；
完整 HTML；
完整文件正文；
完整内部日志；
完整运行时原始输出。
```

下游 Agent 应根据报告里的路径、链接、artifactId、downloadUrl 或 storagePath 自己读取产物。

一句话：

```text
下游吃报告，不吃原始大包。
```

## 10. Manager 给下游组装输入

Manager 给下游组装输入时，不应该改写上游事实。

下游输入应由几部分组成：

```text
上游 Agent 报告；
上游 Agent 产物索引；
前序槽位报告；
前序槽位产物索引；
Manager 调度 reason；
必要的结构化上下文。
```

Manager 的 `reason` 只能作为调度说明：

```text
为什么派给这个槽位；
Manager 根据哪些结果做了这个决定。
```

Manager 的 `reason` 不能替代上游报告，也不能替代真实产物。

## 11. 工作区与产物库

平台应围绕蓝图工作区组织执行过程。

当前平台已有蓝图工作区概念：

```text
data/blueprint-workspaces/<blueprintId>/
```

工作区包含：

```text
blueprints/
skills/
mcp/
scripts/
artifacts/
tmp/
```

平台也有产物库，会为产物生成可引用位置：

```text
storagePath
relativePath
downloadUrl
```

目标协作方式：

```text
Agent 把非自然语言产物放到工作区或产物库。
Agent 在报告和 artifacts 字段里写清楚产物地址。
下游 Agent 根据地址读取产物并继续工作。
```

## 12. 最终口径

```text
Manager 不干活，只派活。
Agent 写报告，报告给人看，也给下游 Agent 看。
报告是主要交接物。
有报告、没产物，也可以通过。
自然语言交接写进报告。
非自然语言产物放到工作区或产物库，只传地址。
没有真实结果不能完成。
结果无效就打回重做。
```
