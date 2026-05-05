import { auth } from "@/lib/auth";
import {
  InvalidCodeError,
  createSubscriber,
  listSubscribers,
} from "@/lib/subscribers/service";

async function requireAdmin() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return null;
  }
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const list = await listSubscribers();
  return Response.json({ subscribers: list });
}

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | {
        name?: string;
        email?: string | null;
        code?: string;
        monthlyBudgetUsd?: number;
      }
    | null;
  const name = body?.name?.trim();
  if (!name) return Response.json({ error: "Name required" }, { status: 400 });

  try {
    const result = await createSubscriber({
      name,
      email: body?.email ?? null,
      code: body?.code,
      createdById: session.user.id,
      monthlyBudgetUsd: body?.monthlyBudgetUsd,
    });
    return Response.json({ code: result.code, subscriber: result.subscriber });
  } catch (err) {
    if (err instanceof InvalidCodeError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
