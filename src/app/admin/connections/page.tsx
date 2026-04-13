"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";

interface PlatformInfo {
  id: string;
  label: string;
  description: string;
  color: string;
  connectUrl: string;
}

const PLATFORMS: PlatformInfo[] = [
  {
    id: "FACEBOOK",
    label: "Facebook",
    description:
      "Connect your Facebook account to publish to a Facebook Page you admin. Personal profile publishing is not available — use the manual Copy caption row on a post.",
    color: "text-blue-700",
    connectUrl: "/api/connections/facebook",
  },
  {
    id: "INSTAGRAM",
    label: "Instagram",
    description: "Post photos, videos and Reels via Meta Graph API. Requires a Professional account.",
    color: "text-pink-600",
    connectUrl: "/api/connections/instagram",
  },
  {
    id: "LINKEDIN",
    label: "LinkedIn",
    description: "Share posts to your LinkedIn profile or company page.",
    color: "text-blue-600",
    connectUrl: "/api/connections/linkedin",
  },
  {
    id: "YOUTUBE",
    label: "YouTube / Google Drive",
    description: "Upload videos to YouTube and import from Google Drive. Click Connect to authorize both.",
    color: "text-red-600",
    connectUrl: "/api/connections/google?from=connections",
  },
  {
    id: "TIKTOK",
    label: "TikTok",
    description: "Publish videos to TikTok via the Content Posting API.",
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

export default function ConnectionsPage() {
  const searchParams = useSearchParams();
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
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
      setYoutubeConnected(data.youtube?.connected ?? false);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const disconnect = async (platform: string) => {
    setDisconnecting(platform);
    await fetch(`/api/connections?platform=${platform}`, { method: "DELETE" });
    await load();
    setDisconnecting(null);
  };

  const isConnected = (platformId: string) => {
    if (platformId === "YOUTUBE") return youtubeConnected;
    return tokens.some((t) => t.platform === platformId);
  };

  const getToken = (platformId: string) =>
    tokens.find((t) => t.platform === platformId);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Connections</h1>
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
          <Spinner className="h-6 w-6 text-gray-400" />
        </div>
      ) : (
      <div className="space-y-4">
        {PLATFORMS.map((platform) => {
          const connected = isConnected(platform.id);
          const token = getToken(platform.id);

          return (
            <Card key={platform.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className={`text-base ${platform.color}`}>
                    {platform.label}
                  </CardTitle>
                  {connected ? (
                    <Badge variant="success">Connected</Badge>
                  ) : (
                    <Badge variant="secondary">Not connected</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-gray-600">{platform.description}</p>

                {connected && token && (
                  <div className="space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    <div>
                      {token.platformUsername && (
                        <span className="font-medium">@{token.platformUsername}</span>
                      )}
                      {token.expiresAt && (
                        <span className="ml-2 text-gray-400">
                          Expires: {new Date(token.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {platform.id === "FACEBOOK" && (() => {
                      const pageToken = tokens.find((t) => t.platform === "FACEBOOK_PAGE");
                      return pageToken ? (
                        <div>
                          <span className="font-medium">Page:</span> @{pageToken.platformUsername}
                        </div>
                      ) : (
                        <div className="text-gray-400">
                          No pages found — Facebook Page publishing unavailable
                        </div>
                      );
                    })()}
                  </div>
                )}

                {connected && platform.id === "YOUTUBE" && (
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    Connected via Google account
                  </div>
                )}

                <div className="flex gap-2">
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
                      {platform.id !== "YOUTUBE" && (
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
                      )}
                    </>
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
