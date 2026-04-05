import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadBuffer(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  // Strip extension from public_id — Cloudinary appends the detected format automatically.
  // Without this, the stored public_id would include the extension (e.g. "file.jpg"),
  // causing URLs to resolve to "file.jpg.jpg" (double extension) → 404.
  const publicId = key.replace(/\.[^/.]+$/, "");
  await new Promise<void>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: "auto", type: "upload" },
      (error) => { if (error) reject(error); else resolve(); }
    );
    stream.end(body);
  });
}

export async function getSignedDownloadUrl(
  key: string,
  _expiresIn = 3600,
  mimeType?: string
): Promise<string> {
  const resourceType = mimeType?.startsWith("video") ? "video" : "image";
  // Strip extension — Cloudinary appends the format automatically; including it in
  // the public_id would produce a double-extension URL (e.g. file.jpg.jpg).
  const publicId = key.replace(/\.[^/.]+$/, "");
  return cloudinary.url(publicId, { resource_type: resourceType, type: "upload" });
}

export async function getObject(key: string): Promise<Buffer> {
  const url = cloudinary.url(key, { resource_type: "auto", type: "upload" });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${key}: ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string, mimeType?: string): Promise<void> {
  const publicId = key.replace(/\.[^/.]+$/, "");
  const resourceType = mimeType?.startsWith("video") ? "video" : "image";
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: "upload" });
}

export function mediaKey(userId: string, filename: string): string {
  return `media/${userId}/${Date.now()}-${filename}`;
}
