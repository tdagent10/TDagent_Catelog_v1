"use server";

import { cookies } from "next/headers";
import { createServerClient } from "@/lib/supabase/server";

export type ShareTokenInfo = {
  token: string;
  mobileNumber: string;
};

/** The signed-in shopkeeper's own share token. Nothing of anyone else's. */
export async function getMyShareToken(): Promise<ShareTokenInfo | null> {
  const jar = await cookies();
  const userId = jar.get("tdagent_user")?.value;
  if (!userId) return null;

  const supabase = createServerClient();
  const { data, error } = await supabase.rpc("get_my_share_token", {
    p_user_id: userId,
  });

  if (error) {
    console.error("get_my_share_token failed:", error);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;

  const r = row as Record<string, unknown>;
  if (typeof r.share_token !== "string" || typeof r.mobile_number !== "string") {
    return null;
  }

  return { token: r.share_token, mobileNumber: r.mobile_number };
}
