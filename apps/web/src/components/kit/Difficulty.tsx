export function Difficulty({ level }: { level: number }) {
  return (
    <span className="mt-1.5 flex shrink-0 gap-0.5">
      {[1, 2, 3].map((n) => (
        <span key={n} aria-hidden className={`size-2 border border-graphite ${n <= level ? "bg-graphite" : ""}`} />
      ))}
      <span className="sr-only">Difficulty {level} of 3</span>
    </span>
  );
}
