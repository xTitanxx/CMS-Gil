import { auth } from "@/lib/auth";
import { regenerateCode } from "@/lib/subscribers/service";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const { code, subscriber } = await regenerateCode(id);
  return Response.json({ code, subscriber });
}
