# 修复：同一角色在不同分镜视频里音色不一致

## 已确认的原因（`src/routes/workspace.$workspaceId.tsx`）

1. 每组视频的参考音频要靠用户在确认卡里手选：`buildVideoGenPayloadForShots` / `...ForStoryboard` 只收集 `audioCandidates`（角色的 `referenceAudioUrl`），而 `executeVideoGen(..., selectedAudioUrl)` 默认是 `undefined`，`ZopiaChatPanel` 里 `selectedAudioUrl` 初始为空（默认「不使用」）。所以 4 段视频都没带 `reference_audio`。
2. 提示词里没有任何音色约束：`buildDialogueDeliveryInstruction` 只规定「逐镜说什么台词」，没有说「谁在说、什么音色」。旁白·苍老声音这种角色，模型每次都自己临时编一个音色。
3. 结果：同一角色跨片段音色随机漂移。

## 修复方案

1. **角色音色默认锁定**
   - 构建 payload 时，若本组出现的角色已绑定 `referenceAudioUrl`，则把它作为「默认选中」的参考音频写进确认卡（新增 `defaultAudioUrl`），用户仍可改选或选「不使用」。
   - 单人（或只有一个有音色的角色，如旁白）时直接默认选中；多个候选时默认选中台词量最多的那个角色的音色，并在卡片上标出「已锁定：<角色名>」。

2. **提示词补一段音色说明（voice casting）**
   - 在 `buildDialogueDeliveryInstruction` 生成的 `[SPOKEN DIALOGUE]` 块后追加 `[VOICE CASTING — KEEP CONSISTENT]`：逐个说话角色列出「角色名 + 年龄/性别/音色描述（取角色卡的年龄、标签、简介，如「旁白·苍老声音，65岁，沉稳苍老的男性叙述者」）」，并明确要求同一角色在所有镜头/所有片段使用同一音色、语速与语气，不得中途更换嗓音。
   - 逐镜台词行加上说话人前缀：`Shot 3: 旁白·苍老声音 「…」`，让模型知道每句归谁。

3. **音色在项目层持久化**
   - 角色的音色绑定（`referenceAudioUrl` 或预设 `VOICE_STYLES` 的 id）随 `workspace_data` 保存（已有字段），确保跨片段、跨会话复用同一段参考音频，而不是每次重建时丢失。
   - 若角色尚未绑定音色，首次生成时按角色属性自动匹配 `VOICE_STYLES` 中最接近的一项并写回该角色，之后所有片段沿用，从根上保证一致。

4. **UI 提示**
   - 确认卡的音频区显示当前锁定的角色音色名；未绑定音色的说话角色给一条轻提示「未设置音色，将自动分配并锁定」。

## 影响范围

- `src/routes/workspace.$workspaceId.tsx`（payload 构建、台词/音色提示词、默认音频选择、自动绑定写回）
- `src/components/workspace/ZopiaChatPanel.tsx`（确认卡默认选中与展示）
- `src/data/voiceStyles.ts`（自动匹配规则所需的性别/年龄标注）
