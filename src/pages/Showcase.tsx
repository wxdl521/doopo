import ShowcaseGrid from '../components/ShowcaseGrid'

export default function Showcase() {
  return (
    <div className="animate-fade-in">
      <div className="mb-8 max-w-3xl">
        <h1 className="font-display text-3xl md:text-4xl font-bold">Showcase</h1>
        <p className="text-text-secondary mt-2">
          Stories from the community — every render below was made with a single Doopoo prompt
          plus a Base or two. Hover for a play preview.
        </p>
      </div>
      <ShowcaseGrid initial="All" />
    </div>
  )
}
