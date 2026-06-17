import { useState } from 'react'
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

const FALLBACK_KEYS = ['gen-ch-linxia', 'gen-ch-jiangye', 'gen-ch-mengmeng', 'gen-ch-zhouxue'] as const

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export default function CharacterPortrait({ character, className, view = 'front' }: Props) {
  const [broken, setBroken] = useState(false)
  // Real character imagery first; for AI-generated or unknown IDs, deterministically
  // fall back to one of the bundled portraits so the UI never collapses to a flat swatch.
  const fallbackKey = FALLBACK_KEYS[hashString(character.id) % FALLBACK_KEYS.length]
  const builtInSrc = PORTRAITS[character.id]?.[view] ?? PORTRAITS[fallbackKey][view]
  const accent = character.palette[2] ?? character.palette[0] ?? '#fbbf24'

  // 如果内置头像加载失败(broken=true)，降级到纯色背景
  if (broken || !builtInSrc) {
    return (
      <div className={className} style={{ background: character.swatch }} aria-label={character.name} />
    )
  }

// Use contain so the image scales to fit without cropping, centered in the parent.
  const fit = 'object-contain'
  const objectPosition = 'center center'

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
        src={builtInSrc}
        alt={`${character.name} ${view}`}
        loading="lazy"
        width={768}
        height={1024}
        onError={() => setBroken(true)}
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
