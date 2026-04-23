import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth";

const DEV_FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#f97316"/><text x="32" y="44" font-family="system-ui,sans-serif" font-size="36" font-weight="700" fill="#fff" text-anchor="middle">D</text></svg>`,
  );

export const metadata: Metadata = {
  title: { default: "Gil Alter", template: "%s — Gil Alter" },
  description: "Archive of all posts by Gil Alter",
  icons:
    process.env.NODE_ENV === "development"
      ? { icon: DEV_FAVICON }
      : { apple: "/icon.jpg" },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-gray-50 font-sans">
        <SessionProvider session={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}
