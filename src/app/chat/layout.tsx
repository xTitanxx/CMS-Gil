export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-10 bg-gray-50" style={{ height: "100dvh" }}>
      {children}
    </div>
  );
}
