import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Apex Intake Desk",
};

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">This is the home route.</h1>
        <p className="text-muted-foreground">
          Public landing page. Every route except this one and{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
            /login
          </code>{" "}
          requires a session.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/login" className={buttonVariants()}>
          Log in
        </Link>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
