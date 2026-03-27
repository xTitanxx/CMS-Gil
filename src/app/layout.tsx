import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "CMS Gil — Personal Content Hub",
  description: "Import, manage and publish your content across social platforms",
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
