import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col md:h-screen md:flex-row md:overflow-hidden">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-clip bg-gray-50 p-4 md:p-8">{children}</main>
    </div>
  );
}
