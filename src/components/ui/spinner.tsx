import { RefreshCw } from "lucide-react";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <RefreshCw className={`animate-spin ${className}`} />;
}
