import Link from "next/link";

export function Wordmark({ href = "/kits" }: { href?: string }) {
  return (
    <Link href={href} className="text-h3 font-extrabold tracking-[-0.01em] no-underline hover:underline">
      prepkit
    </Link>
  );
}
