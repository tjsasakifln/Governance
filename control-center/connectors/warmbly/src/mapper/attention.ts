import type {
  AttentionKind,
  AttentionSeverity,
  CommercialAttentionItem,
  FreshnessStatus,
} from "../contracts/snapshot.ts";
import type {
  WarmblyActionCard,
  WarmblyAttentionItem,
  WarmblyCampaign,
  WarmblyDeal,
  WarmblyInboundItem,
  WarmblyTask,
  WarmblyUniboxOverview,
} from "../contracts/warmbly-payload.ts";
import { mapConfidence, parseUtc, provenance } from "./freshness.ts";

const STALL_MS = 14 * 24 * 60 * 60 * 1000;
const NEXT_ACTION_WINDOW_MS = 24 * 60 * 60 * 1000;

const TERMINAL_TASK = new Set(["completed", "cancelled"]);
const HIGH_PRIORITY = new Set(["high", "urgent"]);
const INBOUND_DONE = new Set([
  "done",
  "completed",
  "handled",
  "closed",
  "won",
  "lost",
  "dnc",
  "do_not_contact",
]);

export type AttentionContext = {
  now: Date;
  freshness: FreshnessStatus;
};

function item(
  kind: AttentionKind,
  entityType: string,
  entityId: string,
  title: string,
  why: string,
  severity: AttentionSeverity,
  ctx: AttentionContext,
  extra?: {
    due_at?: string;
    commercial_state?: string;
    confidence?: number;
  },
): CommercialAttentionItem {
  const row: CommercialAttentionItem = {
    id: `warmbly:${entityType}:${entityId}:${kind}`,
    kind,
    title,
    why,
    severity,
    entity_ref: { type: entityType, id: entityId },
    provenance: provenance(ctx.now, ctx.freshness, extra?.confidence),
  };
  if (extra?.due_at) {
    row.due_at = extra.due_at;
  }
  if (extra?.commercial_state) {
    row.commercial_state = extra.commercial_state;
  }
  return row;
}

export function attentionFromTasks(tasks: WarmblyTask[], ctx: AttentionContext): CommercialAttentionItem[] {
  const out: CommercialAttentionItem[] = [];
  for (const task of tasks) {
    const status = (task.status ?? "").toLowerCase();
    if (TERMINAL_TASK.has(status)) {
      continue;
    }
    const due = parseUtc(task.due_date);
    const overdue = Boolean(due && due.getTime() < ctx.now.getTime());
    if (overdue && task.due_date) {
      out.push(
        item(
          "overdue_task",
          "task",
          task.id,
          task.title,
          `CRM task is overdue (due ${task.due_date})`,
          task.priority && HIGH_PRIORITY.has(task.priority.toLowerCase()) ? "high" : "high",
          ctx,
          { due_at: task.due_date, commercial_state: status },
        ),
      );
      continue;
    }
    const dueSoon = Boolean(
      due && due.getTime() - ctx.now.getTime() <= NEXT_ACTION_WINDOW_MS && due.getTime() >= ctx.now.getTime(),
    );
    const hot = HIGH_PRIORITY.has((task.priority ?? "").toLowerCase());
    if (dueSoon || hot) {
      out.push(
        item(
          "next_action",
          "task",
          task.id,
          task.title,
          dueSoon
            ? `Next CRM action is due ${task.due_date}`
            : `Open ${task.priority ?? "high"}-priority CRM task`,
          hot ? "high" : "medium",
          ctx,
          { due_at: task.due_date ?? undefined, commercial_state: status },
        ),
      );
    }
  }
  return out;
}

export function attentionFromDeals(deals: WarmblyDeal[], ctx: AttentionContext): CommercialAttentionItem[] {
  const out: CommercialAttentionItem[] = [];
  for (const deal of deals) {
    const status = (deal.status ?? "").toLowerCase();
    if (status !== "open") {
      continue;
    }
    const updated = parseUtc(deal.updated_at);
    if (!updated) {
      continue;
    }
    if (ctx.now.getTime() - updated.getTime() >= STALL_MS) {
      out.push(
        item(
          "stalled_deal",
          "deal",
          deal.id,
          deal.name,
          `Open deal has not moved since ${deal.updated_at}`,
          "medium",
          ctx,
          { commercial_state: status },
        ),
      );
    }
  }
  return out;
}

export function attentionFromCampaigns(
  campaigns: WarmblyCampaign[],
  ctx: AttentionContext,
): CommercialAttentionItem[] {
  const out: CommercialAttentionItem[] = [];
  for (const campaign of campaigns) {
    const tripped = Boolean(campaign.guardrail_tripped_at);
    const status = (campaign.status ?? "").toLowerCase();
    const exceptional =
      tripped ||
      status.includes("guardrail") ||
      status === "error" ||
      status === "failed";
    if (!exceptional) {
      continue;
    }
    out.push(
      item(
        "campaign_signal",
        "campaign",
        campaign.id,
        campaign.name,
        campaign.guardrail_reason
          ? `Campaign needs a human: ${campaign.guardrail_reason}`
          : `Campaign in exceptional state ${campaign.status}`,
        "high",
        ctx,
        { commercial_state: campaign.status },
      ),
    );
  }
  return out;
}

export function attentionFromUnibox(
  overview: WarmblyUniboxOverview | undefined,
  ctx: AttentionContext,
): CommercialAttentionItem[] {
  if (!overview) {
    return [];
  }
  const out: CommercialAttentionItem[] = [];
  if ((overview.unread ?? 0) > 0) {
    out.push(
      item(
        "inbox_signal",
        "unibox",
        "unread",
        `${overview.unread} unread inbox threads`,
        "Unibox has unread mail that needs a human",
        overview.unread && overview.unread >= 5 ? "high" : "medium",
        ctx,
        { commercial_state: "unread" },
      ),
    );
  }
  if ((overview.awaiting_reply ?? 0) > 0) {
    out.push(
      item(
        "inbox_signal",
        "unibox",
        "awaiting_reply",
        `${overview.awaiting_reply} threads awaiting reply`,
        "Unibox has unreplied threads",
        "high",
        ctx,
        { commercial_state: "awaiting_reply" },
      ),
    );
  }
  if ((overview.awaiting_agent_draft ?? 0) > 0) {
    out.push(
      item(
        "inbox_signal",
        "unibox",
        "awaiting_agent_draft",
        `${overview.awaiting_agent_draft} inbox drafts awaiting review`,
        "Inbox-agent drafts need a human decision",
        "medium",
        ctx,
        { commercial_state: "awaiting_agent_draft" },
      ),
    );
  }
  return out;
}

export function attentionFromConfenge(
  items: WarmblyAttentionItem[],
  ctx: AttentionContext,
): CommercialAttentionItem[] {
  return items.map((row) =>
    item(
      "confenge_attention",
      "account",
      row.account_id,
      row.company_name,
      row.suggested_action ||
        `Warmbly account in ${row.commercial_state || row.queue_state || "needs_attention"}`,
      "high",
      ctx,
      {
        commercial_state: row.commercial_state || row.queue_state,
        confidence: mapConfidence(row.confidence),
      },
    ),
  );
}

export function attentionFromToday(
  cards: WarmblyActionCard[],
  ctx: AttentionContext,
): CommercialAttentionItem[] {
  const out: CommercialAttentionItem[] = [];
  for (const card of cards) {
    if (card.actionable === false) {
      continue;
    }
    const due = parseUtc(card.next_action_at);
    const dueNow = !due || due.getTime() <= ctx.now.getTime() + NEXT_ACTION_WINDOW_MS;
    if (!dueNow) {
      continue;
    }
    out.push(
      item(
        "next_action",
        "action",
        card.action_id,
        card.company ? `${card.company}: ${card.recommended_action ?? "next action"}` : (card.recommended_action ?? "Next commercial action"),
        card.why_now || "Confenge today-view action requires a human",
        "high",
        ctx,
        {
          due_at: card.next_action_at,
          commercial_state: card.state,
          confidence: mapConfidence(card.confidence),
        },
      ),
    );
  }
  return out;
}

export function attentionFromInbound(
  items: WarmblyInboundItem[],
  ctx: AttentionContext,
): CommercialAttentionItem[] {
  const out: CommercialAttentionItem[] = [];
  for (const lead of items) {
    const status = (lead.status ?? "new").toLowerCase();
    if (INBOUND_DONE.has(status)) {
      continue;
    }
    out.push(
      item(
        "inbound_lead",
        "inbound_lead",
        lead.lead_id,
        lead.company || lead.person || lead.lead_id,
        lead.why_now || lead.recommended_action || "Inbound lead needs a human",
        "high",
        ctx,
        {
          commercial_state: lead.status,
          confidence: mapConfidence(lead.confidence),
        },
      ),
    );
  }
  return out;
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function sortAttention(items: CommercialAttentionItem[]): CommercialAttentionItem[] {
  return [...items].sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) {
      return s;
    }
    return a.id.localeCompare(b.id);
  });
}

export function dedupeAttention(items: CommercialAttentionItem[]): CommercialAttentionItem[] {
  const seen = new Set<string>();
  const out: CommercialAttentionItem[] = [];
  for (const row of items) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    out.push(row);
  }
  return out;
}
