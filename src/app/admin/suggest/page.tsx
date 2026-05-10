import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SuggesterClient } from "./SuggesterClient";

export const metadata = { title: "Suggester" };

export default async function SuggestPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  return <SuggesterClient />;
}
