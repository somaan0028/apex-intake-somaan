import type { Metadata } from "next";
import { Clock, Lock, ShieldCheck } from "lucide-react";
import { IntakeForm } from "@/components/intake/intake-form";

export const metadata: Metadata = {
  title: "New client intake",
  description:
    "Tell us about your matter. Everything you share is confidential.",
};

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      {/* Public form: no team log-in (or anything else that hints at the desk
          behind it) belongs on this page. */}
      <header className="mx-auto flex w-full max-w-2xl items-center px-5 py-4 sm:px-8">
        <span className="flex items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheck className="size-4" />
          </span>
          Apex Intake
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-6 sm:px-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            New client intake
          </h1>
          <p className="max-w-md text-muted-foreground text-pretty">
            Tell us about your matter. Everything you share is confidential.
          </p>
        </div>

        <IntakeForm />

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" />
            Your information is private
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" />
            Takes about two minutes
          </span>
        </div>
      </main>
    </div>
  );
}
