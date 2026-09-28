import { LoginForm } from "@/components/login-form";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col bg-white">
      <div className="flex flex-1 flex-col px-5 pt-[14dvh] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-12 sm:pt-[22vh] sm:pb-16">
        <h1 className="text-center text-[38px] leading-none font-extrabold tracking-tight text-brand sm:text-[56px]">
          TDagent
        </h1>

        <div className="mt-[8dvh] w-full max-w-[520px] self-center sm:mt-[13vh]">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
