import { describe, it, expect } from "vitest";
import {
  parseFacebookExport,
  parseAlbumExport,
  parseFacebookFile,
  dedupeParsedPosts,
  type FBAlbum,
} from "./facebook-parser";

describe("story and reel classification", () => {
  it("parses lasso_videos_v2 as a reel with a distinct provenance id", () => {
    const [reel] = parseFacebookFile({
      lasso_videos_v2: [{
        timestamp: 1700000000,
        data: [{ post: "A reel caption" }],
        attachments: [{ data: [{ media: { uri: "your_facebook_activity/posts/media/videos/123.mp4" } }] }],
      }],
    });
    expect(reel).toMatchObject({
      postType: "REEL",
      sourceId: "fb_reel_media_123",
      mediaUris: ["your_facebook_activity/posts/media/videos/123.mp4"],
    });
  });

  it("marks archived_stories_v2 rows as stories", () => {
    const [story] = parseFacebookFile({
      archived_stories_v2: [{
        timestamp: 1700000000,
        attachments: [{ data: [{ media: { uri: "your_facebook_activity/posts/media/photos/456.jpg" } }] }],
      }],
    });
    expect(story).toMatchObject({ postType: "STORY", sourceId: "fb_story_media_456" });
  });
});

describe("dedupeParsedPosts", () => {
  it("keeps posts-file entry when same photo also appears in album file", () => {
    // Same photo: "4336340783178132.jpg"
    // Posts file: post.timestamp = 1774794544 (Mar 29 — closer to real post time)
    // Album file: creation_timestamp = 1775056639 (Apr 1 — last edit upload time)
    const postsFromPostsFile = parseFacebookExport([
      {
        timestamp: 1774794544,
        attachments: [
          {
            data: [
              {
                media: {
                  uri: "your_facebook_activity/posts/media/Mobileuploads/4336340783178132.jpg",
                  creation_timestamp: 1775056639,
                },
              },
            ],
          },
        ],
        data: [{ post: "You think they are coming at you" }],
      },
    ]);

    const album: FBAlbum = {
      name: "Mobile uploads",
      photos: [
        {
          uri: "your_facebook_activity/posts/media/Mobileuploads/4336340783178132.jpg",
          creation_timestamp: 1775056639,
          description: "You think they are coming at you",
        },
      ],
    };
    const postsFromAlbumFile = parseAlbumExport(album);

    // Sanity: both produced one entry with the same sourceId
    expect(postsFromPostsFile).toHaveLength(1);
    expect(postsFromAlbumFile).toHaveLength(1);
    expect(postsFromPostsFile[0].sourceId).toBe(postsFromAlbumFile[0].sourceId);

    // The one from the posts file uses post.timestamp (Mar 29)
    expect(postsFromPostsFile[0].originalDate.getTime()).toBe(1774794544 * 1000);
    // The one from the album file uses creation_timestamp (Apr 1)
    expect(postsFromAlbumFile[0].originalDate.getTime()).toBe(1775056639 * 1000);

    // Merge in both orders — posts file should always win
    const mergedA = dedupeParsedPosts([...postsFromPostsFile, ...postsFromAlbumFile]);
    const mergedB = dedupeParsedPosts([...postsFromAlbumFile, ...postsFromPostsFile]);

    expect(mergedA).toHaveLength(1);
    expect(mergedB).toHaveLength(1);
    expect(mergedA[0].originalDate.getTime()).toBe(1774794544 * 1000);
    expect(mergedB[0].originalDate.getTime()).toBe(1774794544 * 1000);
  });

  it("keeps unique entries untouched", () => {
    const album: FBAlbum = {
      name: "Mobile uploads",
      photos: [
        { uri: "a/1.jpg", creation_timestamp: 1000, description: "one" },
        { uri: "a/2.jpg", creation_timestamp: 2000, description: "two" },
      ],
    };
    const result = dedupeParsedPosts(parseAlbumExport(album));
    expect(result).toHaveLength(2);
  });

  it("treats entries without a priority as the lowest priority", () => {
    const sourceId = "fb_media_xyz";
    const withoutPriority = {
      body: "no priority",
      originalDate: new Date(1000 * 1000),
      sourceId,
      mediaUris: [],
    };
    const withPriority = {
      body: "with priority",
      originalDate: new Date(2000 * 1000),
      sourceId,
      mediaUris: [],
      priority: 1,
    };
    const merged = dedupeParsedPosts([withoutPriority, withPriority]);
    expect(merged).toHaveLength(1);
    expect(merged[0].body).toBe("with priority");
  });

  it("collapses text-only edit-history entries to the earliest timestamp", () => {
    // Facebook serializes the pre-edit and post-edit versions of a text-only
    // post as separate entries with different timestamps. Parse + dedupe
    // should collapse them to a single row, keeping the earliest (original).
    const edits = parseFacebookExport([
      {
        timestamp: 1774293515, // 19:18:35 — original
        data: [{ post: "When someone breaks, it feels like it will never end" }],
      },
      {
        timestamp: 1774294052, // 19:27:32 — edit, 9 min later
        data: [{ post: "When someone breaks, it feels like it will never end" }],
      },
    ]);
    expect(edits).toHaveLength(2);

    const merged = dedupeParsedPosts(edits);
    expect(merged).toHaveLength(1);
    expect(merged[0].originalDate.getTime()).toBe(1774293515 * 1000);
  });

  it("collapses media posts that share a body, keeping the earliest and unioning media", () => {
    // Facebook re-encodes the same video for different destinations (reel,
    // feed, mobile) and lists each as a separate entry with the same
    // description but different filenames and timestamps. We collapse them
    // to the earliest entry and union media URIs so all copies of the file
    // still get uploaded.
    const posts = parseFacebookExport([
      {
        timestamp: 1774198512, // earliest
        data: [{ post: "Another must-have when I travel is suction grab bars" }],
        attachments: [
          { data: [{ media: { uri: "posts/media/videos/A.mp4" } }] },
        ],
      },
      {
        timestamp: 1774199185,
        data: [{ post: "Another must-have when I travel is suction grab bars" }],
        attachments: [
          { data: [{ media: { uri: "posts/media/videos/B.mp4" } }] },
        ],
      },
      {
        timestamp: 1774199249,
        data: [{ post: "Another must-have when I travel is suction grab bars" }],
        attachments: [
          { data: [{ media: { uri: "posts/media/videos/C.mp4" } }] },
        ],
      },
    ]);
    expect(posts).toHaveLength(3);

    const merged = dedupeParsedPosts(posts);
    expect(merged).toHaveLength(1);
    expect(merged[0].originalDate.getTime()).toBe(1774198512 * 1000);
    // Media union — all three video URIs survive on the keeper
    expect(merged[0].mediaUris.sort()).toEqual([
      "posts/media/videos/A.mp4",
      "posts/media/videos/B.mp4",
      "posts/media/videos/C.mp4",
    ]);
  });

  it("does not collapse empty-body text posts", () => {
    // Two photo-only posts with no caption on different dates should remain
    // separate — they aren't "duplicates" even though their body is ''.
    // (These never match Rule-E / text-only-dedupe: no body, no collapse.)
    const merged = dedupeParsedPosts([
      {
        body: "",
        originalDate: new Date(1000 * 1000),
        sourceId: "fb_1000",
        mediaUris: [],
      },
      {
        body: "",
        originalDate: new Date(2000 * 1000),
        sourceId: "fb_2000",
        mediaUris: [],
      },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("parseFacebookExport share detection", () => {
  it("captures external_context as share and preserves original commentary", () => {
    const posts = parseFacebookExport([
      {
        timestamp: 1700000000,
        title: "Gil shared a link.",
        data: [{ post: "Worth reading." }],
        attachments: [
          {
            data: [
              {
                external_context: {
                  url: "https://example.com/article",
                  source: "Example",
                  name: "Some article",
                },
              },
            ],
          },
        ],
      },
    ]);
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toBe("Worth reading.");
    expect(posts[0].share).toEqual({
      url: "https://example.com/article",
      source: "Example",
      name: "Some article",
    });
  });

  it("drops pure shares with no original commentary", () => {
    const posts = parseFacebookExport([
      {
        timestamp: 1700000000,
        title: "Gil shared a link.",
        attachments: [
          {
            data: [{ external_context: { url: "https://example.com" } }],
          },
        ],
      },
    ]);
    expect(posts).toHaveLength(0);
  });

  it("flags shares from title when no external_context is present", () => {
    const posts = parseFacebookExport([
      {
        timestamp: 1700000000,
        title: "Gil shared Bob's post.",
        data: [{ post: "Exactly this." }],
      },
    ]);
    expect(posts).toHaveLength(1);
    expect(posts[0].share).toEqual({ name: "Gil shared Bob's post." });
  });

  it("does not flag non-share titles as shares", () => {
    const posts = parseFacebookExport([
      {
        timestamp: 1700000000,
        title: "Gil is with Alice.",
        data: [{ post: "Great day" }],
      },
    ]);
    expect(posts).toHaveLength(1);
    expect(posts[0].share ?? null).toBeNull();
  });
});
