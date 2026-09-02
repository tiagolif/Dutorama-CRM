import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { authorizeDutoramaBridge } from "@/lib/dutorama/bridge-auth";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("system_summary") }),
  z.object({ action: z.literal("list_organizations"), limit: z.number().int().min(1).max(100).optional() }),
  z.object({ action: z.literal("get_organization"), organization_id: z.string().uuid() }),
  z.object({
    action: z.literal("update_organization"),
    organization_id: z.string().uuid(),
    changes: z
      .object({
        display_name: z.string().min(1).max(160).optional(),
        legal_name: z.string().min(1).max(200).optional(),
        timezone: z.string().min(1).max(80).optional(),
        locale: z.string().min(2).max(20).optional(),
        status: z.enum(["active", "suspended"]).optional(),
      })
      .refine((v) => Object.keys(v).length > 0, "changes cannot be empty"),
  }),
  z.object({ action: z.literal("list_channel_sessions"), organization_id: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).optional() }),
  z.object({ action: z.literal("list_contacts"), organization_id: z.string().uuid(), limit: z.number().int().min(1).max(100).optional() }),
  z.object({ action: z.literal("list_conversations"), organization_id: z.string().uuid(), limit: z.number().int().min(1).max(100).optional() }),
]);

const noStore = { "Cache-Control": "no-store" };

function unauthorized(requestId: string) {
  return fail("bridge_unauthorized", "Credencial da ponte inválida.", 401, {
    requestId,
    headers: noStore,
  });
}

function requestId(req: NextRequest): string {
  return req.headers.get("x-request-id") ?? randomUUID();
}

export async function GET(req: NextRequest) {
  const id = requestId(req);
  if (!authorizeDutoramaBridge(req)) return unauthorized(id);

  return ok({
    service: "dutorama-bridge",
    status: "ready",
    version: 1,
    capabilities: [
      "system_summary",
      "list_organizations",
      "get_organization",
      "update_organization",
      "list_channel_sessions",
      "list_contacts",
      "list_conversations",
    ],
  }, { requestId: id, headers: noStore });
}

export async function POST(req: NextRequest) {
  const id = requestId(req);
  if (!authorizeDutoramaBridge(req)) return unauthorized(id);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return fail("invalid_json", "O corpo precisa ser um JSON válido.", 400, {
      requestId: id,
      headers: noStore,
    });
  }

  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) {
    return fail("invalid_request", "A ação solicitada é inválida.", 400, {
      details: parsed.error.flatten(),
      requestId: id,
      headers: noStore,
    });
  }

  const admin = createAdminClient();
  const input = parsed.data;

  try {
    switch (input.action) {
      case "system_summary": {
        const [orgs, contacts, conversations, channels] = await Promise.all([
          admin.from("organizations").select("*", { count: "exact", head: true }),
          admin.from("contacts").select("*", { count: "exact", head: true }),
          admin.from("conversations").select("*", { count: "exact", head: true }),
          admin.from("channel_sessions").select("*", { count: "exact", head: true }),
        ]);
        return ok({
          organizations: orgs.count ?? 0,
          contacts: contacts.count ?? 0,
          conversations: conversations.count ?? 0,
          channel_sessions: channels.count ?? 0,
        }, { requestId: id, headers: noStore });
      }

      case "list_organizations": {
        const { data, error } = await admin
          .from("organizations")
          .select("id,slug,display_name,legal_name,status,timezone,locale,created_at,updated_at")
          .order("created_at", { ascending: false })
          .limit(input.limit ?? 50);
        if (error) throw error;
        return ok(data ?? [], { requestId: id, headers: noStore });
      }

      case "get_organization": {
        const { data, error } = await admin
          .from("organizations")
          .select("id,slug,display_name,legal_name,status,timezone,locale,media_retention_days,settings,onboarded_at,onboarding_state,created_at,updated_at")
          .eq("id", input.organization_id)
          .single();
        if (error) throw error;
        return ok(data, { requestId: id, headers: noStore });
      }

      case "update_organization": {
        const { data, error } = await admin
          .from("organizations")
          .update(input.changes)
          .eq("id", input.organization_id)
          .select("id,slug,display_name,legal_name,status,timezone,locale,updated_at")
          .single();
        if (error) throw error;
        void audit({
          action: "dutorama.organization_updated",
          organizationId: input.organization_id,
          resourceType: "organization",
          resourceId: input.organization_id,
          requestId: id,
          bypassedRls: true,
          actingAsPlatformAdmin: true,
          metadata: { changed_fields: Object.keys(input.changes).sort() },
        });
        return ok(data, { requestId: id, headers: noStore });
      }

      case "list_channel_sessions": {
        let query = admin
          .from("channel_sessions")
          .select("id,organization_id,provider,status,status_reason,display_name,phone_number,created_at,updated_at")
          .order("created_at", { ascending: false })
          .limit(input.limit ?? 50);
        if (input.organization_id) query = query.eq("organization_id", input.organization_id);
        const { data, error } = await query;
        if (error) throw error;
        return ok(data ?? [], { requestId: id, headers: noStore });
      }

      case "list_contacts": {
        const { data, error } = await admin
          .from("contacts")
          .select("id,organization_id,name,display_name,phone_number,email,created_at,updated_at")
          .eq("organization_id", input.organization_id)
          .order("created_at", { ascending: false })
          .limit(input.limit ?? 50);
        if (error) throw error;
        return ok(data ?? [], { requestId: id, headers: noStore });
      }

      case "list_conversations": {
        const { data, error } = await admin
          .from("conversations")
          .select("id,organization_id,contact_id,channel_session_id,status,assigned_to_user_id,last_inbound_at,last_outbound_at,last_message_at,last_message_preview,created_at,updated_at")
          .eq("organization_id", input.organization_id)
          .order("updated_at", { ascending: false })
          .limit(input.limit ?? 50);
        if (error) throw error;
        return ok(data ?? [], { requestId: id, headers: noStore });
      }
    }
  } catch (error) {
    logger.error("[dutorama-bridge] falha ao executar ação", {
      action: input.action,
      error: error instanceof Error ? error.message : "erro desconhecido",
      request_id: id,
    });
    return fail("bridge_action_failed", "Não foi possível executar a ação da ponte.", 500, {
      requestId: id,
      headers: noStore,
    });
  }
}
