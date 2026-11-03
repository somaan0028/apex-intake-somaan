import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Users · Apex Intake Desk",
};

export default function UsersPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      <p className="text-muted-foreground">
        This is the users page. User management (admins only) will live here.
      </p>
    </div>
  );
}
