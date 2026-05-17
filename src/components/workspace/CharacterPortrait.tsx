import type { GenCharacter } from '../../data/workspaceGenerators'

import linxiaFront from '@/assets/characters/linxia-front.jpg'
import linxiaSide from '@/assets/characters/linxia-side.jpg'
import linxiaBack from '@/assets/characters/linxia-back.jpg'
import linxiaExpr from '@/assets/characters/linxia-expression.jpg'
import jiangyeFront from '@/assets/characters/jiangye-front.jpg'
import jiangyeSide from '@/assets/characters/jiangye-side.jpg'
import jiangyeBack from '@/assets/characters/jiangye-back.jpg'
import jiangyeExpr from '@/assets/characters/jiangye-expression.jpg'
import mengmengFront from '@/assets/characters/mengmeng-front.jpg'
import mengmengSide from '@/assets/characters/mengmeng-side.jpg'
import mengmengBack from '@/assets/characters/mengmeng-back.jpg'
import mengmengExpr from '@/assets/characters/mengmeng-expression.jpg'
import zhouxueFront from '@/assets/characters/zhouxue-front.jpg'
import zhouxueSide from '@/assets/characters/zhouxue-side.jpg'
import zhouxueBack from '@/assets/characters/zhouxue-back.jpg'
import zhouxueExpr from '@/assets/characters/zhouxue-expression.jpg'

export type PortraitView = 'front' | 'side' | 'back' | 'expression'

type Props = {
  character: GenCharacter
  className?: string
  view?: PortraitView
}

const PORTRAITS: Record<string, Record<PortraitView, string>> = {
  'gen-ch-linxia': { front: linxiaFront, side: linxiaSide, back: linxiaBack, expression: linxiaExpr },
  'gen-ch-jiangye': { front: jiangyeFront, side: jiangyeSide, back: jiangyeBack, expression: jiangyeExpr },
  'gen-ch-mengmeng': { front: mengmengFront, side: mengmengSide, back: mengmengBack, expression: mengmengExpr },
  'gen-ch-zhouxue': { front: zhouxueFront, side: zhouxueSide, back: zhouxueBack, expression: zhouxueExpr },
}

export default function CharacterPortrait({ character, className, view = 'front' }: Props) {
  const src = PORTRAITS[character.id]?.[view]
  const accent = character.palette[2] ?? character.palette[0] ?? '#fbbf24'

  if (!src) {
    return (
      <div className={className} style={{ background: character.swatch }} aria-label={character.name} />
    )
  }

  // Full-figure views use contain to keep the whole character visible and centered.
  // Expression view zooms into the face via cover + tuned object-position.
  const isExpression = view === 'expression'
  const fit = isExpression ? 'object-cover' : 'object-contain'
  const objectPosition = isExpression ? 'center 22%' : 'center center'

  return (
    <div
      className={`relative overflow-hidden ${className ?? ''}`}
      role="img"
      aria-label={`${character.name} ${view}`}
      style={{
        background: `radial-gradient(ellipse at 50% 35%, ${accent}26 0%, transparent 60%), linear-gradient(180deg, #0b0d12 0%, #05060a 100%)`,
      }}
    >
      <img
        src={src}
        alt={`${character.name} ${view}`}
        loading="lazy"
        width={768}
        height={1024}
        className={`absolute inset-0 w-full h-full ${fit}`}
        style={{ objectPosition }}
      />
      {/* Subtle vignette for depth without cutting the figure */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 50% 55%, transparent 60%, rgba(0,0,0,0.55) 100%)`,
        }}
      />
    </div>
  )
}
