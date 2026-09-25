import type { KitView } from "@prepkit/shared";

export function FlashcardsSection({ kit }: { kit: KitView }) {
  return (
    <div className="max-w-[760px]">
      <h2 className="text-h2">Flashcards</h2>
      {kit.flashcards.length === 0 ? (
        <p className="mt-3 text-pencil">This kit has no flashcards.</p>
      ) : (
        <ol className="mt-4 border-t border-line">
          {kit.flashcards.map((f) => (
            <li key={f.id} className="border-b border-line py-4">
              <p className="font-semibold">{f.front}</p>
              <details className="mt-2">
                <summary className="text-sm text-pencil">Show answer</summary>
                <p className="mt-2 whitespace-pre-line">{f.back}</p>
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
