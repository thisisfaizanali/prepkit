export function Difficulty({ level }: { level: number }) {
  return (
    <span className="mt-2 flex shrink-0 gap-[2px]">
      {[1, 2, 3].map((n) => (
        <span key={n} aria-hidden className={`block h-[8px] w-[8px] border border-graphite ${n <= level ? "bg-graphite" : ""}`} />
      ))}
      <span className="sr-only">Difficulty {level} of 3</span>
    </span>
  );
}
