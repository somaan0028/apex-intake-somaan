"use client";

/**
 * Larry's home on the Overview page.
 *
 * A Client Component because opening the panel is an interaction and the mascot
 * is animated; it holds no state of its own and calls the shell's `open()`
 * handle, the same one the header button uses.
 *
 * It is a tall, vertically-centred card in the right-hand column, deliberately
 * larger than a utility tile: the assistant should feel like a colleague
 * waiting on the page. The card stretches to the height of the two panels beside
 * it, so the page's right edge is one calm, personal block rather than a list.
 */
import { Sparkles } from "lucide-react";
import { useAiAssistant } from "@/components/ai/assistant-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ASSISTANT_NAME } from "@/lib/ai/identity";
import { cn } from "@/lib/utils";
import { LarryMascot } from "@/components/ai/larry-mascot";

export function AssistantInvite({
  firstName,
  className,
}: {
  firstName: string;
  className?: string;
}) {
  const { open } = useAiAssistant();

  return (
    <Card
      className={cn("h-full border-primary/30 bg-primary/5", className)}
    >
      <CardContent className="flex h-full flex-col items-center justify-center gap-5 px-6 py-8 text-center">
        <button
          type="button"
          onClick={() => open()}
          aria-label={`Chat with ${ASSISTANT_NAME}`}
          title={`Chat with ${ASSISTANT_NAME}`}
          className="group rounded-3xl outline-offset-4"
        >
          <LarryMascot className="size-40 transition-transform duration-300 group-hover:scale-105" />
        </button>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Your AI assistant
          </p>
          <p className="text-lg font-semibold tracking-tight">
            Hi {firstName} — I&apos;m {ASSISTANT_NAME}.
          </p>
          <p className="mx-auto max-w-xs text-sm text-muted-foreground">
            Ask me about your leads, your team, or what to work on next.
          </p>
        </div>

        <Button onClick={() => open()}>
          <Sparkles />
          Chat with {ASSISTANT_NAME}
        </Button>
      </CardContent>
    </Card>
  );
}
