import { KitPage } from "@/components/kit/KitPage";

export const metadata = { title: "Kit | prepkit" };

export default async function Page({ params }: PageProps<"/kits/[id]">) {
  const { id } = await params;
  return <KitPage id={id} />;
}
