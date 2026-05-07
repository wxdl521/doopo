import { useState, useRef } from 'react'
import { Loader2, Sparkles, Send, Download, Palette, BookOpen, Star, Shirt, SmilePlus, Eye } from 'lucide-react'
import { useServerFn } from '@tanstack/react-start'
import { useLanguage } from '../i18n/LanguageContext'
import { generateScript } from '../lib/openrouter.functions'
import { generateImage } from '../lib/openrouterImage.functions'

type Message = { role: string; text: string }
type Tab = 'front' | 'side' | 'back' | 'expression' | 'accessory'

const VIEWS = ['front', 'side', 'back', 'expression', 'accessory'] as Tab[]

export default function Characters() {
  const { t, lang } = useLanguage()
  const callGenerateText = useServerFn(generateScript)
  const callGenerateImage = useServerFn(generateImage)

  const [messages, setMessages] = useState<Message[]>([
    { role: 'art-director', text: t.characters_initial_msg },
  ])
  const [description, setDescription] = useState('')
  const styles = [
    { key: 'Visual Novel', label: t.char_style_vn },
    { key: 'Chibi', label: t.char_style_chibi },
    { key: 'Ethereal Gothic', label: t.char_style_gothic },
    { key: 'Realistic', label: t.char_style_realistic },
    { key: 'Anime', label: t.char_style_anime },
  ]
  const [selectedStyle, setSelectedStyle] = useState('Visual Novel')
  const [generatedImages, setGeneratedImages] = useState<Record<Tab, string>>({ front: '', side: '', back: '', expression: '', accessory: '' })
  const [selectedImage, setSelectedImage] = useState<Tab>('front')
  const [activeTab, setActiveTab] = useState<Tab>('front')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const scrollBottom = () => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  const handleGenerate = async () => {
    if (!description.trim()) return
    const desc = description
    const userPrompt = lang === 'zh'
      ? `作为专业角色设计师，根据以下描述为角色撰写详细设定（外貌、性格、背景、服装配饰），用中文，200字以内：\n${desc}`
      : `As a professional character designer, write a detailed character profile (appearance, personality, background, costumes and accessories) in English, within 200 words, based on the following description:\n${desc}`
    setLoading(true)
    setError('')
    const userMsg = { role: 'user', text: desc }
    setMessages(prev => [...prev, userMsg])
    setDescription('')
    scrollBottom()

    try {
      const textRes = await callGenerateText({
        data: {
          messages: [
            { role: 'system', content: t.char_system_designer },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 600,
          temperature: 0.85,
        },
      })
      if (textRes.error && !textRes.content) {
        setError(textRes.error)
      }
      const reply = textRes.content || t.char_generation_failed
      setMessages(prev => [...prev, { role: 'art-director', text: reply }])

      // Generate 5 view images in parallel
      const views: Tab[] = ['front', 'side', 'back', 'expression', 'accessory']
      const viewMap: Record<Tab, string> = {
        front: 'full body front view',
        side: 'full body side profile view',
        back: 'full body back view',
        expression: 'facial expression close-up portrait',
        accessory: 'character accessory and costume detail view',
      }
      const imgResults = await Promise.allSettled(
        views.map(async (v) => {
          const prompt = `Character portrait, ${selectedStyle} style, ${desc}, ${viewMap[v]}, clean background, high quality illustration`
          const r = await callGenerateImage({ data: { prompt } })
          return { view: v, url: r.url, error: r.error }
        }),
      )

      const newImages = { ...generatedImages }
      let firstFilled: Tab | null = null
      let imgError = ''
      imgResults.forEach((r) => {
        if (r.status === 'fulfilled') {
          if (r.value.url) {
            newImages[r.value.view] = r.value.url
            if (!firstFilled) firstFilled = r.value.view
          } else if (r.value.error) {
            imgError = r.value.error
          }
        } else {
          imgError = r.reason?.message || imgError
        }
      })
      setGeneratedImages(newImages)
      if (firstFilled) {
        setSelectedImage(firstFilled)
        setActiveTab(firstFilled)
      } else if (imgError) {
        setError(t.char_image_generation_failed || imgError)
      }
    } catch (e: any) {
      setError(e.message || 'Error')
    } finally {
      setLoading(false)
      scrollBottom()
    }
  }

  const copyPalette = () => {
    const colors = ['#59C9D5', '#83CBA4', '#B5D684', '#e8f0f6', '#1a3530']
    navigator.clipboard.writeText(colors.join(', '))
  }

  const artDirectorMsgs = messages.filter(m => m.role === 'art-director')

  return (
    <div className="flex flex-col lg:flex-row gap-6 animate-fade-in" style={{ minHeight: 'calc(100vh - 120px)' }}>
      {/* Left: Chat Panel */}
      <div className="lg:w-[380px] flex flex-col panel p-5 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-emerald-500 flex items-center justify-center">
            <Sparkles size={18} className="text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-text-primary">{t.characters_title}</h2>
            <p className="text-xs text-text-muted">{t.characters_subtitle}</p>
          </div>
        </div>

        {/* Style selector */}
        <div>
          <label className="text-xs font-medium text-text-muted mb-2 block">{t.char_style}</label>
          <div className="flex flex-wrap gap-2">
            {styles.map(s => (
              <button
            key={s.key}
            onClick={() => setSelectedStyle(s.key)}
            className={`chip text-xs ${selectedStyle === s.key ? 'chip-active' : ''}`}
              >
            {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 max-h-[360px] pr-1">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {msg.role === 'art-director' && (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-emerald-500 flex items-center justify-center flex-shrink-0 mt-1">
                  <Sparkles size={14} className="text-white" />
                </div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'art-director'
                  ? 'bg-bg-elevated text-text-primary rounded-tl-md'
                  : 'bg-accent-dim text-text-primary rounded-tr-md'
              }`}>
                {msg.text}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="space-y-2">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate() } }}
            placeholder={t.char_desc_hint}
            rows={3}
            className="w-full rounded-xl bg-bg-elevated border border-border text-sm text-text-primary p-3 resize-none focus:outline-none focus:border-accent/50 transition placeholder:text-text-muted"
          />
          <button
            onClick={handleGenerate}
            disabled={loading || !description.trim()}
            className="w-full btn-primary justify-center disabled:opacity-40"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {loading ? t.char_generating : t.char_generate}
          </button>
          {error && <p className="text-xs text-red-400 text-center">{error}</p>}
        </div>
      </div>

      {/* Right: Canvas */}
      <div className="flex-1 panel p-6 space-y-5">
        {Object.values(generatedImages).some(Boolean) ? (
          <>
            {/* View Tabs */}
            <div className="flex gap-2 flex-wrap">
              {VIEWS.map(v => (
                <button
                  key={v}
                  onClick={() => { setActiveTab(v); if (generatedImages[v]) setSelectedImage(v) }}
                  className={`chip text-xs ${activeTab === v && generatedImages[v] ? 'chip-active' : ''}`}
                >
                  {v === 'front' && <Eye size={12} />}
                  {v === 'side' && <Shirt size={12} />}
                  {v === 'back' && <BookOpen size={12} />}
                  {v === 'expression' && <SmilePlus size={12} />}
                  {v === 'accessory' && <Star size={12} />}
                  {t[`char_view_${v}` as keyof typeof t] ?? v}
                </button>
              ))}
            </div>

            {/* Main Image */}
            <div className="relative rounded-2xl overflow-hidden border border-border bg-bg-elevated corner-frame">
              {generatedImages[selectedImage] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={generatedImages[selectedImage]}
                  alt={selectedImage}
                  className="w-full max-h-[480px] object-contain"
                />
              ) : (
                <div className="w-full h-64 flex items-center justify-center text-text-muted text-sm">
                  {loading ? t.char_generating : t.char_no_generate}
                </div>
              )}
            </div>

            {/* Thumbnails */}
            <div className="flex gap-3">
              {VIEWS.map(v => (
                generatedImages[v] && (
                  <button
                    key={v}
                    onClick={() => setSelectedImage(v)}
                    className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                      selectedImage === v ? 'border-accent scale-105' : 'border-border hover:border-accent/40'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={generatedImages[v]} alt={v} className="w-20 h-20 object-cover" />
                  </button>
                )
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={copyPalette}
                className="btn-ghost text-xs"
              >
                <Palette size={14} />
                {t.char_copy_palette}
              </button>
              {generatedImages[selectedImage] && (
                <a
                  href={generatedImages[selectedImage]}
                  download={`character-${selectedImage}.png`}
                  className="btn-ghost text-xs"
                >
                  <Download size={14} />
                  {t.char_download}
                </a>
              )}
            </div>

            {/* Color Palette */}
            <div>
              <p className="text-xs font-medium text-text-muted mb-2">{t.char_color_palette}</p>
              <div className="flex gap-2">
                {['#59C9D5', '#83CBA4', '#B5D684', '#e8f0f6', '#1a3530'].map(c => (
                  <button
                    key={c}
                    onClick={() => navigator.clipboard.writeText(c)}
                    className="w-9 h-9 rounded-lg border border-border shadow-sm hover:scale-110 transition"
                    style={{ background: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>

            {/* Description */}
            {artDirectorMsgs[artDirectorMsgs.length - 1] && (
              <div className="bg-bg-elevated rounded-xl p-4">
                <p className="text-xs font-medium text-text-muted mb-2">{t.char_desc}</p>
                <p className="text-sm text-text-secondary leading-relaxed">
                  {artDirectorMsgs[artDirectorMsgs.length - 1].text}
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-20 space-y-4">
            <div className="w-20 h-20 rounded-full bg-bg-elevated border border-border flex items-center justify-center">
              <BookOpen size={32} className="text-text-muted" />
            </div>
            <div className="space-y-1">
              <p className="text-text-secondary font-medium">{t.characters_title}</p>
              <p className="text-sm text-text-muted">{t.char_no_generate}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
