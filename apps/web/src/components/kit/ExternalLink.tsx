import { ExternalIcon } from "@/components/icons";

export function ExternalLink({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="link inline-flex max-w-full items-baseline gap-1 break-all">
      {children ?? href}
      <ExternalIcon className="shrink-0 self-center" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
