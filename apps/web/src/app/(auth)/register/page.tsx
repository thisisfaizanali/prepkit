import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Create an account | prepkit" };

export default function Page() {
  return (
    <>
      <h1 className="mt-8 text-h2">Create an account</h1>
      <Suspense>
        <AuthForm mode="register" />
      </Suspense>
    </>
  );
}
