import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Overview · Apex Intake Desk",
};

export default function OverviewPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="text-muted-foreground">
        This is the overview page. Pipeline metrics and the unassigned queue will
        live here.
      </p>
    </div>
  );
}
