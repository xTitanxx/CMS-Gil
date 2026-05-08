import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobilePageHeader } from "@/components/layout/MobilePageHeader";

const DEV_ADMIN_FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="url(#g)"/><defs><linearGradient id="g" x1="0" y1="0" x2="32" y2="32"><stop stop-color="#f97316"/><stop offset="1" stop-color="#ef4444"/></linearGradient></defs><text x="16" y="23" font-family="system-ui,sans-serif" font-size="20" font-weight="800" fill="#fff" text-anchor="middle">L</text></svg>`,
  );

export const metadata: Metadata = {
  title: { default: "Content Hub", template: "%s — Content Hub" },
  icons:
    process.env.NODE_ENV === "development"
      ? { icon: DEV_ADMIN_FAVICON }
      : { icon: "/admin/icon" },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col md:h-screen md:flex-row md:overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-gray-900 focus:shadow focus:ring-2 focus:ring-blue-500"
      >
        Skip to content
      </a>
      <Sidebar />
      <main
        id="main-content"
        className="min-w-0 flex-1 overflow-y-auto overflow-x-clip bg-gray-50 md:p-8"
      >
        <MobilePageHeader />
        <div
          className="px-4 md:p-0"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
