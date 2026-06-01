export type ShowcaseItem = {
  id: string
  title: string
  subtitle?: string
  category: 'Short Drama' | 'Advertisement' | 'Music Video' | 'Movie' | 'Animation' | "Children's Story" | 'Science'
  featured?: boolean
  // Tailwind gradient classes (fallback) OR absolute image URL (http/https)
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
    gradient: 'https://images.unsplash.com/photo-1502134249126-9f3755a50d78?w=1200&h=750&fit=crop&q=80',
    badge: 'Featured',
    duration: '4m 32s',
  },
  {
    id: 'samurai',
    title: 'Wandering Blade',
    subtitle: 'A lone swordsman crosses the red sun',
    category: 'Animation',
    featured: true,
    gradient: 'https://images.unsplash.com/photo-1614728263952-84ea256f9679?w=1200&h=750&fit=crop&q=80',
    duration: '3m 12s',
  },
  {
    id: 'arcane-tower',
    title: 'Arcane Tower',
    subtitle: 'The last cipher of the eldritch keep',
    category: 'Movie',
    featured: true,
    gradient: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&h=750&fit=crop&q=80',
    duration: '5m 04s',
  },
  {
    id: 'neon-noodles',
    title: 'Neon Noodles',
    subtitle: 'A late-night ramen ad with cyberpunk flair',
    category: 'Advertisement',
    gradient: 'https://images.unsplash.com/photo-1557872943-16a5ac26437e?w=1200&h=750&fit=crop&q=80',
    duration: '0m 28s',
  },
  {
    id: 'lullaby',
    title: 'Moonlight Lullaby',
    subtitle: 'A bedtime tale for tiny dreamers',
    category: "Children's Story",
    gradient: 'https://images.unsplash.com/photo-1532012197267-da84d127e765?w=1200&h=750&fit=crop&q=80',
    duration: '2m 11s',
  },
  {
    id: 'octopus-mind',
    title: 'Inside the Octopus Mind',
    subtitle: 'How nine brains see the ocean',
    category: 'Science',
    gradient: 'https://images.unsplash.com/photo-1551244072-5d12893278ab?w=1200&h=750&fit=crop&q=80',
    duration: '6m 48s',
  },
  {
    id: 'highrise',
    title: 'Highrise Heart',
    subtitle: 'Two strangers, one elevator, eight floors',
    category: 'Short Drama',
    gradient: 'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=1200&h=750&fit=crop&q=80',
    duration: '3m 50s',
  },
  {
    id: 'voltage',
    title: 'Voltage',
    subtitle: 'A music video for an unreleased synthwave EP',
    category: 'Music Video',
    gradient: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1200&h=750&fit=crop&q=80',
    duration: '3m 02s',
  },
  {
    id: 'paper-fox',
    title: 'Paper Fox',
    subtitle: 'Origami forest critters in stop-motion',
    category: 'Animation',
    gradient: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1200&h=750&fit=crop&q=80',
    duration: '1m 55s',
  },
  {
    id: 'first-flight',
    title: 'First Flight',
    subtitle: 'A robotics startup tells its origin story',
    category: 'Advertisement',
    gradient: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&h=750&fit=crop&q=80',
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
