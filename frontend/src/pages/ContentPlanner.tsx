import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BrainCircuit, Check, X, ClipboardList, AlertTriangle, Info, Bot, RefreshCw } from "lucide-react";

type DraftStatus = "Draft" | "Needs Review" | "Approved" | "Rejected";
type StatusFilter = "All" | DraftStatus;

type ContentDraft = {
  id: string;
  account: string;
  group: string;
  brandTag: string;
  materialTopic: string;
  pillar: string;
  angle: string;
  hookSeed: string;
  captionSeed: string;
  hashtagSet: string;
  cta: string;
  visualPromptSeed: string;
  status: DraftStatus;
  variationIndex?: number;
};

// Mock data based on docs/architecture/CONTENT_AUTOMATION_PLANNER_PHASE1.md
const mockDrafts: ContentDraft[] = [
  {
    id: "draft-marble-jakarta",
    account: "@marble.jakarta",
    group: "JKT-Luxury",
    brandTag: "SuperStone",
    materialTopic: "Statuario Marble",
    pillar: "Inspirasi",
    angle: "Bathroom luxury",
    hookSeed: "Kamar mandi impian.",
    captionSeed: "Kamar mandi mewah dengan marmer Statuario...",
    hashtagSet: "#luxuryinteriors",
    cta: "Hubungi kami",
    visualPromptSeed: "photorealistic, luxury master bathroom...",
    status: "Approved",
  },
  {
    id: "draft-granit-bali",
    account: "@granit.murah.bali",
    group: "BALI-Budget",
    brandTag: "RKB-Generic",
    materialTopic: "Black Granite",
    pillar: "Edukasi",
    angle: "Durability",
    hookSeed: "Top table anti gores!",
    captionSeed: "Kenapa granit hitam jadi pilihan utama...",
    hashtagSet: "#dapurminimalis",
    cta: "Cek link di bio",
    visualPromptSeed: "photo, black granite countertop...",
    status: "Needs Review",
  },
  {
    id: "draft-interior-depok",
    account: "@interior.depok",
    group: "JABO-Design",
    brandTag: "ProDesign",
    materialTopic: "Quartz",
    pillar: "Comparison",
    angle: "Quartz vs. Marble",
    hookSeed: "Bimbang pilih mana?",
    captionSeed: "Quartz atau Marmer? Untuk dapur sibuk...",
    hashtagSet: "#kitchendesign",
    cta: "Konsultasi gratis",
    visualPromptSeed: "split image, (left) white quartz counter...",
    status: "Draft",
  },
  {
    id: "draft-stone-surabaya",
    account: "@stone.surabaya",
    group: "SUB-Supplier",
    brandTag: "MegaStone",
    materialTopic: "Travertine",
    pillar: "Project",
    angle: "Cafe design",
    hookSeed: "Cafe baru di Surabaya.",
    captionSeed: "Senang bisa supply travertine untuk cafe...",
    hashtagSet: "#cafedesign",
    cta: "Kunjungi showroom",
    visualPromptSeed: "photo, trendy cafe interior...",
    status: "Approved",
  },
  {
    id: "draft-premium-marble",
    account: "@premium.marble",
    group: "JKT-Luxury",
    brandTag: "SuperStone",
    materialTopic: "Statuario Marble",
    pillar: "Inspirasi",
    angle: "Living room feature wall",
    hookSeed: "Ruang tamu auto-mewah.",
    captionSeed: "Feature wall dengan Statuario marble...",
    hashtagSet: "#livingroomdesign",
    cta: "Lihat koleksi kami",
    visualPromptSeed: "photorealistic, modern living room, large statuario...",
    status: "Rejected",
  },
];

const regenerationVariations = [
  {
    hookSeed: "Permukaan dapur yang langsung naik kelas.",
    captionSeed: "Material pilihan bisa mengubah dapur biasa menjadi focal point rumah...",
    cta: "Minta rekomendasi slab",
    visualPromptSeed: "photorealistic kitchen counter, premium stone surface, warm natural light...",
  },
  {
    hookSeed: "Detail batu yang bikin ruangan terasa mahal.",
    captionSeed: "Pola urat, warna, dan finishing menentukan karakter akhir interior...",
    cta: "Chat untuk konsultasi",
    visualPromptSeed: "close-up stone texture, elegant interior mood, editorial product photo...",
  },
  {
    hookSeed: "Satu sudut, beda ambience total.",
    captionSeed: "Gunakan stone surface yang tepat untuk menonjolkan gaya desain...",
    cta: "Lihat pilihan material",
    visualPromptSeed: "modern interior corner, statement marble slab, realistic soft shadows...",
  },
];

const statusStyles: Record<DraftStatus, string> = {
  Draft: "border-gray-500/20 bg-gray-500/10 text-gray-400",
  "Needs Review": "border-yellow-500/20 bg-yellow-500/10 text-yellow-400",
  Approved: "border-green-500/20 bg-green-500/10 text-green-400",
  Rejected: "border-red-500/20 bg-red-500/10 text-red-400",
};

const COMPOSE_DRAFTS_STORAGE_KEY = "rockbase.contentPlanner.composeDrafts";

export default function ContentPlanner() {
  const [drafts, setDrafts] = useState<ContentDraft[]>(() => mockDrafts.map((draft) => ({ ...draft })));
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [statusMessage, setStatusMessage] = useState("Phase 2B uses local state only. No API call made.");

  const counts = drafts.reduce(
    (acc, draft) => {
      acc.total += 1;
      if (draft.status === "Needs Review") acc.needsReview += 1;
      if (draft.status === "Approved") acc.approved += 1;
      if (draft.status === "Rejected") acc.rejected += 1;
      return acc;
    },
    { total: 0, needsReview: 0, approved: 0, rejected: 0 }
  );

  const filteredDrafts = statusFilter === "All" ? drafts : drafts.filter((draft) => draft.status === statusFilter);
  const allVisibleSelected =
    filteredDrafts.length > 0 && filteredDrafts.every((draft) => selectedDraftIds.includes(draft.id));

  const updateDraftStatus = (draftId: string, status: DraftStatus) => {
    setDrafts((currentDrafts) =>
      currentDrafts.map((draft) => (draft.id === draftId ? { ...draft, status } : draft))
    );
    setStatusMessage(`Mock draft marked ${status.toLowerCase()} locally. No API call made.`);
  };

  const toggleDraftSelection = (draftId: string) => {
    setSelectedDraftIds((currentIds) =>
      currentIds.includes(draftId) ? currentIds.filter((id) => id !== draftId) : [...currentIds, draftId]
    );
  };

  const toggleVisibleSelection = () => {
    setSelectedDraftIds((currentIds) => {
      if (allVisibleSelected) {
        return currentIds.filter((id) => !filteredDrafts.some((draft) => draft.id === id));
      }

      const nextIds = new Set(currentIds);
      filteredDrafts.forEach((draft) => nextIds.add(draft.id));
      return Array.from(nextIds);
    });
  };

  const regenerateDraft = (draftId: string) => {
    setDrafts((currentDrafts) =>
      currentDrafts.map((draft) => {
        if (draft.id !== draftId) return draft;

        const nextVariationIndex = ((draft.variationIndex ?? -1) + 1) % regenerationVariations.length;
        const variation = regenerationVariations[nextVariationIndex];

        return {
          ...draft,
          ...variation,
          status: "Needs Review",
          variationIndex: nextVariationIndex,
        };
      })
    );
    setStatusMessage("Mock draft regenerated locally using sample variations. No API call made.");
  };

  const generatePlan = () => {
    setDrafts(
      mockDrafts.map((draft, index) => ({
        ...draft,
        variationIndex: index % regenerationVariations.length,
      }))
    );
    setSelectedDraftIds([]);
    setStatusFilter("All");
    setStatusMessage("Mock plan generated locally. No API call made.");
  };

  const approveSelected = () => {
    if (selectedDraftIds.length === 0) {
      setStatusMessage("Select at least one draft first.");
      return;
    }

    setDrafts((currentDrafts) =>
      currentDrafts.map((draft) =>
        selectedDraftIds.includes(draft.id) ? { ...draft, status: "Approved" } : draft
      )
    );
    setStatusMessage("Selected drafts approved locally. No API call made.");
  };

  const sendApprovedToCompose = () => {
    const approvedDrafts = drafts.filter((draft) => draft.status === "Approved");

    if (approvedDrafts.length === 0) {
      setStatusMessage("Approve at least one draft before sending to Compose.");
      return;
    }

    const createdAt = new Date().toISOString();
    const composeDrafts = approvedDrafts.map((draft) => ({
      source: "content-planner",
      account: draft.account,
      group: draft.group,
      brandTag: draft.brandTag,
      materialTopic: draft.materialTopic,
      pillar: draft.pillar,
      angle: draft.angle,
      hookSeed: draft.hookSeed,
      captionSeed: draft.captionSeed,
      hashtagSet: draft.hashtagSet,
      cta: draft.cta,
      visualPromptSeed: draft.visualPromptSeed,
      status: draft.status,
      createdAt,
    }));

    localStorage.setItem(COMPOSE_DRAFTS_STORAGE_KEY, JSON.stringify(composeDrafts));
    setStatusMessage("Approved drafts saved for Compose. Open Compose to continue.");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-purple-400" />
            Content Planner
            <Badge variant="outline" className="text-xs text-purple-400 border-purple-400/30">Phase 2B Interactive Mock</Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan unique content drafts for many Instagram accounts before sending anything to Compose.
          </p>
          <p className="mt-2 text-[11px] font-mono p-2 bg-secondary rounded-md text-amber-500">
            <span className="font-bold">Safety Note:</span> Phase 2B uses local state only. No backend, no AI, no ComfyUI, no Compose send, no posting.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />Planner Controls</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <label className="font-medium text-muted-foreground text-xs">Account Group</label>
            <div className="mt-1 p-2 bg-secondary rounded-md font-mono">Marmer Putih</div>
          </div>
          <div>
            <label className="font-medium text-muted-foreground text-xs">Campaign Topic</label>
            <div className="mt-1 p-2 bg-secondary rounded-md font-mono">Kitchen Countertop Awareness</div>
          </div>
          <div>
            <label className="font-medium text-muted-foreground text-xs">Material Topic</label>
            <div className="mt-1 p-2 bg-secondary rounded-md font-mono">Statuario Marble</div>
          </div>
          <div>
            <label className="font-medium text-muted-foreground text-xs">Content Pillars</label>
            <div className="mt-1 flex flex-wrap gap-1">
              {["Edukasi Material", "Inspirasi Interior", "Before-after"].map((pillar) => (
                <Badge key={pillar} variant="secondary">{pillar}</Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-around flex-wrap gap-2 text-xs text-muted-foreground text-center">
            {["Account Group", "Campaign Topic", "Content Pillars", "AI Content Plan", "Draft Review", "Send to Compose"].map((step, index) => (
              <div key={step} className="contents">
                <div className="p-2 bg-secondary rounded-md">{step}</div>
                {index < 5 && <div className="font-bold text-purple-400">-&gt;</div>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total drafts", value: counts.total },
          { label: "Needs Review", value: counts.needsReview },
          { label: "Approved", value: counts.approved },
          { label: "Rejected", value: counts.rejected },
        ].map((counter) => (
          <Card key={counter.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{counter.label}</div>
              <div className="mt-1 text-2xl font-bold text-foreground">{counter.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" />Generated Content Drafts</CardTitle>
                <div className="flex flex-wrap gap-2">
                  {(["All", "Draft", "Needs Review", "Approved", "Rejected"] as StatusFilter[]).map((filter) => (
                    <Button
                      key={filter}
                      type="button"
                      size="sm"
                      variant={statusFilter === filter ? "default" : "outline"}
                      onClick={() => setStatusFilter(filter)}
                    >
                      {filter}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select visible drafts"
                        checked={allVisibleSelected}
                        onChange={toggleVisibleSelection}
                        className="h-4 w-4 rounded border-border"
                      />
                    </TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead>Brand Tag</TableHead>
                    <TableHead>Material Topic</TableHead>
                    <TableHead>Pillar</TableHead>
                    <TableHead>Angle</TableHead>
                    <TableHead>Hook Seed</TableHead>
                    <TableHead>Caption Seed</TableHead>
                    <TableHead>Hashtag Set</TableHead>
                    <TableHead>CTA</TableHead>
                    <TableHead>Visual Prompt Seed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDrafts.map((draft) => (
                    <TableRow key={draft.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${draft.account}`}
                          checked={selectedDraftIds.includes(draft.id)}
                          onChange={() => toggleDraftSelection(draft.id)}
                          className="h-4 w-4 rounded border-border"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{draft.account}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{draft.group}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{draft.brandTag}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{draft.materialTopic}</TableCell>
                      <TableCell><Badge variant="outline">{draft.pillar}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{draft.angle}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[180px]">{draft.hookSeed}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-xs">{draft.captionSeed}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{draft.hashtagSet}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{draft.cta}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-xs">{draft.visualPromptSeed}</TableCell>
                      <TableCell><Badge variant="outline" className={statusStyles[draft.status]}>{draft.status}</Badge></TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => updateDraftStatus(draft.id, "Approved")}>
                            Approve
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => updateDraftStatus(draft.id, "Rejected")}>
                            Reject
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => regenerateDraft(draft.id)}>
                            <RefreshCw className="h-3.5 w-3.5" />
                            Regenerate
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredDrafts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={14} className="py-8 text-center text-sm text-muted-foreground">
                        No drafts match this status filter.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Review Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col space-y-2">
              <Button type="button" onClick={generatePlan}><Bot className="h-4 w-4 mr-2" />Generate Plan</Button>
              <Button type="button" onClick={approveSelected}><Check className="h-4 w-4 mr-2" />Approve Selected</Button>
              <Button type="button" variant="destructive" onClick={sendApprovedToCompose}>
                <X className="h-4 w-4 mr-2" />Send Approved to Compose
              </Button>
              <p className="text-xs text-muted-foreground pt-2 text-center">{statusMessage}</p>
              {statusMessage === "Approved drafts saved for Compose. Open Compose to continue." && (
                <a
                  href="/compose"
                  className="text-center text-xs font-bold text-purple-400 underline-offset-4 hover:underline"
                >
                  Open Compose
                </a>
              )}
            </CardContent>
          </Card>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Mock Safety Warnings</AlertTitle>
            <AlertDescription className="space-y-1 text-xs">
              <p>Similar hook detected across 2 drafts.</p>
              <p>Same material topic used; rotate angle before approval.</p>
              <p>Missing visual asset; ComfyUI not connected in this phase.</p>
              <p>Compose send is disabled in mock phase.</p>
            </AlertDescription>
          </Alert>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Implementation Notes</AlertTitle>
            <AlertDescription className="space-y-1 text-xs">
              <p>This page uses dummy data and local React state only.</p>
              <p>No backend, AI, ComfyUI, Compose, posting, or n8n call is made.</p>
              <p>Future Phase 3 can connect AI text-only generation.</p>
              <p>Future Phase 4/5 can save drafts and send to Compose.</p>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  );
}
