"use client";

import { useActionState } from "react";
import { loginOrSignup, type AuthState } from "@/app/actions";
import { PhoneIcon } from "@/components/phone-icon";

const initialState: AuthState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginOrSignup, initialState);

  return (
    <form action={formAction} className="w-full">
      <label
        htmlFor="mobileNumber"
        className="block text-[17px] font-bold tracking-tight text-foreground"
      >
        Mobile Number
      </label>

      <div className="relative mt-4">
        <PhoneIcon className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-field-placeholder sm:left-5 sm:h-7 sm:w-7" />
        <input
          id="mobileNumber"
          name="mobileNumber"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="Enter your mobile number"
          aria-describedby="auth-feedback"
          className="h-[60px] w-full rounded-xl border border-field-border bg-white pr-4 pl-13 text-[16px] text-foreground outline-none transition-colors placeholder:text-field-placeholder focus:border-brand sm:h-[68px] sm:pr-5 sm:pl-16 sm:text-[17px]"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-6 h-[56px] w-full touch-manipulation rounded-xl bg-brand text-[18px] font-bold text-white transition-colors hover:bg-brand-dark active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:mt-8 sm:h-[68px] sm:text-[20px]"
      >
        {pending ? "Please wait…" : "Signup/Login"}
      </button>

      <p
        id="auth-feedback"
        aria-live="polite"
        className="mt-4 min-h-5 text-center text-sm font-medium"
        role={state.error ? "alert" : undefined}
      >
        {state.error && <span className="text-brand">{state.error}</span>}
        {state.message && <span className="text-foreground">{state.message}</span>}
      </p>
    </form>
  );
}
