import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postToThreads } from "./threads";

// Stub the storage signing — every key maps to a deterministic URL.
vi.mock("@/lib/storage", () => ({
  getSignedDownloadUrl: vi.fn(async (key: string) => `https://r2.example.com/${key}`),
}));

// Stub fetchWithTimeout in a way that we can drive per-call responses.
type FetchResponse = { json: () => Promise<unknown> };
const fetchQueue: FetchResponse[] = [];
function enqueue(response: unknown) {
  fetchQueue.push({ json: async () => response });
}

vi.mock("@/lib/platforms/_fetch", () => ({
  fetchWithTimeout: vi.fn(async () => {
    const next = fetchQueue.shift();
    if (!next) throw new Error("fetchQueue exhausted — test forgot to enqueue a response");
    return next;
  }),
}));

const CREDS = { accessToken: "TOK", platformUserId: "USER1" };

beforeEach(() => {
  fetchQueue.length = 0;
});

afterEach(() => {
  if (fetchQueue.length > 0) {
    throw new Error(`fetchQueue not drained — ${fetchQueue.length} unused responses`);
  }
});

describe("postToThreads", () => {
  it("posts a text-only thread", async () => {
    enqueue({ id: "C1" }); // createTextContainer
    enqueue({ id: "M1" }); // publishContainer
    enqueue({ permalink: "https://threads.net/@u/post/M1" }); // permalink lookup

    const result = await postToThreads(CREDS, "hello world", []);

    expect(result).toEqual({
      platformPostId: "M1",
      platformUrl: "https://threads.net/@u/post/M1",
    });
  });

  it("posts a single image, waiting for the container", async () => {
    enqueue({ id: "C2" }); // createImageContainer
    enqueue({ status: "IN_PROGRESS" }); // first poll
    enqueue({ status: "FINISHED" }); // second poll
    enqueue({ id: "M2" }); // publish
    enqueue({ permalink: "https://threads.net/@u/post/M2" });

    const result = await postToThreads(CREDS, "caption", ["uploads/photo.jpg"]);
    expect(result.platformPostId).toBe("M2");
  });

  it("posts a single video, waiting for FINISHED", async () => {
    enqueue({ id: "C3" }); // createVideoContainer
    enqueue({ status: "IN_PROGRESS" });
    enqueue({ status: "FINISHED" });
    enqueue({ id: "M3" }); // publish
    enqueue({ permalink: "https://threads.net/@u/post/M3" });

    const result = await postToThreads(CREDS, "video", ["uploads/clip.mp4"]);
    expect(result.platformPostId).toBe("M3");
  });

  it("posts a carousel, waiting for each child then the parent", async () => {
    enqueue({ id: "child1" }); // createImageContainer #1 (carousel item)
    enqueue({ id: "child2" }); // createImageContainer #2 (carousel item)
    enqueue({ status: "FINISHED" }); // poll child1
    enqueue({ status: "FINISHED" }); // poll child2
    enqueue({ id: "parent" }); // createCarouselContainer
    enqueue({ status: "FINISHED" }); // poll parent
    enqueue({ id: "M4" }); // publish
    enqueue({ permalink: "https://threads.net/@u/post/M4" });

    const result = await postToThreads(CREDS, "two pics", [
      "uploads/a.jpg",
      "uploads/b.jpg",
    ]);
    expect(result.platformPostId).toBe("M4");
  });

  it("throws if container creation returns no id", async () => {
    enqueue({ error: { message: "bad" } });
    await expect(postToThreads(CREDS, "x", [])).rejects.toThrow(/text container error/);
  });

  it("returns without platformUrl if permalink lookup fails", async () => {
    enqueue({ id: "C5" });
    enqueue({ id: "M5" }); // publish ok
    enqueue({ /* permalink missing */ });

    const result = await postToThreads(CREDS, "no link", []);
    expect(result.platformPostId).toBe("M5");
    expect(result.platformUrl).toBeUndefined();
  });
});
