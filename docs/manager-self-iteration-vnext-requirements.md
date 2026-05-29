# Manager 自迭代 vNext 需求文档：人能读懂的运行链路

## 结论

下一版目标不是重做 manager 自迭代，而是在当前能跑通的基础上，把它升级成真正可交付的产品形态：

- 用户批准的本轮计划必须成为执行阶段 manager 的正式指挥上下文。
- 每个有产出的 agent 都必须给人一份 Markdown 报告。
- JSON 用于 agent 之间交接，不作为用户主视角。
- 全自动运行遇到硬阻塞时，必须停成用户能理解的阻塞状态。
- 代码结构要拆到可以作为下一个版本长期维护的干净状态。

这里的关键分层是：

```text
Markdown = 给人看的运行报告
JSON = 给下一个 agent 的结构化交接
Raw logs = 给排查用的机器细节
```

## 背景

当前版本已经搭起了 manager 自迭代主链路：每轮 preflight、调研、计划审批、执行、报告审批、下一轮推进、上下文快照、artifact 落盘等能力基本可用，测试和构建能通过。

但它还不是最终产品状态。现在用户在运行看板里看到的内容仍然偏机器语言：node 状态、raw output、审批 body、artifact metadata。用户很难像阅读一次对话总结一样理解 agent 到底做了什么。

所以本轮 vNext 的核心不是增加更多 agent 能力，而是补齐产品语义：

1. 批准的计划要真正约束执行。
2. agent 要主动向用户解释自己的产出。
3. JSON 负责机器交接，Markdown 负责人类理解。
4. 阻塞状态要像产品状态，不像异常。
5. 工程结构要从“能跑”变成“干净可维护”。

## 目标

### 1. Approved plan 是执行合同

每轮用户批准的 Round Execution Plan 不是普通审批文本，而是本轮执行合同。

执行阶段 manager 必须拿到：

- 被批准的计划正文。
- 计划版本号。
- 计划审批记录。
- research context。
- 上一轮 release report。
- 上一轮 manager context snapshot。
- 用户反馈。
- 当前 artifact index。

产品语义是：

> 用户批准“这一轮怎么干”之后，manager 必须按这份正式计划调度 worker，而不是只凭记忆或上一轮上下文继续。

### 2. 所有有产出的 agent 都要有人类可读 MD 报告

不只是 manager，所有有产出的 agent 都必须给用户一份 Markdown 报告。

这个报告不需要强模板，不要求固定字段，不要求每个 agent 都写成同一种格式。agent 可以根据任务自由表达：

- 做了什么。
- 为什么这么做。
- 看到了什么关键事实。
- 产出了什么。
- 用户应该看哪里。
- 有什么风险、假设或未完成项。

平台不能把 agent 的 MD 报告写死成死板表单。平台只负责：

- 要求 agent 产出 MD 报告。
- 保存 MD 报告。
- 在运行看板中优先展示 MD 报告。
- 将 raw output 放到详情或调试区域。

为了兼容已有 agent，平台可以在老输出没有显式 MD 报告时生成一份最小 fallback 报告，例如从纯文本输出、`summary`、`body` 或 `markdown` 字段提取。但这只是兼容兜底，不是产品理想形态。run view 中仍必须有一条 agent human report 记录，并且必须能区分它是 agent 主动写的报告，还是平台 fallback 生成的报告。

产品语义是：

> 用户看运行结果时，首先看到的是 agent 给人的解释，而不是机器输出。

### 3. JSON 是 agent 交接，不是用户主视角

JSON 的职责是让下一个 agent 能接着做事。它必须承载：

- 当前任务的结构化结论。
- 可复用事实。
- 决策结果。
- 产物引用。
- 下一步建议。
- 风险和假设。

JSON 不得成为用户主视角。用户可以在高级详情里看到它，但默认看板必须优先显示 Markdown 报告。

产品语义是：

> MD 负责让人理解，JSON 负责让 agent 接力。

### 4. 全自动遇到硬阻塞要停得清楚

全自动运行不是无条件硬跑。

如果 manager 或 agent 判断遇到硬阻塞，例如：

- 缺账号。
- 缺权限。
- 缺凭证。
- 需要不可编造的外部事实。
- 需要用户明确授权的破坏性操作。

系统必须停下来，生成用户能懂的阻塞卡片。

阻塞卡片必须表达：

- 为什么停。
- 缺什么。
- 用户怎么补。
- 补完后如何继续。

即使开启了自动批准，也不能自动越过这种阻塞。

产品语义是：

> 全自动可以自动推进低风险步骤，但不能把真实阻塞伪装成成功或异常。

### 5. Artifact 边界保持克制

本轮不做万能 artifact 归档系统。

平台稳定兜底这些类型：

- HTML。
- Markdown。
- JSON。

对于更多复杂产物，例如：

- 本地文件路径。
- 外部链接。
- 第三方平台页面。
- 临时下载地址。
- 多文件目录。
- 截图、视频、压缩包。

本轮不强行全部建模归档。它们必须先通过 agent 的 Markdown 报告表达，由 agent 主动告诉用户产物在哪里、是否值得看、后续怎么处理。

产品语义是：

> 不要求平台吞掉所有产物类型，但要求 agent 把重要产物说清楚。

### 6. 运行看板要分层

运行看板必须至少有三层：

1. 用户主视角：agent Markdown 报告、manager release report、当前状态。
2. 结构化交接视角：JSON handoff、计划、research context、snapshot。
3. 调试视角：raw output、nodeRun、runContext、runtime metadata。

默认必须展示第一层。

高级用户或排查场景可以展开第二、三层。

## 每轮产品链路

```text
Round start context
-> research resolution
-> round execution plan
-> human/auto approval
-> manager dispatch with approved plan + memory + research
-> agent execution
-> each productive agent publishes MD report + JSON handoff
-> manager synthesizes release report for user
-> manager writes context snapshot for next round
-> human decides approve next / complete / reply / reject
```

## Agent 输出契约

每个有产出的 agent 必须产出 Human report。只要这个 agent 的结果会被 manager 或下游 agent 继续使用，就必须产出 Agent handoff。

### Human report

Markdown，自由格式，给人看。

平台不限制它的标题、段落、顺序和写法。只要求它是人能读的总结，而不是只给机器解析的对象。

验收口径：

- 每个有产出的 agent 在 run view 中都必须对应一条 human report。
- 优先使用 agent 主动写出的 Markdown。
- 兼容旧 agent 时允许平台生成 fallback Markdown，但必须保留 raw output，且不能把 fallback 当成新的固定模板。

### Agent handoff

JSON，给后续 agent 使用。

它应尽量结构化，但不要求用户直接阅读。它可以被 manager 或下游 agent 注入上下文。

验收口径：

- JSON handoff 是下游 agent 的机器交接输入。
- 下游 agent 不能通过反解析 Human report 来接力。
- Human report 可以被引用给人看，但不能成为唯一机器交接源。

### Raw output

保留原始输出，作为排查材料。

Raw output 不得成为运行看板默认主内容。

## Manager release report 语义

manager 每轮最终给用户的 release report 必须综合：

- approved plan。
- research summary。
- 每个 agent 的 MD 报告。
- 关键 JSON handoff 里的结构化结论。
- artifact index。
- rejected artifact context。
- 当前风险和假设。

Release report 是用户判断“接受本轮结果、继续下一轮、要求修改、结束 run”的主要依据。

## 非目标

本轮不做：

- 万能 file/link artifact 归档系统。
- 向量记忆或长期记忆。
- worker harness 层跨轮 memory。
- 强制固定 agent Markdown 报告模板。
- 用 JSON 取代用户可读报告。
- 隐藏 raw logs；raw logs 仍可在详情中查看。

## 验收标准

- 用户批准的 Round Execution Plan 会进入执行阶段 manager 的 run context。
- manager 调度 worker 时能看到 approved plan、research、snapshot、上一轮报告、artifact index。
- worker 不被平台自动注入完整跨轮记忆，只接收 manager 分发的局部任务上下文。
- 每个有产出的 agent 都能在 run view 中看到 Markdown 报告。
- 下游 agent 使用 JSON handoff 或结构化上下文接力，不依赖用户 MD 反解析。
- manager release report 能综合 agent MD 报告并形成用户可读总结。
- 全自动运行遇到硬阻塞时停成 pending blocked 状态，而不是抛异常或继续执行。
- blocked 状态下用户能看到缺什么、为什么停、怎么补。
- HTML / markdown / JSON artifact 继续可落盘、预览或下载。
- file/link 等复杂产物先通过 agent MD 报告表达，不作为本轮强制 artifact 建模范围。
- 运行看板默认展示用户可读内容，高级详情可查看 raw output / JSON / runContext。
