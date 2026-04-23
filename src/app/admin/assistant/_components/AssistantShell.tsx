"use client";

import { useState } from "react";
import { MessageSquare, CalendarDays } from "lucide-react";
import { ThreadView } from "./ThreadView";
import { PlannerPanel } from "./PlannerPanel";

type Tab = "chat" | "plan";

export function AssistantShell() {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col md:flex-row">
      {/* Mobile tab bar */}
      <div className="flex shrink-0 border-b border-gray-200 bg-white md:hidden">
        {(["chat", "plan"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "chat" ? (
              <MessageSquare className="h-4 w-4" />
            ) : (
              <CalendarDays className="h-4 w-4" />
            )}
            {t === "chat" ? "Chat" : "Week Plan"}
          </button>
        ))}
      </div>

      {/* Planner panel — left on desktop, swappable on mobile */}
      <aside
        className={`${
          tab === "plan" ? "flex" : "hidden"
        } md:flex w-full flex-col overflow-hidden border-r border-gray-200 bg-white md:w-[440px] md:shrink-0`}
      >
        <div className="flex-1 overflow-hidden p-3">
          <PlannerPanel />
        </div>
      </aside>

      {/* Chat — right on desktop, swappable on mobile */}
      <main
        className={`${
          tab === "chat" ? "flex" : "hidden"
        } md:flex min-w-0 flex-1 flex-col overflow-hidden`}
      >
        <ThreadView />
      </main>
    </div>
  );
}
