import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { RateQueue } from "./RateQueue";

export const metadata = { title: "Review Posts" };

export default async function RatePage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return (
    <div className="min-h-dvh bg-gray-50 text-gray-900">
      <RateQueue />
    </div>
  );
}
