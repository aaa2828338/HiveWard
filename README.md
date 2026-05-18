# openclaw-cui

OpenClaw 的可视化控制面板。CUI 负责工作流产品状态、画布和展示，OpenClaw 负责 agent、tools、models、providers、channels、tasks 等真实执行能力。

## Run

```bash
npm install
npm run dev
```

- Web: `http://localhost:5173`
- Companion API: `http://localhost:8787`

## OpenClaw Gateway

默认使用 `OPENCLAW_ADAPTER=auto`：如果能从 `~/.openclaw/openclaw.json` 或环境变量解析到 Gateway，就连接真实 OpenClaw；否则回退到 mock。

可用环境变量：

- `OPENCLAW_ADAPTER=auto|real|gateway|mock`
- `OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789`
- `OPENCLAW_GATEWAY_TOKEN=...`
- `OPENCLAW_GATEWAY_PASSWORD=...`
- `OPENCLAW_GATEWAY_ORIGIN=http://127.0.0.1:18789`
- `OPENCLAW_GATEWAY_LOCALE=zh-CN`
- `OPENCLAW_AGENT_START_TIMEOUT_MS=20000`

前端右上角语言按钮支持 `中文` / `EN` 切换，选择会保存在浏览器本地存储中。

## 调用真实 Agent

1. 打开 `http://localhost:5173`。
2. 点击右上角 `目录`，从 OpenClaw Gateway 刷新真实模型、agents、工具和通道。
3. 选中画布上的 `OpenClaw 调用` 节点。
4. 在右侧检查器里选择真实 `OpenClaw agent`，当前本机 OpenClaw 返回的是 `main`。
5. 选择模型，或保留 `OpenClaw default` 使用该 agent 的默认模型。
6. 修改 `Prompt`。
7. 点击右上角 `运行`。运行按钮会先保存当前节点配置，然后调用 OpenClaw Gateway 的 `agent` RPC。

节点标题例如 `Requirements Agent` 只是 CUI 工作流里的显示标签；真正传给 OpenClaw 的是检查器里的 `OpenClaw agent` 字段。

## Architecture Boundary

```text
Web -> CUI API -> OpenClaw Adapter -> OpenClaw Gateway / Runtime
```

- Workflow graph、节点坐标、模板、标签、dashboard 聚合只属于 CUI。
- Agent/tool/model/channel 执行事实只属于 OpenClaw。
- Gateway/RPC 细节只能出现在 adapter 边界内。

Run the guardrail check:

```bash
npm run check:boundaries
```
