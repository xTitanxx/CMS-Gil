export default function AssistantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-10 bg-white md:left-60">
      {children}
    </div>
  );
}
