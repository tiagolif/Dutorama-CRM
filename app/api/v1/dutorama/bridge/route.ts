import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authorizeDutoramaBridge } from "@/lib/dutorama/bridge-auth";
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
        legal_name: z.string().min(1).max(200).nullable().optional(),
        timezone: z.string().min(1).max(80).optional(),
        locale: z.string().min(2).max(20).optional(),
        status: z.enum(["active", "inactive", "suspended"]).optional(),
      })
      .refine((v) => Object.keys(v).length > 0, "changes cannot be empty"),
  }),
  z.object({ action: z.literal("list_channel_sessions"), organization_id: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).optional() }),
  z.object({ action: z.literal("list_contacts"), organization_id: z.string().uuid(), limit: z.number().int().min(1).max(100).optional() }),
  z.object({ action: z.literal("list_conversations"), organization_id: z.string().uuid(), limit: z.number().int().min(1).max(100).optional() }),
]);

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "bridge_unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

function response(data: unknown, status = 200) {
  return NextResponse.json(
    { ok: status < 400, data },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: NextRequest) {
  if (!authorizeDutoramaBridge(req)) return unauthorized();

  return response({
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
  });
}

export async function POST(req: NextRequest) {
  if (!authorizeDutoramaBridge(req)) return unauthorized();

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return response({ error: "invalid_json" }, 400);
  }

  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) {
    return response({ error: "invalid_request", details: parsed.error.flatten() }, 400);
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
        return response({
          organizations: orgs.count ?? 0,
          contacts: contacts.count ?? 0,
          conversations: conversations.count ?? 0,
          channel_sessions: channels.count ?? 0,
        });
      }

      case "list_organizations": {
        const { data, error } = await admin
          .from("organizations")
          .select("id,slug,display_name,legal_name,status,timezone,locale,created_at,updated_at")
          .order("created_at", { ascending: false })
          .limit(input.limit ?? 50);
        if (error) throw error;
        return response(data ?? []);
      }

      case "get_organization": {
        const { data, error } = await admin
          .from("organizations")
          .select("id,slug,display_name,legal_name,status,timezone,locale,media_retention_days,settings,onboarded_at,onboarding_state,created_at,updated_at")
          .eq("id", input.organization_id)
          .single();
        if (error) throw error;
        return response(data);
      }

      case "update_organization": {
        const { data, error } = await admin
          .from("organizations")
          .update(input.changes)
          .eq("id", input.organization_id)
          .select("id,slug,display_name,legal_name,status,timezone,locale,updated_at")
          .single();
        if (error) throw error;
        return response(data);
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
        return response(data ?? []);
      }

      case "list_contacts": {
        const { data, error } = await admin
          .from("contacts")
          .select("id,organization_id,name,phone,email,created_at,updated_at")
          .eq("organization_id", input.organization_id)
          .order("created_at", { ascending: false })
          .limit(input.limit ?? 50);
        if (error) throw error;
        return response(data ?? []);
      }

      case "list_conversations": {
        const { data, error } = await admin
          .from("conversations")
          .select("id,organization_id,contact_id,channel_session_id,status,assigned_user_id,last_inbound_at,last_outbound_at,created_at,updated_at")
          .eq("organization_id", input.organization_id)
          .order("updated_at", { ascending: false })
          .limit(input.limit ?? 50);
        if (error) throw error;
        return response(data ?? []);
      }
    }
  } catch (error) {
    console.error("[dutorama-bridge] action failed", error);
    return response({ error: "bridge_action_failed" }, 500);
  }
}
