export default function AssistantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-x-0 top-0 z-10 bg-white md:left-60"
      style={{ height: "100dvh" }}
    >
      {children}
    </div>
  );
}
