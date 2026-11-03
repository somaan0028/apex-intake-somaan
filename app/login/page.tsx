import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

// Reads the session (which hits the database), so it renders per request rather
// than being prerendered into the static shell.
export const instant = false;

export const metadata: Metadata = {
  title: "Log in · Apex Intake Desk",
};

export default async function LoginPage() {
  // Already signed in with a still-valid session? Skip the form. Validating
  // here (rather than in `proxy.ts`) is what prevents the redirect loop a stale
  // cookie would otherwise cause.
  if (await getCurrentUser()) {
    redirect("/dashboard");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Log in</CardTitle>
          <CardDescription>
            Sign in with your Apex email and password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
