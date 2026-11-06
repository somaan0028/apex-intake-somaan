"use client";

/**
 * Larry's home on the Overview page.
 *
 * A Client Component because opening the panel is an interaction and the mascot
 * is animated; it holds no state of its own and calls the shell's `open()`
 * handle, the same one the header button uses.
 *
 * It is a horizontally-arranged card in the right-hand column: the mascot sits
 * on the left and the greeting, invite and button stack beside it, so the card
 * reads as a colleague waiting on the page rather than a tall poster. It sizes
 * to its content rather than stretching to the height of the two panels beside
 * it, which left too much empty space.
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
      className={cn(
        "border-primary/30",
        className,
      )}
    >
      <CardContent className="flex flex-col items-center gap-5 px-6 py-8 text-center sm:flex-row sm:items-center sm:gap-6 sm:text-left">
        <button
          type="button"
          onClick={() => open()}
          aria-label={`Chat with ${ASSISTANT_NAME}`}
          title={`Chat with ${ASSISTANT_NAME}`}
          className="group shrink-0 rounded-3xl outline-offset-4"
        >
          <LarryMascot className="size-32 transition-transform duration-300 group-hover:scale-105" />
        </button>

        <div className="flex min-w-0 flex-col items-center gap-3 sm:items-start">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Your AI assistant
            </p>
            <p className="text-lg font-semibold tracking-tight">
              Hi {firstName}, I&apos;m {ASSISTANT_NAME}.
            </p>
            <p className="max-w-xs text-sm text-muted-foreground">
              I&apos;m here to help you manage leads and answer your questions!
            </p>
          </div>

          <Button onClick={() => open()}>
            <Sparkles />
            Chat with {ASSISTANT_NAME}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
