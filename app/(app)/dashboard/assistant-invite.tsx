"use client";

/**
 * Larry's invitation on the Overview page.
 *
 * A Client Component because opening the panel is an interaction and the mascot
 * is animated; it holds no state of its own and calls the shell's `open()`
 * handle, the same one the header button uses.
 *
 * It is deliberately the first card in the content grid: the assistant should
 * feel like a colleague waiting on the page, not a footnote at the bottom.
 */
import { Sparkles } from "lucide-react";
import { useAiAssistant } from "@/components/ai/assistant-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ASSISTANT_NAME } from "@/lib/ai/identity";
import { LarryMascot } from "@/components/ai/larry-mascot";

export function AssistantInvite({ firstName }: { firstName: string }) {
  const { open } = useAiAssistant();

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => open()}
          aria-label={`Chat with ${ASSISTANT_NAME}`}
          title={`Chat with ${ASSISTANT_NAME}`}
          className="group -my-1 shrink-0 rounded-2xl outline-offset-4"
        >
          <LarryMascot className="size-24 transition-transform duration-300 group-hover:scale-105" />
        </button>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Your AI assistant
          </p>
          <p className="text-base font-semibold tracking-tight">
            Hi {firstName} — I&apos;m {ASSISTANT_NAME}.
          </p>
          <p className="text-sm text-muted-foreground">
            Ask me about your leads, your team, or what to work on next.
          </p>
        </div>

        <Button size="sm" className="shrink-0" onClick={() => open()}>
          <Sparkles />
          Chat with {ASSISTANT_NAME}
        </Button>
      </CardContent>
    </Card>
  );
}
