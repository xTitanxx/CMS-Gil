"use client";

import { PageHeader } from "@/app/admin/_shared/PageHeader";
import { TabNav } from "@/app/admin/_shared/TabNav";
import { AdminsTab } from "./tabs/AdminsTab";
import { EngagementTab } from "./tabs/EngagementTab";
import { NotificationsTab } from "./tabs/NotificationsTab";
import ConnectionsPage from "../connections/ConnectionsPage";
import ImportPage from "../import/ImportPage";
import { SubscribersListClient } from "../subscribers/SubscribersListClient";

const TABS = [
  { id: "admins", label: "Admins" },
  { id: "subscribers", label: "Subscribers" },
  { id: "connections", label: "Connections" },
  { id: "import", label: "Import" },
  { id: "notifications", label: "Notifications" },
  { id: "engagement", label: "Engagement" },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface Props {
  activeTab: TabId;
}

export default function SettingsPage({ activeTab }: Props) {
  return (
    <div className="px-6 py-8">
      <PageHeader
        title="Settings"
        subtitle="Manage admins, subscribers, platform connections, imports, notifications, and engagement."
      />

      <TabNav
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, href: `/admin/settings?tab=${t.id}` }))}
        activeId={activeTab}
        className="-mb-px flex-wrap"
      />

      <div className="mt-6">
        {activeTab === "admins" && <AdminsTab />}
        {activeTab === "subscribers" && <SubscribersListClient />}
        {activeTab === "connections" && <ConnectionsPage />}
        {activeTab === "import" && <ImportPage />}
        {activeTab === "notifications" && <NotificationsTab />}
        {activeTab === "engagement" && <EngagementTab />}
      </div>
    </div>
  );
}
