"use client";

import { useRef } from "react";
import { CommentThread, type CommentDTO } from "./CommentThread";
import { CommentComposer } from "./CommentComposer";

interface Props {
  postId: string;
  signedIn: boolean;
  commentsDisabled: boolean;
  initialComments: { comments: CommentDTO[]; nextCursor: string | null };
}

export function CommentSection({
  postId,
  signedIn,
  commentsDisabled,
  initialComments,
}: Props) {
  const appendRef = useRef<((c: CommentDTO) => void) | null>(null);

  return (
    <>
      <CommentThread postId={postId} initial={initialComments} appendRef={appendRef} />
      <CommentComposer
        postId={postId}
        signedIn={signedIn}
        commentsDisabled={commentsDisabled}
        onPosted={(c) => appendRef.current?.(c)}
      />
    </>
  );
}
