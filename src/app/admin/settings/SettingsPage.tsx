"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { AdminsTab } from "./tabs/AdminsTab";
import { EngagementTab } from "./tabs/EngagementTab";
import ConnectionsPage from "../connections/ConnectionsPage";
import ImportPage from "../import/ImportPage";
import { SubscribersListClient } from "../subscribers/SubscribersListClient";

const TABS = [
  { id: "admins", label: "Admins" },
  { id: "subscribers", label: "Subscribers" },
  { id: "connections", label: "Connections" },
  { id: "import", label: "Import" },
  { id: "engagement", label: "Engagement" },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface Props {
  activeTab: TabId;
}

export default function SettingsPage({ activeTab }: Props) {
  return (
    <div className="px-6 py-8">
      <div className="mb-4">
        <h1 className="hidden text-2xl font-bold text-gray-900 md:block">
          Settings
        </h1>
        <p className="text-sm text-gray-500">
          Manage admins, subscribers, platform connections, imports, and engagement.
        </p>
      </div>

      <nav className="-mb-px flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/admin/settings?tab=${t.id}`}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              t.id === activeTab
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900"
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {activeTab === "admins" && <AdminsTab />}
        {activeTab === "subscribers" && <SubscribersListClient />}
        {activeTab === "connections" && <ConnectionsPage />}
        {activeTab === "import" && <ImportPage />}
        {activeTab === "engagement" && <EngagementTab />}
      </div>
    </div>
  );
}
