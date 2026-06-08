import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CharacterStage, { type CharacterStageView } from '../CharacterStage'
import type { GenCharacter } from '../../../data/workspaceGenerators'

const views: CharacterStageView[] = [
  { key: 'front', label: '正面' },
  { key: 'side', label: '侧面' },
  { key: 'back', label: '背面' },
  { key: 'expression', label: '表情' },
]

const character: GenCharacter = {
  episodeIndex: 1,
  id: 'gen-ch-linxia',
  name: '林夏',
  role: 'lead',
  roleLabel: '女主 · 高冷学霸',
  age: 17,
  gender: '女',
  faceDescription: '清秀瓜子脸，细框眼镜，齐耳短发乌黑柔顺',
  bodyDescription: '身高 165cm，体型纤细，姿态挺拔',
  clothingDescription: '校服外套半挂，内搭白色衬衫，深蓝色百褶裙',
  personality: '冷静理性、外冷内热',
  palette: ['#0f172a', '#475569', '#fbbf24'],
  swatch: 'linear-gradient(135deg,#0f172a,#fbbf24)',
}

function getTabs() {
  const tablist = screen.getByRole('tablist', { name: '角色视图切换' })
  return within(tablist).getAllByRole('tab')
}

describe('CharacterStage keyboard navigation', () => {
  it('exposes a tablist with two tabs and descriptive aria-labels', () => {
    render(<CharacterStage character={character} views={views} />)
    const [main, multi] = getTabs()
    expect(main).toHaveAttribute('aria-label', expect.stringContaining('主视图'))
    expect(main).toHaveAttribute('aria-label', expect.stringContaining(character.name))
    expect(multi).toHaveAttribute('aria-label', expect.stringContaining('多视图'))
    expect(main).toHaveAttribute('aria-selected', 'true')
    expect(multi).toHaveAttribute('aria-selected', 'false')
    expect(main).toHaveAttribute('tabindex', '0')
    expect(multi).toHaveAttribute('tabindex', '-1')
  })

  it('cycles selection and focus with ArrowRight / ArrowLeft', async () => {
    const user = userEvent.setup()
    render(<CharacterStage character={character} views={views} />)
    const [main, multi] = getTabs()

    main.focus()
    expect(main).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(multi).toHaveAttribute('aria-selected', 'true')
    expect(main).toHaveAttribute('aria-selected', 'false')
    expect(multi).toHaveFocus()

    // Wraps around back to main
    await user.keyboard('{ArrowRight}')
    expect(main).toHaveAttribute('aria-selected', 'true')
    expect(main).toHaveFocus()

    // ArrowLeft from first wraps to last
    await user.keyboard('{ArrowLeft}')
    expect(multi).toHaveAttribute('aria-selected', 'true')
    expect(multi).toHaveFocus()
  })

  it('jumps to first/last with Home / End', async () => {
    const user = userEvent.setup()
    render(<CharacterStage character={character} views={views} />)
    const [main, multi] = getTabs()

    main.focus()
    await user.keyboard('{End}')
    expect(multi).toHaveAttribute('aria-selected', 'true')
    expect(multi).toHaveFocus()

    await user.keyboard('{Home}')
    expect(main).toHaveAttribute('aria-selected', 'true')
    expect(main).toHaveFocus()
  })

  it('activates a tab with Enter and Space', async () => {
    const user = userEvent.setup()
    render(<CharacterStage character={character} views={views} />)
    const [main, multi] = getTabs()

    multi.focus()
    await user.keyboard('{Enter}')
    expect(multi).toHaveAttribute('aria-selected', 'true')
    // live region label reflects new mode
    expect(screen.getByRole('region')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('多视图'),
    )

    main.focus()
    await user.keyboard(' ')
    expect(main).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('主视图'),
    )
  })

  it('ignores unrelated keys without changing selection', async () => {
    const user = userEvent.setup()
    render(<CharacterStage character={character} views={views} />)
    const [main] = getTabs()
    main.focus()
    await user.keyboard('{ArrowUp}{ArrowDown}{Tab}')
    expect(main).toHaveAttribute('aria-selected', 'true')
  })
})