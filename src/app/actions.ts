"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createServerClient,
  SupabaseNotConfiguredError,
} from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
  message?: string;
};

const MOBILE_COOKIE = "tdagent_user";

/** Keeps digits and a single leading +, nothing else. */
function normaliseMobile(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}

/** Turns a raw PostgREST error into something a shopkeeper can act on. */
function explainRpcError(message: string): string {
  const m = message.toLowerCase();

  if (m.includes("invalid api key") || m.includes("jwt") || m.includes("apikey")) {
    return "Supabase rejected the API key. Check NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart the dev server.";
  }
  if (
    m.includes("could not find the function") ||
    m.includes("undefined_function") ||
    m.includes("does not exist")
  ) {
    return "The login_or_signup function is missing. Run supabase/migrations/0001_app_users.sql in the Supabase SQL editor.";
  }
  if (m.includes("permission denied") || m.includes("rls")) {
    return "Supabase blocked the request. Check that the function grants execute to anon.";
  }
  if (m.includes("failed to fetch") || m.includes("network")) {
    return "Could not reach Supabase. Check your internet connection.";
  }

  return "Could not sign you in. Please try again.";
}

export async function loginOrSignup(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const mobileNumber = normaliseMobile(String(formData.get("mobileNumber") ?? ""));

  // 7-15 digits covers E.164 without assuming a single country's length.
  if (!/^\+?\d{7,15}$/.test(mobileNumber)) {
    return { error: "Enter a valid mobile number." };
  }

  try {
    const supabase = createServerClient();

    const { data, error } = await supabase.rpc("login_or_signup", {
      p_mobile_number: mobileNumber,
    });

    if (error) {
      console.error("login_or_signup failed:", error);
      return { error: explainRpcError(error.message) };
    }

    const user = Array.isArray(data) ? data[0] : data;
    if (!user?.id) {
      return { error: "Something went wrong. Please try again." };
    }

    const jar = await cookies();
    jar.set(MOBILE_COOKIE, user.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return { error: err.message };
    }
    console.error("loginOrSignup threw:", err);
    return { error: "Could not sign you in. Please try again." };
  }

  // Must sit OUTSIDE the try above: redirect() signals by throwing
  // NEXT_REDIRECT, and a surrounding catch would swallow it and turn a
  // successful login into an error message.
  redirect("/catalog");
}
