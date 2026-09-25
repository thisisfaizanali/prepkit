import { NextResponse, type NextRequest } from "next/server";

// Presence check only: the API decides whether the session is valid, and the client's 401 handler covers the rest.
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has("prepkit_session");
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/kits") && !hasSession) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  if ((pathname === "/login" || pathname === "/register") && hasSession) {
    return NextResponse.redirect(new URL("/kits", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/kits", "/kits/:path*", "/login", "/register"] };
