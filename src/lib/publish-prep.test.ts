import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/storage", () => ({
  getObject: vi.fn(),
  uploadBuffer: vi.fn(),
  mediaKey: vi.fn((userId: string, filename: string) => `media/${userId}/${filename}`),
}));
vi.mock("@/lib/video-processing", () => ({
  mixAudioOntoVideo: vi.fn(),
}));

import { preparePublishKeys } from "./publish-prep";
import { getObject, uploadBuffer } from "@/lib/storage";
import { mixAudioOntoVideo } from "@/lib/video-processing";

const mockGetObject = vi.mocked(getObject);
const mockUploadBuffer = vi.mocked(uploadBuffer);
const mockMixAudio = vi.mocked(mixAudioOntoVideo);

describe("preparePublishKeys", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes non-video media through unchanged", async () => {
    const out = await preparePublishKeys("user1", [
      { storageKey: "https://r2.example/photo.jpg", mimeType: "image/jpeg", hasAudio: null },
    ]);
    expect(out).toEqual(["https://r2.example/photo.jpg"]);
    expect(mockMixAudio).not.toHaveBeenCalled();
  });

  it("passes a video with audio through unchanged", async () => {
    const out = await preparePublishKeys("user1", [
      { storageKey: "https://r2.example/video.mp4", mimeType: "video/mp4", hasAudio: true },
    ]);
    expect(out).toEqual(["https://r2.example/video.mp4"]);
    expect(mockMixAudio).not.toHaveBeenCalled();
  });

  it("passes a silent video with no attached track through unchanged", async () => {
    const out = await preparePublishKeys("user1", [
      { storageKey: "https://r2.example/video.mp4", mimeType: "video/mp4", hasAudio: false, audioTrack: null },
    ]);
    expect(out).toEqual(["https://r2.example/video.mp4"]);
    expect(mockMixAudio).not.toHaveBeenCalled();
  });

  it("muxes a silent video with an attached track and uploads it as video/mp4, regardless of the original mimeType", async () => {
    mockGetObject.mockResolvedValue(Buffer.from("bytes"));
    mockMixAudio.mockResolvedValue(Buffer.from("muxed-mp4-bytes"));
    mockUploadBuffer.mockResolvedValue({ url: "https://r2.example/muxed.mp4" } as never);

    const out = await preparePublishKeys("user1", [
      {
        storageKey: "https://r2.example/video.mov",
        mimeType: "video/quicktime",
        hasAudio: false,
        audioTrack: { storageKey: "https://r2.example/song.mp3" },
      },
    ]);

    expect(out).toEqual(["https://r2.example/muxed.mp4"]);
    expect(mockUploadBuffer).toHaveBeenCalledWith(
      expect.stringMatching(/\.mp4$/),
      Buffer.from("muxed-mp4-bytes"),
      { contentType: "video/mp4" },
    );
  });
});
