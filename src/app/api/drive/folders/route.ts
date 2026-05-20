import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { google } from "googleapis";
import { buildGoogleOAuthClient, getGoogleIntegration } from "@/lib/google-integration";

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integration = await getGoogleIntegration(session.user.id);
  if (!integration) {
    return NextResponse.json(
      { error: "Google account not connected" },
      { status: 400 }
    );
  }

  const oauth2Client = buildGoogleOAuthClient(session.user.id, integration);
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  const res = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: "files(id, name, modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return NextResponse.json({ folders: res.data.files ?? [] });
}
