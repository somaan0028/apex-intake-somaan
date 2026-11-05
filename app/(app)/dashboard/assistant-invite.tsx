"use client";

/**
 * The assistant's invitation on the Overview page.
 *
 * It has to be a Client Component because opening the panel is an interaction,
 * but it holds no state of its own: it calls the shell's `open()` handle, which
 * is also what the header button uses. That way the panel keeps its conversation
 * and behaves identically however it was opened.
 *
 * It is deliberately a thin bar rather than a feature card: the page's content
 * is the pipeline and the latest leads. The panel's own empty state already
 * offers starter questions, so this card only has to be an obvious way in.
 */
import { Sparkles } from "lucide-react";
import { useAiAssistant } from "@/components/ai/assistant-context";
import { AssistantMascot } from "@/components/ai/assistant-mascot";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function AssistantInvite({ greeting }: { greeting: string }) {
  const { open } = useAiAssistant();

  return (
    <Card size="sm" className="border-primary/30 bg-primary/5">
      <CardContent className="flex items-center gap-3">
        <AssistantMascot className="size-8 shrink-0" />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight">{greeting}</p>
          <p className="truncate text-xs text-muted-foreground">
            Ask about your leads, the team, or what needs doing next.
          </p>
        </div>

        <Button size="sm" className="shrink-0" onClick={() => open()}>
          <Sparkles />
          Ask the assistant
        </Button>
      </CardContent>
    </Card>
  );
}
