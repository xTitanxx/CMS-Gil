"use client";

import { useCallback, useRef, useState } from "react";
import { MessageSquare, CalendarDays } from "lucide-react";
import { ThreadView } from "./ThreadView";
import { PlannerPanel, type PlannerPanelHandle } from "./PlannerPanel";

type Tab = "chat" | "plan";

export function AssistantShell() {
  const [tab, setTab] = useState<Tab>("chat");
  const plannerRef = useRef<PlannerPanelHandle>(null);

  const handlePlanProposed = useCallback(() => {
    void plannerRef.current?.refresh();
    // Surface the result on mobile by switching to the planner tab.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      setTab("plan");
    }
  }, []);

  const handleOpenPlanner = useCallback(() => {
    setTab("plan");
    void plannerRef.current?.refresh();
  }, []);

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Planner panel — left on desktop, swappable on mobile */}
      <aside
        className={`${
          tab === "plan" ? "flex" : "hidden"
        } md:flex w-full min-h-0 flex-1 flex-col overflow-hidden border-r border-gray-200 bg-white md:w-[440px] md:flex-none md:shrink-0`}
      >
        <div className="flex-1 overflow-hidden p-3">
          <PlannerPanel ref={plannerRef} />
        </div>
      </aside>

      {/* Chat — right on desktop, swappable on mobile */}
      <main
        className={`${
          tab === "chat" ? "flex" : "hidden"
        } md:flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden`}
      >
        <ThreadView onPlanProposed={handlePlanProposed} onOpenPlanner={handleOpenPlanner} />
      </main>

      {/* Mobile bottom tab bar */}
      <div className="flex shrink-0 border-t border-gray-200 bg-white md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {(["chat", "plan"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
              tab === t
                ? "text-blue-600"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {t === "chat" ? (
              <MessageSquare className="h-5 w-5" />
            ) : (
              <CalendarDays className="h-5 w-5" />
            )}
            {t === "chat" ? "Chat" : "Planner"}
          </button>
        ))}
      </div>
    </div>
  );
}
