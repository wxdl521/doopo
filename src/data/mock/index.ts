// Centralized mock data for the SaaS demo. All values are static and
// safe to import from any client component.

export type ScriptStatus = "draft" | "reviewing" | "finalized";
export type ScriptItem = {
  id: string;
  title: string;
  type: "micro" | "short" | "feature" | "ad";
  genre: string;
  durationSec: number;
  episodes: number;
  dialogueDensity: number; // 0-100
  conflictDensity: number; // 0-100
  status: ScriptStatus;
  updated: string;
  versions: ScriptVersion[];
  scenes: ScriptScene[];
  summary: string;
};

export type ScriptVersion = {
  id: string;
  label: string;
  createdAt: string;
  author: string;
  note: string;
};

export type ScriptScene = {
  id: string;
  index: number;
  title: string;
  location: string;
  timeOfDay: "DAY" | "NIGHT" | "DUSK" | "DAWN";
  action: string;
  dialogue: { role: string; line: string }[];
};

export const mockScripts: ScriptItem[] = [
  {
    id: "scr-001",
    title: "The Last Lighthouse",
    type: "short",
    genre: "Sci-Fi",
    durationSec: 180,
    episodes: 3,
    dialogueDensity: 45,
    conflictDensity: 70,
    status: "reviewing",
    updated: "2 hours ago",
    summary:
      "A lighthouse keeper on a dying coastline receives a signal from a future version of herself.",
    versions: [
      {
        id: "v1",
        label: "v1 — Initial draft",
        createdAt: "2026-05-08",
        author: "AI",
        note: "Auto-generated from one-line idea.",
      },
      {
        id: "v2",
        label: "v2 — Tighter pacing",
        createdAt: "2026-05-09",
        author: "Lin",
        note: "Cut scene 4, condensed exposition.",
      },
      {
        id: "v3",
        label: "v3 — Conflict bump",
        createdAt: "2026-05-11",
        author: "AI",
        note: "Increased conflict density to 70%.",
      },
    ],
    scenes: [
      {
        id: "sc-1",
        index: 1,
        title: "INT. LIGHTHOUSE — KEEPER ROOM",
        location: "Lighthouse interior",
        timeOfDay: "NIGHT",
        action: "MAYA (40s) tunes a brass radio. Static. A voice cuts through — her own.",
        dialogue: [
          { role: "MAYA (RADIO)", line: "Maya. Listen carefully. The tide is wrong." },
          { role: "MAYA", line: "Who is this?" },
        ],
      },
      {
        id: "sc-2",
        index: 2,
        title: "EXT. CLIFF — STORM",
        location: "Cliff edge",
        timeOfDay: "NIGHT",
        action: "Waves slam the rocks. Maya runs into the wind, holding the radio.",
        dialogue: [{ role: "MAYA (RADIO)", line: "Don't light the lamp tonight." }],
      },
    ],
  },
  {
    id: "scr-002",
    title: "Neon Noodles",
    type: "ad",
    genre: "Commercial",
    durationSec: 30,
    episodes: 1,
    dialogueDensity: 20,
    conflictDensity: 25,
    status: "finalized",
    updated: "yesterday",
    summary: "A late-night ramen ad with cyberpunk flair, pitched at Gen-Z foodies.",
    versions: [
      { id: "v1", label: "v1 — Hero cut", createdAt: "2026-05-04", author: "AI", note: "Locked." },
    ],
    scenes: [
      {
        id: "sc-1",
        index: 1,
        title: "EXT. ALLEY — RAIN",
        location: "Neon-lit alley",
        timeOfDay: "NIGHT",
        action: "A holographic noodle bowl floats above a steaming stall.",
        dialogue: [{ role: "VENDOR", line: "Hot. Spicy. Yours." }],
      },
    ],
  },
  {
    id: "scr-003",
    title: "Founder Story Pitch",
    type: "short",
    genre: "Drama",
    durationSec: 240,
    episodes: 1,
    dialogueDensity: 60,
    conflictDensity: 50,
    status: "draft",
    updated: "3 days ago",
    summary: "A robotics founder explains why she gave up tenure to build her first prototype.",
    versions: [
      {
        id: "v1",
        label: "v1 — Outline",
        createdAt: "2026-05-09",
        author: "AI",
        note: "Outline only.",
      },
    ],
    scenes: [],
  },
];

// ===================== Characters =====================
export type CharacterItem = {
  id: string;
  name: string;
  role: string;
  style: string;
  locked: boolean;
  bible: { hair: string; eyes: string; outfit: string; accessory: string; personality: string };
  views: { front: string; side: string; back: string; expression: string; accessory: string };
  palette: string[];
  expressions: string[];
  poses: string[];
  relatedScriptIds: string[];
};

const grad = (a: string, b: string) => `linear-gradient(135deg, ${a}, ${b})`;

export const mockCharacters: CharacterItem[] = [
  {
    id: "ch-maya",
    name: "Maya Holt",
    role: "Lighthouse Keeper",
    style: "Cinematic Realistic",
    locked: true,
    bible: {
      hair: "Salt-and-pepper, short bob",
      eyes: "Storm grey",
      outfit: "Navy oilskin coat, wool sweater",
      accessory: "Brass pocket compass",
      personality: "Stoic, observant, haunted by loss.",
    },
    views: {
      front: grad("#1e3a5f", "#0f172a"),
      side: grad("#334155", "#0f172a"),
      back: grad("#1e293b", "#020617"),
      expression: grad("#475569", "#1e293b"),
      accessory: grad("#92400e", "#1c1917"),
    },
    palette: ["#0f172a", "#334155", "#92400e", "#cbd5e1"],
    expressions: ["Resolute", "Worried", "Soft smile", "Grief"],
    poses: ["Standing watch", "Reaching for radio", "Running in storm"],
    relatedScriptIds: ["scr-001"],
  },
  {
    id: "ch-vendor",
    name: "Old Lin",
    role: "Noodle Vendor",
    style: "Cyberpunk",
    locked: false,
    bible: {
      hair: "Long ponytail, streaked with neon pink",
      eyes: "Amber",
      outfit: "Apron over thermal jacket",
      accessory: "Holographic ladle",
      personality: "Warm, sarcastic, never sleeps.",
    },
    views: {
      front: grad("#be185d", "#1e1b4b"),
      side: grad("#a21caf", "#1e1b4b"),
      back: grad("#7c3aed", "#1e1b4b"),
      expression: grad("#ec4899", "#312e81"),
      accessory: grad("#06b6d4", "#1e1b4b"),
    },
    palette: ["#1e1b4b", "#be185d", "#06b6d4", "#fde047"],
    expressions: ["Grin", "Concentrated", "Wink"],
    poses: ["Stirring pot", "Handing bowl", "Leaning on counter"],
    relatedScriptIds: ["scr-002"],
  },
  {
    id: "ch-ada",
    name: "Ada Reyes",
    role: "Robotics Founder",
    style: "Editorial Portrait",
    locked: false,
    bible: {
      hair: "Curly, shoulder-length, deep brown",
      eyes: "Hazel",
      outfit: "Charcoal blazer, white tee",
      accessory: "Wireframe glasses",
      personality: "Driven, candid, dryly funny.",
    },
    views: {
      front: grad("#f59e0b", "#7c2d12"),
      side: grad("#d97706", "#431407"),
      back: grad("#92400e", "#27272a"),
      expression: grad("#fbbf24", "#7c2d12"),
      accessory: grad("#fde68a", "#78350f"),
    },
    palette: ["#7c2d12", "#f59e0b", "#fde68a", "#27272a"],
    expressions: ["Confident", "Reflective", "Laughing"],
    poses: ["Crossed arms", "At workbench", "On stage"],
    relatedScriptIds: ["scr-003"],
  },
];

export const mockCharacterRelations: { from: string; to: string; label: string }[] = [
  { from: "ch-maya", to: "ch-vendor", label: "meets in flashback" },
  { from: "ch-ada", to: "ch-maya", label: "inspired by" },
];

// ===================== Project detail =====================
export type ProjectDetail = {
  id: string;
  title: string;
  status: "draft" | "rendering" | "ready";
  thumbnail: string;
  description: string;
  collaborators: string[];
  scriptIds: string[];
  characterIds: string[];
  assetCount: number;
  pointsUsed: number;
  updated: string;
};

export const mockProjectDetails: ProjectDetail[] = [
  {
    id: "1",
    title: "Lighthouse Reverie",
    status: "rendering",
    thumbnail: "from-indigo-700 via-violet-800 to-slate-950",
    description: "A surreal short about a lighthouse keeper hearing her future self.",
    collaborators: ["Lin", "AI"],
    scriptIds: ["scr-001"],
    characterIds: ["ch-maya"],
    assetCount: 23,
    pointsUsed: 412,
    updated: "2 min ago",
  },
  {
    id: "2",
    title: "Founder Story Pitch",
    status: "ready",
    thumbnail: "from-amber-500 via-rose-700 to-zinc-950",
    description: "A founder pitch video for a robotics seed round.",
    collaborators: ["Ada", "AI"],
    scriptIds: ["scr-003"],
    characterIds: ["ch-ada"],
    assetCount: 11,
    pointsUsed: 198,
    updated: "yesterday",
  },
  {
    id: "3",
    title: "Cyberpunk Cafe MV",
    status: "draft",
    thumbnail: "from-fuchsia-600 via-purple-800 to-indigo-950",
    description: "A music video centered on a 24h ramen stall.",
    collaborators: ["Lin"],
    scriptIds: ["scr-002"],
    characterIds: ["ch-vendor"],
    assetCount: 7,
    pointsUsed: 84,
    updated: "3 days ago",
  },
];

// ===================== Team =====================
export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "editor" | "viewer";
  status: "active" | "invited" | "suspended";
  joined: string;
  lastActive: string;
  pointsUsed: number;
};

export const mockTeamMembers: TeamMember[] = [
  {
    id: "u-1",
    name: "Lin Wu",
    email: "lin@studio.com",
    role: "owner",
    status: "active",
    joined: "2025-09-01",
    lastActive: "2 min ago",
    pointsUsed: 1248,
  },
  {
    id: "u-2",
    name: "Ada Reyes",
    email: "ada@studio.com",
    role: "admin",
    status: "active",
    joined: "2025-10-12",
    lastActive: "15 min ago",
    pointsUsed: 932,
  },
  {
    id: "u-3",
    name: "Tomás Vela",
    email: "tomas@studio.com",
    role: "editor",
    status: "active",
    joined: "2025-11-03",
    lastActive: "1 hour ago",
    pointsUsed: 510,
  },
  {
    id: "u-4",
    name: "Hana Mori",
    email: "hana@studio.com",
    role: "editor",
    status: "invited",
    joined: "2026-05-10",
    lastActive: "—",
    pointsUsed: 0,
  },
  {
    id: "u-5",
    name: "Riku Sato",
    email: "riku@studio.com",
    role: "viewer",
    status: "suspended",
    joined: "2025-12-19",
    lastActive: "5 days ago",
    pointsUsed: 22,
  },
];

export type AuditLog = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  ip: string;
};

export const mockAuditLogs: AuditLog[] = [
  {
    id: "l-1",
    ts: "2026-05-12 09:14",
    actor: "Lin Wu",
    action: "Generated script",
    target: "scr-001 v3",
    ip: "203.0.113.10",
  },
  {
    id: "l-2",
    ts: "2026-05-12 08:51",
    actor: "Ada Reyes",
    action: "Approved export",
    target: "project Lighthouse Reverie",
    ip: "203.0.113.18",
  },
  {
    id: "l-3",
    ts: "2026-05-12 08:02",
    actor: "Tomás Vela",
    action: "Created character",
    target: "ch-vendor",
    ip: "198.51.100.4",
  },
  {
    id: "l-4",
    ts: "2026-05-11 22:47",
    actor: "Lin Wu",
    action: "Invited member",
    target: "hana@studio.com",
    ip: "203.0.113.10",
  },
  {
    id: "l-5",
    ts: "2026-05-11 18:22",
    actor: "Riku Sato",
    action: "Login failed",
    target: "—",
    ip: "198.51.100.77",
  },
  {
    id: "l-6",
    ts: "2026-05-11 14:05",
    actor: "Ada Reyes",
    action: "Locked character",
    target: "ch-maya",
    ip: "203.0.113.18",
  },
];

export type ApprovalRequest = {
  id: string;
  requester: string;
  type: "export" | "share" | "delete";
  target: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
};

export const mockApprovals: ApprovalRequest[] = [
  {
    id: "a-1",
    requester: "Tomás Vela",
    type: "export",
    target: "Lighthouse Reverie — 1080p MP4",
    requestedAt: "2026-05-12 09:00",
    status: "pending",
  },
  {
    id: "a-2",
    requester: "Hana Mori",
    type: "share",
    target: "Character ch-vendor",
    requestedAt: "2026-05-12 08:30",
    status: "pending",
  },
  {
    id: "a-3",
    requester: "Tomás Vela",
    type: "export",
    target: "Founder Story Pitch — script.pdf",
    requestedAt: "2026-05-11 17:42",
    status: "approved",
  },
  {
    id: "a-4",
    requester: "Riku Sato",
    type: "delete",
    target: "Asset render-0091",
    requestedAt: "2026-05-10 10:11",
    status: "rejected",
  },
];

export const mockUsageDaily: { day: string; points: number; renders: number }[] = [
  { day: "Mon", points: 120, renders: 6 },
  { day: "Tue", points: 240, renders: 12 },
  { day: "Wed", points: 180, renders: 9 },
  { day: "Thu", points: 320, renders: 17 },
  { day: "Fri", points: 410, renders: 22 },
  { day: "Sat", points: 90, renders: 4 },
  { day: "Sun", points: 150, renders: 7 },
];

export const mockUsageByMember = mockTeamMembers.map((m) => ({
  name: m.name,
  points: m.pointsUsed,
}));

// ===================== Admin =====================
export type Tenant = {
  id: string;
  company: string;
  plan: "starter" | "pro" | "studio" | "enterprise";
  seats: number;
  status: "pending" | "active" | "suspended";
  created: string;
  contact: string;
};

export const mockTenants: Tenant[] = [
  {
    id: "t-1",
    company: "Aurora Studio",
    plan: "studio",
    seats: 12,
    status: "active",
    created: "2025-08-12",
    contact: "lin@aurora.io",
  },
  {
    id: "t-2",
    company: "BrightMCN",
    plan: "enterprise",
    seats: 48,
    status: "active",
    created: "2025-09-30",
    contact: "ops@brightmcn.com",
  },
  {
    id: "t-3",
    company: "Indie Reels",
    plan: "pro",
    seats: 3,
    status: "pending",
    created: "2026-05-11",
    contact: "hi@indiereels.tv",
  },
  {
    id: "t-4",
    company: "NorthWave",
    plan: "starter",
    seats: 1,
    status: "suspended",
    created: "2025-11-04",
    contact: "m@northwave.cn",
  },
];

export type AdminModel = {
  id: string;
  provider: string;
  name: string;
  modality: "text" | "image" | "video" | "audio";
  status: "online" | "offline" | "degraded";
  latencyMs: number;
  pricePerCall: number;
  apiKeyMasked: string;
};

export const mockAdminModels: AdminModel[] = [
  {
    id: "m-1",
    provider: "OpenAI",
    name: "gpt-5",
    modality: "text",
    status: "online",
    latencyMs: 820,
    pricePerCall: 0.03,
    apiKeyMasked: "sk-…f3a1",
  },
  {
    id: "m-2",
    provider: "Google",
    name: "gemini-2.5-flash-image-preview",
    modality: "image",
    status: "online",
    latencyMs: 1640,
    pricePerCall: 0.02,
    apiKeyMasked: "sk-…7c2e",
  },
  {
    id: "m-3",
    provider: "Kling",
    name: "kling-v3-1080p",
    modality: "video",
    status: "degraded",
    latencyMs: 14200,
    pricePerCall: 0.42,
    apiKeyMasked: "sk-…9d10",
  },
  {
    id: "m-4",
    provider: "ElevenLabs",
    name: "tts-multilingual-v2",
    modality: "audio",
    status: "online",
    latencyMs: 480,
    pricePerCall: 0.005,
    apiKeyMasked: "sk-…aa20",
  },
  {
    id: "m-5",
    provider: "OpenAI",
    name: "sora-1.0",
    modality: "video",
    status: "offline",
    latencyMs: 0,
    pricePerCall: 0.55,
    apiKeyMasked: "sk-…0099",
  },
];

export type Invoice = {
  id: string;
  tenant: string;
  amount: number;
  currency: "USD";
  period: string;
  status: "paid" | "pending" | "failed";
};

export const mockInvoices: Invoice[] = [
  {
    id: "inv-2026-04-001",
    tenant: "Aurora Studio",
    amount: 1490,
    currency: "USD",
    period: "2026-04",
    status: "paid",
  },
  {
    id: "inv-2026-04-002",
    tenant: "BrightMCN",
    amount: 5980,
    currency: "USD",
    period: "2026-04",
    status: "paid",
  },
  {
    id: "inv-2026-05-001",
    tenant: "Indie Reels",
    amount: 49,
    currency: "USD",
    period: "2026-05",
    status: "pending",
  },
  {
    id: "inv-2026-05-002",
    tenant: "NorthWave",
    amount: 19,
    currency: "USD",
    period: "2026-05",
    status: "failed",
  },
];

// ===================== Account =====================
export type RewardEntry = {
  id: string;
  ts: string;
  source: string;
  points: number;
  type: "earn" | "spend" | "cashout";
};

export const mockRewards: RewardEntry[] = [
  { id: "r-1", ts: "2026-05-12", source: "Daily login", points: 5, type: "earn" },
  { id: "r-2", ts: "2026-05-11", source: "Showcase upvotes (12)", points: 24, type: "earn" },
  { id: "r-3", ts: "2026-05-11", source: "Image render", points: -8, type: "spend" },
  { id: "r-4", ts: "2026-05-10", source: "Cashout to wallet", points: -200, type: "cashout" },
  { id: "r-5", ts: "2026-05-09", source: "Referral bonus", points: 100, type: "earn" },
];

export type Notification = {
  id: string;
  ts: string;
  title: string;
  body: string;
  read: boolean;
  kind: "info" | "success" | "warning";
};

export const mockNotifications: Notification[] = [
  {
    id: "n-1",
    ts: "2 min ago",
    title: "Render finished",
    body: "Lighthouse Reverie — Scene 2 is ready for review.",
    read: false,
    kind: "success",
  },
  {
    id: "n-2",
    ts: "1 hour ago",
    title: "Export pending approval",
    body: "Tomás requested a 1080p export.",
    read: false,
    kind: "info",
  },
  {
    id: "n-3",
    ts: "yesterday",
    title: "Quota at 80%",
    body: "You have used 80% of this month's points.",
    read: true,
    kind: "warning",
  },
];

// ===================== Showcase detail =====================
export type ShowcaseComment = { id: string; author: string; body: string; ts: string };
export type ShowcaseDetail = {
  id: string;
  title: string;
  author: string;
  description: string;
  likes: number;
  comments: { id: string; author: string; body: string; ts: string }[];
};

export const mockShowcaseDetails: Record<string, ShowcaseDetail> = {
  sorceress: {
    id: "sorceress",
    title: "The Heartless Sorceress",
    author: "Aurora Studio",
    description: "A 4-minute moody piece exploring loss through a withered enchanted garden.",
    likes: 1248,
    comments: [
      { id: "c1", author: "Hana", body: "The light rigs in scene 3 are unreal.", ts: "1d" },
      { id: "c2", author: "Tom", body: "Color grade goals.", ts: "2d" },
    ],
  },
  samurai: {
    id: "samurai",
    title: "Wandering Blade",
    author: "Indie Reels",
    description: "A wordless animation about a swordsman crossing the red sun.",
    likes: 884,
    comments: [{ id: "c1", author: "Riku", body: "The silence sells it.", ts: "3d" }],
  },
};
