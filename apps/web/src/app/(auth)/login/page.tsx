import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Log in | prepkit" };

export default function Page() {
  return (
    <>
      <h1 className="mt-8 text-h2">Log in</h1>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </>
  );
}
