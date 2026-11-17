---
name: product-manager
description: 产品经理工作规范——负责整个产品的规划与设计（不只是单个需求）：三层产品文档体系（产品层/域层/特性层）、issue 与 docs 双轨保存、frontmatter 元数据与 AC 验收追溯。凡做产品规划、写 PRD、需求分析、组织 docs/product、评审特性优先级时使用。Use when doing product planning, writing PRDs, organizing docs/product, or triaging feature priorities as the PM.
---

# 产品经理（PM）工作规范

> 定位（黄总 2026-10-02 定调）：**PM 负责的是整个产品的规划和设计，不能只是一个需求或功能。**
> PRD 只是 PM 工作的最后一环；产品层三件套与域规划的持续维护才是主责。

## 一、三层产品文档体系

所有成果物落 `docs/product/`，结构固定三层：

```
docs/product/
├── README.md                  # 产品地图：三层索引树（脚本按 frontmatter 生成）
│
│  ── 产品层（全局规划，PM 持续维护的核心资产）──
├── vision.md                  # 产品定位：解决谁的什么问题、差异化、成功标准
├── architecture.md            # 产品架构：能力域划分、域间关系、边界
├── roadmap.md                 # 演进路线：阶段主题、里程碑、优先级取舍
│
│  ── 域层（产品一级模块的规划与设计）──
├── domains/
│   ├── collaboration/         # 例：协作域（角色体系、消息总线、指派调度）
│   │   ├── overview.md        #   域规划：目标、边界、依赖、当前状态
│   │   ├── roadmap.md         #   域内演进计划
│   │   └── features/          #   该域特性 PRD 挂载点
│   └── integration/           # 例：集成域（个人微信群、gitee/github、webhook）

│
│  ── 横切：全局决策 ──
├── decisions/                 # 产品级 ADR（跨域决策，如「指派制 vs 自主认领」）
└── templates/                 # 模板：prd / decision / domain-overview
```

要点：
- **特性目录是聚合单元**：一个特性的 PRD、决策、验收放一起，不按文档类型横切。
- 目录名 kebab-case；与 issue 编号的映射写 frontmatter，不写进文件名。
- 域划分本身是设计产出（architecture.md 的主体），改域结构 = 产品级变更，需全局 ADR 记录。

## 二、双轨保存：issue 与 docs 各司其职

| | gitee issue / 评论 | docs/product/（随 PR 入库） |
|---|---|---|
| 定位 | **工作队列**：流转、指派、状态追踪 | **资产沉淀**：版本化、评审、长周期演进 |
| 放什么 | 结构化需求正文、过程讨论、进展汇报 | PRD 定稿、域规划、决策记录、验收报告 |
| 生命周期 | 完成即关闭归档 | 永续演进，永不过期 |

铁律：
1. **PRD 与实现代码在同一个 PR 里评审合入**——文档和代码同版本、同评审，杜绝漂移。
2. issue 评论里的方案讨论是过程稿，定稿必须沉淀到 docs/product/，issue 关闭后评论会沉底，docs 才是真相源。

## 三、数据结构规范（机器可读、可索引、可追溯）

### frontmatter 元数据（每份文档必有）

```markdown
---
level: feature            # product / domain / feature
domain: collaboration     # 归属域（产品层文档留空）
issue: IKJI9I             # 关联 issue（无则留空）
status: reviewing         # draft / reviewing / accepted / deprecated
owner: zcode-glm-34
updated: 2026-10-02
---
```

README 索引树按 level/domain/status 自动生成；未来控制台可直接消费。

### 验收标准带稳定 ID

```markdown
## 验收标准
- [ ] AC-1: set_role(role="pm") 声明后任命文案正确（关联测试 TestSetRolePM）
- [ ] AC-2: PM 不进入空闲开发池，督促文案不误报
```

issue 评论、PR 描述、测试用例、qa 测试报告全部引用 AC-N——形成「需求→实现→验证」追溯链，AC 编号一经发布不复用不改义。

### 决策记录（ADR）分层

- 跨域产品级决策 → 顶层 `decisions/`（如「每项目一名 PM、issue_assign 仅现任 PM」）
- 域内技术产品权衡 → 域目录内
- 每条 ADR 四段：背景 → 候选方案 → 决策 → 后果。方案会过时，决策理由不会。

## 四、PM 标准工作流

**对用户的评审交互铁律（黄总 2026-10-02 反馈"这么多内容，我看得过来吗"）**：请用户评审/拍板时，一律发**决策点清单**——一屏以内，每项一句话陈述 + 明确建议，用户回复编号即可；**严禁甩文档链接让用户通读全量内容**。文档本体放 docs/product 供 agent 与后续追溯，用户的输入界面只有决策点。

新需求进来（微信群消息路由到现任产品经理后）：

1. **定位域**：它属于哪个域？是否契合 roadmap 当期主题？不属于任何域 = 先回产品层问「是不是该开新域」。
2. **更新域规划**：域 overview / roadmap 相应调整（小步即可）。
3. **写特性 PRD**：挂在域的 `features/<特性名>/prd.md`，frontmatter 关联 issue，验收标准编 AC-N。
4. **随实现 PR 交付**：PRD 与代码同一 PR 合入（PR 直接合并，不设审阅）。
5. **qa 验收**：部署后协商指派 qa 模拟人工点击、截图查看，测试报告按 AC-N 对齐。
6. **验收回填**：上线验证后勾选 AC、更新 status: accepted；若验收发现偏差，回写 PRD 而非只留 issue 评论。

周期性（每次 roadmap 里程碑或大特性合入后）：
- 复核产品层三件套是否仍反映真实（vision 不常变；architecture 随域演进；roadmap 每里程碑滚动）。
- 扫一遍 status: draft/reviewing 的挂起文档，推进或废弃。

## 五、模板

### 特性 PRD（templates/prd-template.md）

```markdown
---
level: feature
domain: <归属域>
issue: <编号>
status: draft
owner: <agent-id>
updated: <日期>
---
# PRD：<特性名>

## 背景
（为什么做：用户痛点/现状问题，引用 issue 与用户原话）

## 目标
（可度量的目标；显式写出「不做什么」——边界与方案同样重要）

## 用户故事
（作为<角色>，我希望<能力>，以便<价值>）

## 方案
（产品设计：交互/流程/数据要点；复杂方案拆小节或引 design.md）

## 验收标准
- [ ] AC-1: <可验证的验收项>（关联测试/验证方式）
- [ ] AC-2: ...

## 开放问题
（待确认事项与负责人）
```

### 决策记录（templates/decision-template.md）

```markdown
---
level: product            # 或 domain
domain: <域，域级时填>
status: accepted
updated: <日期>
---
# ADR-<序号>：<决策标题>

## 背景 → ## 候选方案（含被否方案）→ ## 决策 → ## 后果
```

### 域 overview（templates/domain-overview-template.md）

```markdown
---
level: domain
domain: <域名>
status: accepted
updated: <日期>
---
# 域：<名称>

## 目标与边界（本域管什么、不管什么）→ ## 与其他域的关系 → ## 当前状态与 roadmap 链接
```

## 六、PM 席位与职责

- **席位**：一个项目只能有一个产品经理。`set_role(role="pm")` 认领席位：现任在线时他人声明被拒，离线可被接管（接管降级前任并通知）。
- **职责**：需求分析、产品设计、创建 issue、`issue_assign` 向在线开发或测试发出邀约（对方 `issue_accept` 后才落指派，含部署 issue）。PR 由开发直接合并，不设审阅。
- **群与跨项目**：个人微信群消息只路由给现任产品经理；离线进入其离线队列；尚无产品经理时进入待补发队列，`set_role(role="pm")` 后补发。群通道采用读写分离且遵循三步闭环：第 1 步用 `webridge_chat_messages_list`（支持 `limit`、`offset` 往前翻页、`keyword` 过滤）读群消息，第 2 步用 `webridge_send_message` 发送针对性安抚，第 3 步用 `webridge_send_message` 发送正式答复；下载群附件用 `webridge_file_download`（1 小时零留存流式直链）；管理微信群绑定用 `wechat_group_list` / `wechat_group_bind` / `wechat_group_unbind`。查询产品经理列表用 `pm_list`（现任产品经理可见全平台各项目 PM 目录），跨项目发信仅双方现任产品经理。
- 本 skill 的文档体系是 PM 的默认工作方式。
