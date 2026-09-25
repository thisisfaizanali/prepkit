import { NewKitForm } from "@/components/new-kit/NewKitForm";

export const metadata = { title: "New kit | prepkit" };

export default function Page() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-h1">New kit</h1>
      <p className="mt-3 text-pencil">
        Paste a job description and the company&apos;s website. Add more roles to build several kits at once.
      </p>
      <NewKitForm />
    </div>
  );
}
