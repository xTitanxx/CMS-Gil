import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";

const DEV_FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#f97316"/><text x="32" y="44" font-family="system-ui,sans-serif" font-size="36" font-weight="700" fill="#fff" text-anchor="middle">D</text></svg>`,
  );

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Scoped to browser tabs only. In iOS standalone PWAs, an unscoped
  // theme-color overrides apple-mobile-web-app-status-bar-style:black-translucent
  // and paints an opaque bar behind the clock/wifi/battery.
  themeColor: [{ media: "(display-mode: browser)", color: "#f9fafb" }],
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://gilalter.com"),
  title: { default: "Gil Alter", template: "%s — Gil Alter" },
  description: "Archive of all posts by Gil Alter",
  icons:
    process.env.NODE_ENV === "development"
      ? { icon: DEV_FAVICON }
      : { icon: "/icon-192.png", apple: "/icon.jpg" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Gil Alter",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <html lang="en" className="h-full antialiased" style={{ backgroundColor: "#ffffff" }}>
      <body className="min-h-full bg-white font-sans" style={{ backgroundColor: "#ffffff" }}>
        <SessionProvider session={session}>{children}</SessionProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
