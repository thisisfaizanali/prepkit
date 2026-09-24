import { promises as dns } from "node:dns";
import { BlockList, isIP } from "node:net";
import { RetrievalError } from "./errors.ts";

export function normalizeCompanyUrl(input: string): URL {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new RetrievalError("INVALID_URL", `Not a valid URL: "${input}"`, input);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RetrievalError("INVALID_URL", `Only http(s) URLs are supported, got ${url.protocol}`, input);
  }
  if (url.username || url.password) {
    throw new RetrievalError("INVALID_URL", "URLs with credentials are not allowed", input);
  }
  return url;
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["224.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::1", 128], ["::", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** IPv4-mapped IPv6 (::ffff:1.2.3.4 or ::ffff:102:304) → dotted IPv4, else undefined. */
function mappedIPv4(addr: string): string | undefined {
  const dotted = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1];
  const hex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return undefined;
  const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

export function isBlockedAddress(addr: string): boolean {
  const v4 = mappedIPv4(addr);
  if (v4) return blocked.check(v4, "ipv4");
  const family = isIP(addr);
  if (family === 4) return blocked.check(addr, "ipv4");
  if (family === 6) return blocked.check(addr, "ipv6");
  return true; // not an IP at all: refuse rather than guess
}

type Lookup = (host: string) => Promise<{ address: string }[]>;
const defaultLookup: Lookup = (host) => dns.lookup(host, { all: true });

// ponytail: DNS-rebinding between lookup and connect not handled; pin resolved IP via custom agent if needed.
export async function assertFetchable(
  url: URL,
  { allowPrivate, lookup = defaultLookup }: { allowPrivate: boolean; lookup?: Lookup },
): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RetrievalError("BLOCKED_URL", `Refusing non-http(s) URL ${url.href}`, url.href);
  }
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await lookup(host)).map((a) => a.address);
    } catch (e) {
      throw new RetrievalError("NETWORK", `DNS lookup failed for ${host}: ${(e as Error).message}`, url.href);
    }
  }
  const bad = addresses.find(isBlockedAddress);
  if (bad) throw new RetrievalError("BLOCKED_URL", `${host} resolves to a private or reserved address (${bad})`, url.href);
}
