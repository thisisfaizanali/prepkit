import type { KitView } from "@prepkit/shared";
import { ExternalLink } from "@/components/kit/ExternalLink";

const REASONS: Record<string, string> = {
  ROBOTS_DISALLOWED: "The site's robots.txt asks crawlers not to read this page.",
  TIMEOUT: "The page took too long to respond.",
  NETWORK: "The page couldn't be reached.",
  UNREACHABLE: "The site couldn't be reached.",
  INVALID_URL: "The address isn't a valid web address.",
  BLOCKED_URL: "The address points to a private network, which isn't allowed.",
  TOO_MANY_REDIRECTS: "The page redirected too many times.",
  UNSUPPORTED_CONTENT_TYPE: "The page isn't a web page (for example, a PDF or an image).",
  DUPLICATE: "Same content as a page already read.",
  OUT_OF_SCOPE_REDIRECT: "The page redirected to a different website.",
};

function reason(code: string): string {
  if (REASONS[code]) return REASONS[code];
  const http = /^HTTP_(\d+)$/.exec(code);
  if (http) return http[1] === "404" ? "The page doesn't exist (404)." : `The server returned an error (HTTP ${http[1]}).`;
  return code.charAt(0).toUpperCase() + code.slice(1);
}

export function SourcesSection({ kit }: { kit: KitView }) {
  const r = kit.research;
  const pages = kit.source.pages_used;
  return (
    <div className="max-w-[760px] space-y-8">
      <h2 className="text-h2">Sources</h2>
      <section>
        <h3 className="text-h3">Pages used</h3>
        {pages.length ? (
          <ul className="mt-2 space-y-1">
            {pages.map((p) => (
              <li key={p}>
                <ExternalLink href={p} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-pencil">No pages from the company&apos;s website were used.</p>
        )}
      </section>
      <section>
        <h3 className="text-h3">Public discussion</h3>
        {r?.discussion.length ? (
          <ul className="mt-2 space-y-3">
            {r.discussion.map((d) => (
              <li key={d.url}>
                <ExternalLink href={d.url}>{d.title || d.url}</ExternalLink>
                <p className="text-sm text-pencil">
                  {d.attribution === "domain"
                    ? "Linked to this company by its website address."
                    : "Linked to this company by name only, so it may refer to a different organisation."}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-pencil">No public interview discussion was found.</p>
        )}
      </section>
      {r && r.skipped.length > 0 && (
        <section>
          <h3 className="text-h3">Skipped</h3>
          <ul className="mt-2 space-y-3">
            {r.skipped.map((s, i) => (
              <li key={i}>
                <p className="break-all">{s.source === "search" ? "Public discussion search" : s.source}</p>
                <p className="text-sm text-pencil">{reason(s.reason)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
