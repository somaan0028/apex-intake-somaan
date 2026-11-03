import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Leads · Apex Intake Desk",
};

export default function LeadsPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
      <p className="text-muted-foreground">
        This is the leads page. The searchable, filterable lead table will live
        here.
      </p>
    </div>
  );
}
