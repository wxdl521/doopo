## 需求梳理（来自《网站需求.docx》）

平台定位：面向 AI 影视创作者的一体化 SaaS（B/C 双端），覆盖剧本→角色→项目→团队→社区→运营全流程。

文档核心模块：剧本创作、角色设计、项目管理、团队协作、运营后台、社区发布、激励体系。
现有页面已覆盖：Home / Projects / Scripts / Characters / Bases / Showcase / Models / Pricing / ZoClaw。
**缺口**：剧本生成的多模式向导与版本对比、角色一致性与三视图/角色圣经、团队权限与水印/审批、运营后台、激励体系（积分/等级/变现）、操作日志。

## 本轮交付（前端风格保持现有风格，仅前端 + mock，不接真实后端）

### 1. 剧本创作增强 `src/routes/scripts.new.tsx` → `/scripts/new`

- 创意输入区（一句话 / 梗概 / 上传文本）
- 三种创作模式 Tab：从零创作 / 灵感扩写 / 风格迁移
- 快速模板（30s/1min/3min/5min）+ 高级参数（时长滑杆、集数、对话密度、冲突密度）
- 右侧 mock 生成预览（场景标题 / 动作 / 对白 工业格式）

### 2. 剧本详情/版本管理 `src/routes/scripts.$id.tsx` → `/scripts/:id`

- 多版本时间线 + 版本对比（左右两列 diff 高亮 mock）
- 幕/场景结构树
- 导出按钮组（PDF / Fountain / JSON）
- 多轮对话迭代面板

### 3. 角色详情 `src/routes/characters.$id.tsx` → `/characters/:id`

- 角色三视图（正/侧/背 mock 占位）
- 角色圣经字段（外貌、服装、配饰、性格）
- 一致性锁定开关、参考图上传区
- 关联场景/道具、表情动作库标签、关系图谱（简易节点图 mock）

### 4. 团队管理 `src/routes/team.tsx` → `/team`

- 成员列表表格（头像 / 角色 / 用量 / 状态 / 操作）
- 邀请成员、禁用、删除（mock）
- 权限矩阵（按文档 5.3 表格渲染）
- 用量统计卡片 + mock 折线/柱状

### 5. 操作日志 `src/routes/team.logs.tsx` → `/team/logs`

- 时间线 + 过滤（成员、操作类型、时间范围）

### 6. 资产审批 `src/routes/team.approvals.tsx` → `/team/approvals`

- 待审批资产卡片列表，通过/驳回按钮（mock）

### 7. 运营后台 `src/routes/admin.tsx` → `/admin`（含子路由）

- `/admin` 总览：企业数、用户数、调用量、收入 mock 卡片
- `/admin/models` 模型 API 配置：模型名/Provider/Key 状态/启用开关
- `/admin/tenants` 企业账号审核：开户申请列表
- `/admin/billing` 计费：套餐 / 发票 mock

### 8. 激励体系 `src/routes/rewards.tsx` → `/rewards`

- 积分余额、等级进度条、签到、任务列表
- 变现说明（创作者分成 mock 数据）

### 9. 个人中心 `src/routes/account.tsx` → `/account`

- 资料、订阅、API Key、安全设置（标签页）

### 10. 共用增强

- `src/data/mock.ts`：集中 mock（成员/日志/审批/积分/模型/版本…）
- `src/components/WatermarkOverlay.tsx`：普通员工视图叠加公司名水印（演示开关）
- `MobileNav` 与 `Header` 增加新入口（Team / Admin / Rewards），在窄屏用「更多」抽屉避免拥挤
- i18n：`src/i18n/zh.ts` & `en.ts` 添加新增文案 key

## 技术约束

- TanStack Router 文件路由，每个新页面单独路由文件 + `head()` SEO
- 全部使用现有设计 tokens（`src/styles.css`），不引入硬编码颜色
- 仅前端 + 内存 mock；不动 Supabase / OpenRouter 调用代码
- 移动端沿用上一轮的 safe-area 与 `pb-24` 规范

## 暂不在本轮范围

- 真实权限后端、真实计费、真实日志写入
- AI 调用打通（继续走现有 Characters/Scripts 已实现路径）
- 关系图谱的复杂可视化库（用静态 SVG 节点占位）

确认后我将按此方案落地，分文件提交。