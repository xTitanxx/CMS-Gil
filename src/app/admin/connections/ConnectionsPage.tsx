"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, CheckCircle, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";

// Fixed capability categories — same order for every platform
const CAPABILITY_KEYS = ["Text", "Photos", "Video", "Stories", "Analytics", "Page", "Personal profile"] as const;

type CapabilityMap = Record<(typeof CAPABILITY_KEYS)[number], boolean>;

interface PlatformInfo {
  id: string;
  label: string;
  caps: CapabilityMap;
  note?: string;
  color: string;
  connectUrl: string;
}

const PLATFORMS: PlatformInfo[] = [
  {
    id: "FACEBOOK",
    label: "Facebook",
    caps: { Text: true, Photos: true, Video: true, Stories: true, Analytics: true, Page: true, "Personal profile": false },
    color: "text-blue-700",
    connectUrl: "/api/connections/facebook",
  },
  {
    id: "INSTAGRAM",
    label: "Instagram",
    caps: { Text: false, Photos: true, Video: true, Stories: true, Analytics: true, Page: false, "Personal profile": true },
    note: "Requires a Professional account",
    color: "text-pink-600",
    connectUrl: "/api/connections/instagram",
  },
  {
    id: "LINKEDIN",
    label: "LinkedIn",
    caps: { Text: true, Photos: true, Video: true, Stories: false, Analytics: false, Page: false, "Personal profile": true },
    color: "text-blue-600",
    connectUrl: "/api/connections/linkedin",
  },
  {
    id: "YOUTUBE",
    label: "YouTube / Google Drive",
    caps: { Text: false, Photos: false, Video: true, Stories: false, Analytics: true, Page: false, "Personal profile": true },
    note: "One Google grant covers both YouTube and Drive. Independent of admin sign-in — disconnecting won't sign you out.",
    color: "text-red-600",
    connectUrl: "/api/connections/google?from=connections",
  },
  {
    id: "TIKTOK",
    label: "TikTok",
    caps: { Text: false, Photos: false, Video: true, Stories: false, Analytics: true, Page: false, "Personal profile": true },
    color: "text-gray-900",
    connectUrl: "/api/connections/tiktok",
  },
];

interface TokenInfo {
  platform: string;
  platformUsername: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

interface YoutubeInfo {
  connected: boolean;
  email?: string | null;
  channelTitle?: string | null;
}

export default function ConnectionsPage() {
  const searchParams = useSearchParams();
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [youtube, setYoutube] = useState<YoutubeInfo>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const successPlatform = searchParams.get("success");
  const errorPlatform = searchParams.get("error");
  const errorDetail = searchParams.get("detail");

  const load = async () => {
    const res = await fetch("/api/connections");
    if (res.ok) {
      const data = await res.json();
      setTokens(data.tokens ?? []);
      setYoutube({
        connected: data.youtube?.connected ?? false,
        email: data.youtube?.email ?? null,
        channelTitle: data.youtube?.channelTitle ?? null,
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const disconnect = async (platform: string) => {
    if (platform === "YOUTUBE") {
      const ok = window.confirm(
        "Disconnecting YouTube also disconnects Google Drive import (one OAuth grant covers both). You will stay signed in. Continue?",
      );
      if (!ok) return;
    }
    setDisconnecting(platform);
    await fetch(`/api/connections?platform=${platform}`, { method: "DELETE" });
    await load();
    setDisconnecting(null);
  };

  const isConnected = (platformId: string) => {
    if (platformId === "YOUTUBE") return youtube.connected;
    return tokens.some((t) => t.platform === platformId);
  };

  const getToken = (platformId: string) =>
    tokens.find((t) => t.platform === platformId);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="hidden text-2xl font-bold text-gray-900 md:block">Connections</h1>
        <p className="text-sm text-gray-500">
          Connect your social accounts to enable publishing
        </p>
      </div>

      {successPlatform && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <p className="text-sm text-green-700">
            {successPlatform.charAt(0).toUpperCase() + successPlatform.slice(1)} connected
            successfully!
          </p>
        </div>
      )}

      {errorPlatform && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3">
          <XCircle className="h-4 w-4 text-red-500" />
          <p className="text-sm text-red-700">
            Failed to connect {errorPlatform.split("_")[0]}. Please try again.
            {errorDetail && <span className="block text-xs mt-1 font-mono">{decodeURIComponent(errorDetail)}</span>}
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-6 w-6 text-gray-500" />
        </div>
      ) : (
      <div className="space-y-4">
        {PLATFORMS.map((platform) => {
          const connected = isConnected(platform.id);
          const token = getToken(platform.id);

          return (
            <Card key={platform.id}>
              <CardContent className="py-5 space-y-4">
                {/* Row 1: Name + status + actions */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className={`text-sm font-semibold ${platform.color}`}>
                      {platform.label}
                    </h3>
                    {connected && <Badge variant="success">Connected</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!connected ? (
                      <Button
                        size="sm"
                        onClick={() => window.location.assign(platform.connectUrl)}
                      >
                        Connect
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.location.assign(platform.connectUrl)}
                        >
                          Reconnect
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={disconnecting === platform.id}
                          onClick={() => disconnect(platform.id)}
                        >
                          {disconnecting === platform.id ? (
                            <>
                              <Spinner />
                              Disconnecting...
                            </>
                          ) : (
                            "Disconnect"
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Row 2: Account info (only when connected) */}
                {connected && token && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700">
                    {token.platformUsername && (
                      <span className="font-medium">@{token.platformUsername}</span>
                    )}
                    {platform.id === "FACEBOOK" && (() => {
                      const pageToken = tokens.find((t) => t.platform === "FACEBOOK_PAGE");
                      return pageToken ? (
                        <>
                          <span className="text-gray-300">|</span>
                          <span>Page: <span className="font-medium">@{pageToken.platformUsername}</span></span>
                        </>
                      ) : (
                        <>
                          <span className="text-gray-300">|</span>
                          <span className="text-gray-500">No pages found</span>
                        </>
                      );
                    })()}
                    {token.expiresAt && (
                      <>
                        <span className="text-gray-300">|</span>
                        <span className="text-gray-500">Expires {new Date(token.expiresAt).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                )}
                {connected && platform.id === "YOUTUBE" && !token && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700">
                    {youtube.email ? (
                      <span className="font-medium">{youtube.email}</span>
                    ) : (
                      <span>Connected via Google account</span>
                    )}
                    {youtube.channelTitle && (
                      <>
                        <span className="text-gray-300">|</span>
                        <span>Channel: <span className="font-medium">{youtube.channelTitle}</span></span>
                      </>
                    )}
                  </div>
                )}

                {/* Row 3: Capabilities — available first, then unavailable */}
                <div className="flex flex-wrap gap-2">
                  {[...CAPABILITY_KEYS]
                    .sort((a, b) => Number(platform.caps[b]) - Number(platform.caps[a]))
                    .map((key) => {
                      const on = platform.caps[key];
                      return (
                        <span
                          key={key}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                            on
                              ? "bg-green-50 text-green-700"
                              : "bg-red-50 text-red-600 line-through decoration-red-300"
                          }`}
                        >
                          {on ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
                          {key}
                        </span>
                      );
                    })}
                  {platform.note && (
                    <span className="self-center text-xs text-gray-500">{platform.note}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      )}
    </div>
  );
}
