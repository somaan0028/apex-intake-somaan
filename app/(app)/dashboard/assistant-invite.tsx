"use client";

/**
 * The assistant's invitation on the Overview page.
 *
 * It has to be a Client Component because opening the panel is an interaction,
 * but it holds no state of its own: it calls the shell's `open()` handle, which
 * is also what the header button uses. That way the panel keeps its conversation
 * and behaves identically however it was opened.
 */
import { ArrowRight, Sparkles } from "lucide-react";
import { useAiAssistant } from "@/components/ai/assistant-context";
import { AssistantMascot } from "@/components/ai/assistant-mascot";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Openers that show what the assistant is good at. Each is answerable from the
 * leads and users the viewer already has, and phrased the way someone would
 * actually type it — plain questions, no jargon.
 */
const SUGGESTIONS = [
  "What should I work on first today?",
  "Show me the newest unassigned leads",
  "Which MVA leads are ready to send to the firm?",
];

export function AssistantInvite({ greeting }: { greeting: string }) {
  const { open } = useAiAssistant();

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="grid gap-5 p-5 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-8">
        <div className="flex items-center gap-3.5">
          <AssistantMascot className="size-14 shrink-0" />
          <div className="space-y-2.5">
            <h2 className="text-base font-semibold tracking-tight">
              {greeting}
            </h2>
            <p className="text-sm text-muted-foreground">
              Ask about your leads, the team, or what needs doing next.
            </p>
            <Button size="sm" onClick={() => open()}>
              <Sparkles />
              Chat with the assistant
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Try one of these
          </p>
          <ul className="grid gap-1.5">
            {SUGGESTIONS.map((question) => (
              <li key={question}>
                <button
                  type="button"
                  onClick={() => open(question)}
                  className="flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">{question}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
