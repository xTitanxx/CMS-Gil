import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { RateQueue } from "./RateQueue";

export default async function RatePage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  return (
    <div className="min-h-dvh bg-black text-white">
      <RateQueue />
    </div>
  );
}
