import { auth } from "@/lib/auth";
import {
  updateSubscriber,
  deleteSubscriber,
} from "@/lib/subscribers/service";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    monthlyBudgetUsd?: number;
    revoked?: boolean;
  };
  const updated = await updateSubscriber(id, body);
  return Response.json({ subscriber: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  await deleteSubscriber(id);
  return Response.json({ ok: true });
}
