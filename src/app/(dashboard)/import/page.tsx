"use client";

import { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Upload, FolderOpen, RefreshCw, CheckCircle, XCircle } from "lucide-react";

interface ImportJob {
  id: string;
  status: string;
  filename: string;
  source: string;
  totalPosts: number;
  importedPosts: number;
  skippedPosts: number;
  errorLog: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface DriveFolder {
  id: string;
  name: string;
}

export default function ImportPage() {
  const [activeJob, setActiveJob] = useState<ImportJob | null>(null);
  const [polling, setPolling] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Drive sync state
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<DriveFolder | null>(null);
  const [driveSync, setDriveSync] = useState<{
    folderId?: string;
    folderName?: string;
    lastSyncedAt?: string;
  } | null>(null);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveSyncing, setDriveSyncing] = useState(false);
  const [driveError, setDriveError] = useState("");

  // Poll active job
  useEffect(() => {
    if (!activeJob || activeJob.status === "COMPLETED" || activeJob.status === "FAILED") {
      setPolling(false);
      return;
    }
    setPolling(true);
    const interval = setInterval(async () => {
      const res = await fetch(`/api/import/${activeJob.id}/status`);
      if (res.ok) {
        const data = await res.json();
        setActiveJob(data);
        if (data.status === "COMPLETED" || data.status === "FAILED") {
          clearInterval(interval);
          setPolling(false);
        }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [activeJob]);

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setUploadError("");

    const form = new FormData();
    form.append("file", file);

    const res = await fetch("/api/import/upload", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    if (!res.ok) {
      setUploadError(data.error ?? "Upload failed");
      return;
    }
    // Start polling
    setActiveJob({ id: data.jobId, status: "PENDING", filename: file.name, source: "UPLOAD", totalPosts: 0, importedPosts: 0, skippedPosts: 0, errorLog: null, startedAt: null, completedAt: null });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/zip": [".zip"],
      "application/json": [".json"],
    },
    maxFiles: 1,
  });

  const loadDriveFolders = async () => {
    setDriveLoading(true);
    setDriveError("");
    const res = await fetch("/api/drive/folders");
    if (res.ok) {
      const data = await res.json();
      setDriveFolders(data.folders ?? []);
    } else {
      setDriveError("Could not load Drive folders. Make sure you signed in with Google.");
    }
    setDriveLoading(false);
  };

  const saveDriveFolder = async () => {
    if (!selectedFolder) return;
    const res = await fetch("/api/drive/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderId: selectedFolder.id,
        folderName: selectedFolder.name,
      }),
    });
    if (res.ok) {
      setDriveSync({ folderId: selectedFolder.id, folderName: selectedFolder.name });
    }
  };

  const triggerDriveSync = async () => {
    setDriveSyncing(true);
    const res = await fetch("/api/drive/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const data = await res.json();
    setDriveSyncing(false);
    if (res.ok) {
      alert(`Sync complete: ${data.jobsCreated} job(s) created`);
    } else {
      setDriveError(data.error ?? "Sync failed");
    }
  };

  const progress =
    activeJob?.totalPosts && activeJob.totalPosts > 0
      ? Math.round((activeJob.importedPosts / activeJob.totalPosts) * 100)
      : 0;

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import Posts</h1>
        <p className="text-sm text-gray-500">
          Import your Facebook data export into the CMS
        </p>
      </div>

      {/* Manual Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" />
            Manual Upload
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            {...getRootProps()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              isDragActive
                ? "border-blue-400 bg-blue-50"
                : "border-gray-300 hover:border-gray-400"
            }`}
          >
            <input {...getInputProps()} />
            <Upload className="mx-auto mb-3 h-8 w-8 text-gray-400" />
            {isDragActive ? (
              <p className="text-sm text-blue-600">Drop the file here...</p>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-700">
                  Drag & drop your Facebook export
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Supports .zip (full export) or .json (your_posts_1.json)
                </p>
                <Button variant="outline" size="sm" className="mt-3">
                  Browse files
                </Button>
              </>
            )}
          </div>

          {uploadError && (
            <p className="text-sm text-red-600">{uploadError}</p>
          )}

          {/* Active job progress */}
          {activeJob && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {activeJob.status === "COMPLETED" ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : activeJob.status === "FAILED" ? (
                    <XCircle className="h-4 w-4 text-red-500" />
                  ) : (
                    <RefreshCw className={`h-4 w-4 text-blue-500 ${polling ? "animate-spin" : ""}`} />
                  )}
                  <span className="text-sm font-medium">{activeJob.filename}</span>
                </div>
                <Badge
                  variant={
                    activeJob.status === "COMPLETED"
                      ? "success"
                      : activeJob.status === "FAILED"
                      ? "destructive"
                      : "warning"
                  }
                >
                  {activeJob.status}
                </Badge>
              </div>

              {activeJob.totalPosts > 0 && (
                <>
                  <Progress value={progress} />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{activeJob.importedPosts} imported</span>
                    <span>{activeJob.skippedPosts} skipped</span>
                    <span>{activeJob.totalPosts} total</span>
                  </div>
                </>
              )}

              {activeJob.status === "FAILED" && activeJob.errorLog && (
                <p className="text-xs text-red-600">
                  {JSON.parse(activeJob.errorLog)[0]}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Google Drive Sync */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="h-4 w-4" />
            Google Drive Sync
            <Badge variant="secondary" className="text-xs">Daily at 2 AM UTC</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            Point to a Google Drive folder containing your Facebook export files. The
            CMS will automatically check for new files every day.
          </p>

          {driveSync?.folderName && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <div>
                <p className="text-sm font-medium text-green-800">
                  Watching: {driveSync.folderName}
                </p>
                {driveSync.lastSyncedAt && (
                  <p className="text-xs text-green-600">
                    Last synced: {new Date(driveSync.lastSyncedAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadDriveFolders}
              disabled={driveLoading}
            >
              {driveLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <FolderOpen className="h-4 w-4" />
              )}
              Browse Drive folders
            </Button>

            {driveSync?.folderId && (
              <Button
                variant="outline"
                size="sm"
                onClick={triggerDriveSync}
                disabled={driveSyncing}
              >
                <RefreshCw className={`h-4 w-4 ${driveSyncing ? "animate-spin" : ""}`} />
                Sync Now
              </Button>
            )}
          </div>

          {driveError && <p className="text-sm text-red-600">{driveError}</p>}

          {driveFolders.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Select a folder
              </p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200">
                {driveFolders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => setSelectedFolder(folder)}
                    className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
                      selectedFolder?.id === folder.id
                        ? "bg-blue-50 text-blue-700"
                        : "hover:bg-gray-50 text-gray-700"
                    }`}
                  >
                    <FolderOpen className="h-4 w-4 flex-shrink-0 text-yellow-500" />
                    {folder.name}
                  </button>
                ))}
              </div>

              {selectedFolder && (
                <Button size="sm" onClick={saveDriveFolder}>
                  Watch &quot;{selectedFolder.name}&quot;
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
