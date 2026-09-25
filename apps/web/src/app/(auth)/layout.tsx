import { Wordmark } from "@/components/Wordmark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-sm">
        <Wordmark href="/login" />
        <main id="content" className="mt-10">
          <p className="text-pencil">
            prepkit reads a job description and the company&apos;s website, then builds a prep kit: the requirements,
            practice questions, flashcards and a day-by-day study plan.
          </p>
          {children}
        </main>
      </div>
    </div>
  );
}
