export type RetrievalErrorCode =
  | "INVALID_URL"
  | "BLOCKED_URL"
  | "TIMEOUT"
  | "NETWORK"
  | `HTTP_${number}`
  | "TOO_MANY_REDIRECTS"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "ROBOTS_DISALLOWED"
  | "UNREACHABLE";

export class RetrievalError extends Error {
  constructor(
    public code: RetrievalErrorCode,
    message: string,
    public url: string,
  ) {
    super(message);
    this.name = "RetrievalError";
  }
}
