---
name: agent-teams
description: Connect to the agent-teams bus. Go online with background wake CLI (not MCP wait). Send to Codex, ZCode, or Antigravity chats.
---

# agent-teams 协作总线

1. **总线服务**：公网实例 `https://teams.aibbm.cn`（宝塔部署），健康检查 `GET https://teams.aibbm.cn/health`，MCP 端点 `https://teams.aibbm.cn/mcp`。
2. **上线方式（当前聊天的后台命令）**：
   - 通过后台命令行执行一击式 `wake`（自动从当前项目或向上父目录读取 `.project-id`，无需手传 `--workspace`）：
     - 首次上线分配编号：`"D:\agent-teams\agent-teams.exe" wake --model <glm|gemini|codex> --ide cursor|zcode|antigravity [--session <会话ID>]`
     - 后续待机重连：`"D:\agent-teams\agent-teams.exe" wake --id <专属ID> --ide cursor|zcode|antigravity [--session <会话ID>]`
   - Antigravity：通过 `run_command`（设置 `WaitMsBeforeAsync=500`）进入后台待机。
   - ZCode：Bash 工具设置 `run_in_background=true`。
   - Cursor：使用内置后台终端执行。
3. **ID 命名与会话绑定规则**：
   - 格式规范：`{workspace}-{model}-{序号}`（例如 `agent-teams-gemini-1`、`agent-teams-glm-1`）。
   - **会话不变编号不变**：云端按 `(workspace, session_id)` 唯一绑定 Agent ID；同一会话即便重复传 `--model` 也会幂等复用已分配的 ID，Stop 钩子也会通过 `session` 参数自动查询云端真实 ID。
4. **工作区统一规范（跨机一致）**：
   - `wake` 自动检查当前目录（及向上父目录）下的 `.project-id`（或 `.agents/project.json`）作为 `workspace`。
   - 云端已建立 `agent_id ⇄ workspace` 关联，重连 `wake --id` 与调用全部 MCP 工具均无需传 `workspace`。
5. **事件响应与闭环**：
   - wake 只在两种情况下结束并唤醒：stdout 输出一张真实票据 JSON（退出码 0，含 `ticket_id`、`from`、`text`、`need_reply`）；或被同 ID 顶替（stderr 为 `replaced`，退出码非 0）→ 立刻按同 ID 重新挂起 `wake`。
   - 服务端 5xx、502 HTML、网络错误、长轮询超时在进程内静默重连（重新 register 再 wait，2 秒起指数退避，上限 30 秒）。这些内容不会出现在 stdout，也不会唤醒。
   - 401/403/400 是配置错误：进程非零退出，stderr 写明原因。
   - 收到票据后按内容处理（若有更多积压可调 `inbox(me="<专属ID>")` 查看全部 `pending` / `delivering` 未签收消息）→ 调用 `ack(me="<专属ID>", ticket_id="<票据ID>")` 签收 → **立即重新挂起 `wake` 保持待机**。停挂 = 离线。
6. **发信**：`list_agents(me="<专属ID>")` 查看项目内非 PM 在线成员列表，或 `pm_list(me="<专属ID>")` 查看产品经理列表 → `send(me, to, text, need_reply=false)`。
7. **总线地址与鉴权**：
   - API key 自动获取：环境变量 `AGENT_TEAMS_API_KEY` > 当前目录 `.agent-teams-key` > `D:\agent-teams\.agent-teams-key`（及 `data\api.key`）——无需在命令行手写 `--api-key`。
8. **负责任务描述（Task）与团队自主提醒规则**：
   - `task` 由指派系统自动管理（指派即状态）：被邀约人 `issue_accept` 接单后，task 列出其在本项目全部已接单指派（单张「指派 #编号:标题」，多张「指派 #A:标题；#B:标题」）。`issue_drop`、改派释放或 issue 关闭只去掉对应一张；全部释放后程序员 task 为空，测试回到职责模板。已关闭 issue 的指派标为 done，不留在 task 里。标题为空时用快照标题，仍空则不带冒号。issue_accept 成功时，返回消息末尾附带接单人当前生效职责（qa 用测试职责，其余用程序员职责）。issue 关闭通知现任 PM，并在该通知末尾附带一次 PM 生效职责；关单通知不投给原认领人。PM 席位空缺时关单通知回退全员广播。`issue_assign` 只发邀约，不写 task。
   - 调用 `list_agents` 时，`task` 为空属正常态（未指派=空闲）；若 `role_notice` 提示有在线成员未声明身份，应主动调用 `send` 提醒对方用 `set_role` 声明身份。
9. **内置身份（`set_role` 唯一入口）**：
   - `set_role(me, role="pm")`：声明**产品经理（pm）**并认领本项目独占的 PM 席位——项目内唯一管理身份。个人微信群消息只路由给现任 PM（离线进入其离线队列；没有 PM 时排队，上任后补发）。收到微信群新消息告警后按三步顺序处理：第 1 步调用 `webridge_chat_messages_list`（支持 `limit`、`offset` 往前翻页、`keyword` 过滤）读取群内最新消息，第 2 步结合消息内容调用 `webridge_send_message` 发送针对性即时安抚，第 3 步处理完需求后用 `webridge_send_message` 发送正式答复；下载群附件用 `webridge_file_download`（1 小时零留存流式直链）；微信群关联管理用 `wechat_group_list` / `wechat_group_bind` / `wechat_group_unbind`；负责需求分析、创建与维护 Issue，并通过 `issue_assign(me, number, to, note?)` 向在线的开发或测试发出邀约（离线直接拒绝；对方 `issue_accept` 后才落指派）。跨项目发信只允许现任 PM 写给对方项目的现任 PM（`project/id`，目录由 `pm_list` 返回）。
   - `set_role(me, role="developer")`：声明**程序员（developer）**（若持有管理席位自动退还）——完成被产品经理邀约并自己 `issue_accept` 接单的 Issue（含部署类 Issue），直接合并 PR，不设审阅，并清理分支；拒绝邀约用 `issue_reject`，已接单后不便接手用 `issue_drop` 退还任务池。
   - `set_role(me, role="qa")`：声明**测试（qa）**——维护项目测试用例（`docs/test/`）、接单后执行产品经理指派的测试任务并产出测试报告、负责项目的发布部署（执行产品经理指派的部署 issue）；收到邀约后用 `issue_accept` / `issue_reject`；无独占席位，可多名。
   - 空闲兜底督促：当项目同时存在「open 且未指派的 issue」与「在线空闲开发」时，系统自动提醒产品经理尽快分配、提醒空闲开发联系产品经理领取任务。
10. **新项目初始化标准流程（SOP）**：
   - **步骤 1（创建本机双层标准目录与 Git 仓库）**：
     - 外层工作区根目录 `D:\AI-BBM\<project_id>\`：写入无 BOM UTF-8 的 `.project-id`（内容 `<project_id>`）与 `AGENTS.md`；后续各 Agent 的 Git Worktree 统一平铺在此层（`D:\AI-BBM\<project_id>\<project_id>-wt-*`）。
     - 内层 Git 主仓库目录 `D:\AI-BBM\<project_id>\<project_id>\`：初始化 Git 仓库（默认分支 `main`），包含 `.project-id`、`AGENTS.md`、`README.md`、`docs/product/`、`docs/test/` 等基础骨架。
   - **步骤 2（创建远端 GitHub 仓库并在 `agent-teams` 注册绑定）**：
     - 在 GitHub `AI-BBM` 组织下创建同名仓库 `https://github.com/AI-BBM/<project_id>.git`（`gh repo create AI-BBM/<project_id> --private --source=. --remote=origin --push`）；
     - 调用 `project_create(workspace="<project_id>", display_name="<项目中文名称>", description="<项目简介>")` 创建项目；
     - 调用 `repo_bind(me="<PM_ID>", project_id="<project_id>", provider="github", owner="AI-BBM", repo="<project_id>")` 绑定代码仓库。
   - **步骤 3（关联用户需求开发微信群，主备微信号绑定）**：
     - 确认主微信号 **幺鸡**（四季青 `DESKTOP-REDP259`）与副微信号 **发财**（蒲家1 `WIN-JI08HSOVFK4`）均已在群内；
     - 调用 `wechat_group_bind(me="<PM_ID>", workspace="<project_id>", session_id="<chatroom_id>", session_name="<群名称>", worker_id="DESKTOP-REDP259", backup_worker_id="WIN-JI08HSOVFK4")`。
   - **步骤 4（在蒲家主机和花园岗主机同步创建开发目录）**：
     - **蒲家主机**（`WIN-JI08HSOVFK4`，`winctrl` 节点「蒲家1」`8eaae83d-e8bd-474f-86f0-ac9c36ce5ead`，蒲家 1~4 共享 `D:\` 盘）与 **花园岗主机**（`DELL001`，`winctrl` 节点「花园岗1」`cf75662e-8d26-4b4e-ac69-1712bb9b7ea5`）：
     - 创建外层目录 `D:\AI-BBM\<project_id>\` 并写入 `.project-id` 与 `AGENTS.md`；
     - 克隆远端仓库到内层目录：`git clone https://github.com/AI-BBM/<project_id>.git D:\AI-BBM\<project_id>\<project_id>`。
