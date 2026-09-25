"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { FieldError } from "@/components/FieldError";
import { ApiError } from "@/lib/api";
import { takeNotice } from "@/lib/notice";
import { useLogin, useRegister } from "@/lib/queries";

const Schema = z.object({
  email: z.string().trim().pipe(z.email("Enter an email address, like you@example.com.")),
  password: z.string().min(8, "Use at least 8 characters."),
});
type Errors = Partial<Record<"email" | "password", string>>;

/** Only same-site paths: never follow an absolute or protocol-relative `next`. */
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/kits");

function serverMessage(e: unknown, mode: "login" | "register"): string {
  if (!(e instanceof ApiError)) return "Something went wrong. Try again.";
  if (e.code === "INVALID_CREDENTIALS") return "That email and password don't match an account. Check them and try again.";
  if (e.code === "EMAIL_TAKEN") return "An account with this email already exists. Log in instead.";
  if (e.code === "RATE_LIMITED") return "Too many attempts. Wait a minute, then try again.";
  if (e.code === "NETWORK") return e.message;
  return mode === "login" ? `Couldn't log in: ${e.message}` : `Couldn't create the account: ${e.message}`;
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const login = useLogin();
  const register = useRegister();
  const mutation = mode === "login" ? login : register;
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNoticeText] = useState<string | null>(null);

  useEffect(() => setNoticeText(takeNotice()), []);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = Schema.safeParse(data);
    if (!parsed.success) {
      const errs: Errors = {};
      for (const i of parsed.error.issues) errs[i.path[0] as keyof Errors] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    mutation.mutate(parsed.data, { onSuccess: () => router.replace(next) });
  };

  const otherHref = `${mode === "login" ? "/register" : "/login"}${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
      {notice && <p className="notice">{notice}</p>}
      <div>
        <label htmlFor="email" className="block font-semibold">
          Email
        </label>
        <input
          id="email" name="email" type="email" autoComplete="email" className="field mt-1"
          aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined}
        />
        <FieldError id="email-error" message={errors.email} />
      </div>
      <div>
        <label htmlFor="password" className="block font-semibold">
          Password
        </label>
        <input
          id="password" name="password" type="password" className="field mt-1"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          aria-invalid={!!errors.password} aria-describedby={errors.password ? "password-error" : "password-hint"}
        />
        {mode === "register" && !errors.password && (
          <p id="password-hint" className="mt-1 text-sm text-pencil">At least 8 characters.</p>
        )}
        <FieldError id="password-error" message={errors.password} />
      </div>
      <div aria-live="polite" className="text-alert">
        {mutation.isError && <p>{serverMessage(mutation.error, mode)}</p>}
      </div>
      <button type="submit" className="btn w-full justify-center" disabled={mutation.isPending}>
        {mode === "login" ? (mutation.isPending ? "Logging in" : "Log in") : mutation.isPending ? "Creating account" : "Create account"}
      </button>
      <p className="text-sm text-pencil">
        {mode === "login" ? "No account yet? " : "Already have an account? "}
        <Link href={otherHref} className="link text-graphite">
          {mode === "login" ? "Create one" : "Log in"}
        </Link>
      </p>
    </form>
  );
}
