import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { driveListFolder, driveSearch, listSharedDrives, type DriveItem } from "@/api/google";
import { ChevronRight, Folder, FileText, Search, Loader2, X, ArrowLeft, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";

const GOOGLE_MIME_LABELS: Record<string, string> = {
  "application/vnd.google-apps.document":     "Google Doc",
  "application/vnd.google-apps.spreadsheet":  "Google Sheet",
  "application/vnd.google-apps.presentation": "Google Slides",
  "application/vnd.google-apps.folder":       "Folder",
  "text/plain": "Text",
  "text/csv":   "CSV",
  "application/pdf": "PDF",
};

function fileLabel(mime: string) {
  return GOOGLE_MIME_LABELS[mime] ?? mime.split("/").pop() ?? "File";
}

function isImportable(mime: string) {
  return (
    mime !== "application/vnd.google-apps.folder" &&
    mime !== "folder" &&
    !mime.startsWith("image/") &&
    !mime.startsWith("video/") &&
    !mime.startsWith("audio/")
  );
}

interface Props {
  onSelect: (file: DriveItem) => void;
  onClose: () => void;
}

export function DriveBrowser({ onSelect, onClose }: Props) {
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([
    { id: "root", name: "My Drive" },
  ]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const currentFolder = folderStack[folderStack.length - 1];

  const { data: sharedDrives = [] } = useQuery({
    queryKey: ["shared-drives"],
    queryFn: listSharedDrives,
    staleTime: 300_000,
  });

  const { data: folderItems = [], isLoading: folderLoading } = useQuery({
    queryKey: ["drive-folder", currentFolder.id],
    queryFn: () => driveListFolder(currentFolder.id),
    enabled: !isSearching,
  });

  const searchMutation = useMutation({
    mutationFn: (q: string) => driveSearch(q),
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) { setIsSearching(false); return; }
    setIsSearching(true);
    searchMutation.mutate(searchQuery.trim());
  }

  function clearSearch() { setSearchQuery(""); setIsSearching(false); }

  function openFolder(item: DriveItem) {
    setFolderStack((prev) => [...prev, { id: item.id, name: item.name }]);
    clearSearch();
  }

  function goBack() {
    if (folderStack.length > 1) { setFolderStack((prev) => prev.slice(0, -1)); clearSearch(); }
  }

  const displayItems = isSearching ? (searchMutation.data ?? []) : folderItems;
  const isLoading = isSearching ? searchMutation.isPending : folderLoading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex bg-background rounded-xl border shadow-2xl w-[780px] max-h-[80vh]">

        {/* Sidebar */}
        <div className="w-44 shrink-0 border-r flex flex-col py-2 overflow-y-auto rounded-l-xl bg-muted/20">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Locations
          </p>
          <button
            onClick={() => { setFolderStack([{ id: "root", name: "My Drive" }]); clearSearch(); }}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left",
              folderStack[0].id === "root" && !isSearching ? "bg-accent font-medium" : ""
            )}
          >
            <HardDrive className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            My Drive
          </button>
          {sharedDrives.length > 0 && (
            <>
              <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Shared Drives
              </p>
              {sharedDrives.map((drive) => (
                <button
                  key={drive.id}
                  onClick={() => { setFolderStack([{ id: drive.id, name: drive.name }]); clearSearch(); }}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left truncate",
                    folderStack[0].id === drive.id ? "bg-accent font-medium" : ""
                  )}
                >
                  <HardDrive className="h-3.5 w-3.5 shrink-0 text-purple-500" />
                  <span className="truncate">{drive.name}</span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* Main panel */}
        <div className="flex flex-col flex-1 min-w-0 rounded-r-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              {folderStack.length > 1 && !isSearching && (
                <button onClick={goBack} className="rounded p-1 hover:bg-muted">
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <h2 className="font-semibold text-sm">
                {isSearching ? `Search: "${searchQuery}"` : currentFolder.name}
              </h2>
              {isSearching && (
                <button onClick={clearSearch} className="text-xs text-muted-foreground hover:text-foreground underline">
                  clear
                </button>
              )}
            </div>
            <button onClick={onClose} className="rounded p-1 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex gap-2 border-b px-4 py-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Drive…"
                className="w-full rounded-md border bg-muted/50 pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button type="submit" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Search
            </button>
          </form>

          {/* Breadcrumb */}
          {!isSearching && folderStack.length > 1 && (
            <div className="flex items-center gap-1 border-b px-4 py-1.5 text-xs text-muted-foreground overflow-x-auto">
              {folderStack.map((f, i) => (
                <span key={f.id} className="flex items-center gap-1 shrink-0">
                  {i > 0 && <ChevronRight className="h-3 w-3" />}
                  <button
                    onClick={() => setFolderStack(folderStack.slice(0, i + 1))}
                    className="hover:text-foreground"
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* File list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : displayItems.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {isSearching ? "No results found." : "This folder is empty."}
              </div>
            ) : (
              <div className="divide-y">
                {displayItems.map((item) => {
                  const isFolder = item.type === "application/vnd.google-apps.folder" || item.type === "folder";
                  const importable = !isFolder && isImportable(item.type);
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors",
                        isFolder && "cursor-pointer",
                      )}
                      onClick={isFolder ? () => openFolder(item) : undefined}
                    >
                      {isFolder ? (
                        <Folder className="h-4 w-4 shrink-0 text-yellow-500" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {fileLabel(item.type)}
                          {item.modified && ` · ${new Date(item.modified).toLocaleDateString()}`}
                        </p>
                      </div>
                      {isFolder && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                      {importable && (
                        <button
                          onClick={() => onSelect(item)}
                          className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors"
                        >
                          Select
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
