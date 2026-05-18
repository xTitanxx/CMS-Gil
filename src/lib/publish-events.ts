// Loose-coupling bridge between SchedulePanel (fires) and ActivityList
// (listens). Lets the live-activity panel update the instant a publish/schedule
// is accepted — the API creates the PublishRecord synchronously before
// responding, so a single refetch after this event lands the new row.

export const PUBLISH_RECORD_CREATED_EVENT = "publishrecord:created";

export interface PublishRecordCreatedDetail {
  postId: string;
}

export function notifyPublishRecordCreated(postId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PublishRecordCreatedDetail>(PUBLISH_RECORD_CREATED_EVENT, {
      detail: { postId },
    }),
  );
}
