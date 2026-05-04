import { auth, signOut } from "@/lib/auth";

export async function SubscriberHeader() {
  const session = await auth();
  if (!session || session.user.role !== "subscriber") return null;

  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2 text-sm">
        <span className="text-gray-700">
          Hi, <span className="font-semibold">{session.user.name}</span>
        </span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/welcome" });
          }}
        >
          <button type="submit" className="text-blue-600 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
