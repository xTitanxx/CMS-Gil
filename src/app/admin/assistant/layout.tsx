export default function AssistantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-10 bg-white top-[calc(env(safe-area-inset-top,0px)+3rem)] md:left-60 md:top-0"
    >
      {children}
    </div>
  );
}
