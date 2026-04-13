export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="flex h-full w-full max-w-xl flex-col">
        {children}
      </div>
    </div>
  );
}
