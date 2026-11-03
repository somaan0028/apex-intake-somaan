import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Clock, Lock, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { IntakeForm } from "@/components/intake/intake-form";

export const metadata: Metadata = {
  title: "Apex Intake Desk",
  description:
    "Answer a few quick questions so our intake team can follow up with you.",
};

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-4 sm:px-8">
        <span className="flex items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheck className="size-4" />
          </span>
          Apex Intake Desk
        </span>
        <Link
          href="/login"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Team log in
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-6 sm:px-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <BadgeCheck className="size-3.5" />
            Secure intake
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Tell us what happened in about two minutes
          </h1>
          <p className="max-w-md text-muted-foreground text-pretty">
            Answer a few quick questions and our intake team will follow up with
            you.
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

      <footer className="mx-auto w-full max-w-2xl px-5 pb-8 text-center text-xs text-muted-foreground sm:px-8">
        Apex Lead Source · This is not legal advice.
      </footer>
    </div>
  );
}
