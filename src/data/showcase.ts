export type ShowcaseItem = {
  id: string
  title: string
  subtitle?: string
  category: 'Short Drama' | 'Advertisement' | 'Music Video' | 'Movie' | 'Animation' | "Children's Story" | 'Science'
  featured?: boolean
  // gradient backgrounds let us avoid bundling images
  gradient: string
  badge?: string
  duration?: string
}

export const showcase: ShowcaseItem[] = [
  {
    id: 'sorceress',
    title: 'The Heartless Sorceress',
    subtitle: 'Journey through the withered garden',
    category: 'Movie',
    featured: true,
    gradient: 'from-amber-700 via-rose-900 to-stone-950',
    badge: 'Featured',
    duration: '4m 32s',
  },
  {
    id: 'samurai',
    title: 'Wandering Blade',
    subtitle: 'A lone swordsman crosses the red sun',
    category: 'Animation',
    featured: true,
    gradient: 'from-rose-700 via-blue-800 to-indigo-950',
    duration: '3m 12s',
  },
  {
    id: 'arcane-tower',
    title: 'Arcane Tower',
    subtitle: 'The last cipher of the eldritch keep',
    category: 'Movie',
    featured: true,
    gradient: 'from-cyan-600 via-violet-700 to-slate-950',
    duration: '5m 04s',
  },
  {
    id: 'neon-noodles',
    title: 'Neon Noodles',
    subtitle: 'A late-night ramen ad with cyberpunk flair',
    category: 'Advertisement',
    gradient: 'from-fuchsia-600 via-purple-800 to-zinc-950',
    duration: '0m 28s',
  },
  {
    id: 'lullaby',
    title: 'Moonlight Lullaby',
    subtitle: 'A bedtime tale for tiny dreamers',
    category: "Children's Story",
    gradient: 'from-sky-500 via-indigo-600 to-violet-900',
    duration: '2m 11s',
  },
  {
    id: 'octopus-mind',
    title: 'Inside the Octopus Mind',
    subtitle: 'How nine brains see the ocean',
    category: 'Science',
    gradient: 'from-teal-500 via-cyan-700 to-slate-900',
    duration: '6m 48s',
  },
  {
    id: 'highrise',
    title: 'Highrise Heart',
    subtitle: 'Two strangers, one elevator, eight floors',
    category: 'Short Drama',
    gradient: 'from-orange-500 via-rose-700 to-zinc-950',
    duration: '3m 50s',
  },
  {
    id: 'voltage',
    title: 'Voltage',
    subtitle: 'A music video for an unreleased synthwave EP',
    category: 'Music Video',
    gradient: 'from-pink-500 via-purple-700 to-blue-950',
    duration: '3m 02s',
  },
  {
    id: 'paper-fox',
    title: 'Paper Fox',
    subtitle: 'Origami forest critters in stop-motion',
    category: 'Animation',
    gradient: 'from-emerald-500 via-teal-700 to-slate-900',
    duration: '1m 55s',
  },
  {
    id: 'first-flight',
    title: 'First Flight',
    subtitle: 'A robotics startup tells its origin story',
    category: 'Advertisement',
    gradient: 'from-amber-500 via-orange-700 to-zinc-900',
    duration: '1m 12s',
  },
]

export const showcaseFilters = [
  'Featured',
  'Short Drama',
  'Advertisement',
  'Music Video',
  'Movie',
  'Animation',
  "Children's Story",
  'Science',
  'All',
] as const

export type ShowcaseFilter = (typeof showcaseFilters)[number]
