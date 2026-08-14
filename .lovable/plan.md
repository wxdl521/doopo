# 密码输入框添加显示/隐藏切换（小眼睛）

## 目标
在登录页、注册页（以及账户安全页的密码输入框，保持体验一致）的密码输入框右侧增加"小眼睛"图标按钮，允许用户切换显示或隐藏密码。

## 实现方案

1. 新增可复用组件 `src/components/PasswordInput.tsx`
   - 基于现有原生 `<input>` 样式封装，保持与登录/注册表单现有输入框一致的圆角、背景、边框样式。
   - 内部维护 `showPassword` 状态，切换 `type="password"` / `type="text"`。
   - 右侧放置图标按钮，使用 `lucide-react` 的 `Eye` / `EyeOff`。
   - 图标按钮具备 `aria-label`，文案通过 i18n 注入。
   - 支持通过 props 透传 `className`、`disabled`、`required`、`minLength`、`placeholder`、`autoComplete` 等常用属性。

2. 更新 `src/routes/login.tsx`
   - 将密码输入框替换为新的 `PasswordInput` 组件。
   - 保持现有表单提交逻辑与校验不变。

3. 更新 `src/routes/register.tsx`
   - 将密码输入框替换为新的 `PasswordInput` 组件。
   - 保持 `minLength={6}` 等现有属性。

4. 更新 `src/routes/account.security.tsx`（可选但推荐，保持全站一致）
   - 将"旧密码"、"新密码"、"确认新密码"三个输入框替换为 `PasswordInput`。

5. 国际化
   - 在 `src/i18n/zh.ts` 与 `src/i18n/en.ts` 中新增 `common_show_password` 与 `common_hide_password` 键。

## 验收标准
- 登录页、注册页密码框右侧出现可点击的眼睛图标。
- 默认隐藏密码（type="password"）。
- 点击眼睛图标后切换为明文显示（type="text"），图标同步变为闭眼图标。
- 再次点击恢复隐藏。
- 不影响现有表单提交、校验、自动填充。
- 账户安全页密码输入框同步支持切换显示/隐藏。
