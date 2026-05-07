## 剧本导出功能

在 `/scripts` 页面为每个剧本卡片添加导出按钮，支持 **TXT** 和 **DOCX** 两种格式，导出内容包含完整元信息。

### 功能设计

每个剧本卡片展开区域新增一个"导出"下拉按钮（位于"优化/复制"旁），点击后选择格式：
- **导出为 TXT** — 纯文本，UTF-8 编码
- **导出为 Word (.docx)** — 带格式的 Word 文档

文件名格式：`{标题}_{类型}_{创建日期}.{ext}`，自动清理非法字符。

### 导出内容（含元信息）

```
═══════════════════════════════
{标题}
═══════════════════════════════

类型：Short Drama
题材：Drama
风格：Serious
创建时间：2026-05-07 14:30

剧情概要：
{plot}

───────────────────────────────
正文：
───────────────────────────────

{content}
```

DOCX 版本：标题用 Heading1、元信息表格化、正文用等宽字体保持剧本格式。

### 技术实现

1. **新增依赖**：`docx`（前端打包，生成 .docx Blob）和 `file-saver`（触发下载）。
2. **新文件 `src/lib/exportScript.ts`**：
   - `exportScriptAsTxt(script, t)` — 拼接字符串 → `Blob` → 下载
   - `exportScriptAsDocx(script, t)` — 用 `docx` 库构建 `Document`（标题、元信息段落、正文），`Packer.toBlob()` → 下载
   - `slugify(name)` 工具，去除文件名非法字符
3. **修改 `src/pages/Scripts.tsx`**：
   - 引入新导出函数
   - 在剧本卡片展开区按钮组添加"导出"按钮 + 下拉菜单（TXT / DOCX 两项）
   - 点击对应项调用导出函数
4. **i18n 增加文案**（`zh.ts` / `en.ts`）：
   - `script_export` / `script_export_txt` / `script_export_docx`
   - 元信息标签复用现有 `script_type` / `script_genre` / `script_tone` / `script_plot`
   - 新增 `script_created_at` / `script_content_label`

### 范围

- 仅前端纯客户端实现，无需后端服务函数
- 仅"单个剧本"导出（按用户确认）
- 内容为空的剧本，导出按钮禁用