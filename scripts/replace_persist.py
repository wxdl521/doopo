#!/usr/bin/env python3
"""Replace processCharacter updateCharImages with persistAndSetCharImage"""

with open('src/routes/workspace.$workspaceId.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the exact anchor point
anchor = 'updateCharImages((m) => ({ ...m, [ls.imageKey]: [res.url] }))'
idx = content.find(anchor)
if idx == -1:
    print('ERROR: anchor not found')
    exit(1)

# We need to find the start and end of the block to replace.
# Look backwards to find "if (res.url) {"
block_start = content.rfind('\n\t        if (res.url) {', 0, idx)
if block_start == -1:
    block_start = content.rfind('if (res.url) {', 0, idx)

# Look forward to find the end of the block (next "} else {" or "}")
# Indentation uses 8 spaces (not tabs)
block_end = content.find('\n        } else {', idx)
if block_end == -1:
    print('ERROR: block end not found')
    exit(1)

# Show what we're replacing
old_block = content[block_start:block_end]
print(f'Replacing block from {block_start} to {block_end}')
print('OLD BLOCK:')
print(old_block[:200])

new_block = '''        if (res.url) {
          // 2026/06:先持久化到 Supabase Storage,拿到永久 URL 后再更新 state。
          // 这样 workspace_data 保存的永远是永久 URL,刷新页面不会裂图。
          const p = await persistAndSetCharImage(ls.imageKey, res.url, 'character', c.id)
          console.log(`[CHAR-AUTOGEN] persist result: imageKey=${ls.imageKey} ok=${p.ok} url=${p.url}`)
          if (p.ok) {
            toast.success(`已生成 ${cardTitle}（${styleSpec.label}）`)
          }
        } else {'''

content = content[:block_start] + new_block + content[block_end:]

with open('src/routes/workspace.$workspaceId.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done - processCharacter updated')
