import { RateQueue } from "./RateQueue";

export const metadata = { title: "Review Posts" };

export default function RatePage() {
  // Auth is enforced by `src/app/admin/layout.tsx`.
  return <RateQueue />;
}
