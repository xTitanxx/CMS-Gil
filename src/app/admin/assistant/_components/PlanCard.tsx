"use client";

export interface PlanProposal {
  postId: string;
  platform: string;
  scheduledAt: string;
  caption?: string;
}

export function PlanCard({
  proposal,
  onConfirm,
  onCancel,
}: {
  proposal: PlanProposal;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-lg border p-3 bg-amber-50">
      <p className="text-sm font-medium">Schedule this?</p>
      <p className="text-xs mt-1">
        Post <code>{proposal.postId}</code> → <b>{proposal.platform}</b> at{" "}
        {new Date(proposal.scheduledAt).toLocaleString()}
      </p>
      {proposal.caption && (
        <p className="text-xs mt-1 italic">"{proposal.caption}"</p>
      )}
      <div className="flex gap-2 mt-2">
        <button
          onClick={onConfirm}
          className="text-xs px-2 py-1 bg-black text-white rounded"
        >
          Confirm
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-2 py-1 border rounded"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
