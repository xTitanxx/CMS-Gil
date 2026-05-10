import SettingsPage from "./SettingsPage";

export const metadata = { title: "Settings" };

const VALID_TABS = ["admins", "subscribers", "connections", "import", "notifications", "engagement"] as const;
type TabId = (typeof VALID_TABS)[number];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active: TabId = (VALID_TABS as readonly string[]).includes(tab ?? "")
    ? (tab as TabId)
    : "admins";
  return <SettingsPage activeTab={active} />;
}
