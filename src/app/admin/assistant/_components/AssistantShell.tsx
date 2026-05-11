"use client";

import { useCallback, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { ThreadView } from "./ThreadView";
import { PlannerPanel, type PlannerPanelHandle } from "../../_shared/PlannerPanel";

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
        } md:flex relative w-full min-h-0 flex-1 flex-col overflow-hidden border-r border-gray-200 bg-white md:w-[440px] md:flex-none md:shrink-0`}
      >
        <div className="flex-1 overflow-hidden">
          <PlannerPanel ref={plannerRef} />
        </div>

        {/* Floating "back to chat" button — mobile only */}
        <button
          onClick={() => setTab("chat")}
          className="absolute right-2 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#0d0d0d] ring-1 ring-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_6px_18px_rgba(0,0,0,0.18)] backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55 hover:bg-white/85 active:bg-white/90 md:hidden"
          style={{ top: "max(env(safe-area-inset-top, 0px), 0.5rem)" }}
          aria-label="Back to assistant"
          title="Back to assistant"
        >
          <MessageSquare className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </aside>

      {/* Chat — right on desktop, swappable on mobile */}
      <main
        className={`${
          tab === "chat" ? "flex" : "hidden"
        } md:flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden`}
      >
        <ThreadView onPlanProposed={handlePlanProposed} onOpenPlanner={handleOpenPlanner} />
      </main>
    </div>
  );
}
