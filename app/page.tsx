export default function Home() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="label-caps">Hearth Studio</p>
      <h1 className="font-display text-5xl text-ink" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 40' }}>
        Design a home with your agent
      </h1>
      <p className="max-w-md text-ink-muted">
        The studio is being built. Rooms, furniture and WebMCP tools arrive here shortly.
      </p>
    </main>
  );
}
