import { ContextRail } from "./_components/ContextRail";
import { ThreadView } from "./_components/ThreadView";

export default function AssistantPage() {
  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <ContextRail />
      <main className="flex-1 flex flex-col">
        <ThreadView />
      </main>
    </div>
  );
}
