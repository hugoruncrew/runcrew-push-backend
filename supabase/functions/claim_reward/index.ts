// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
// Supabase Edge Function: claim_reward
// Validates that current user has permission and calls redeem_reward_for_user

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Environment vars injected by Supabase
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { rewardId, userId, runId } = await req.json();
    if (!rewardId || !userId) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get admin (caller) from JWT
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Decode token to get UID (no verification here because gateway already verified)
    const { sub: adminId } = JSON.parse(atob(jwt.split(".")[1])) as { sub: string };

    // Call RPC with service role so RLS bypassed while internal checks run
    const { error } = await supabaseAdmin.rpc("redeem_reward_for_user", {
      p_admin_id: adminId,
      p_user_id: userId,
      p_reward_id: rewardId,
      p_run_id: runId,
    });

    if (error) {
      console.error(error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message || "Unexpected error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}); 