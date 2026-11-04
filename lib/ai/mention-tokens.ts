/**
 * Inline mention tokens.
 *
 * A chosen reference is written into the message text as `lead:Jennifer Price`
 * or `user:Dana Whitfield`, exactly like a chat `@`-mention: it flows with the
 * sentence and is styled in place. These helpers decide which parts of a string
 * are tags — always matching against the references a message actually carries,
 * because a label can contain spaces and so cannot be found by pattern alone.
 *
 * Pure and client-safe, so the compose box and the message bubbles share them.
 */
import type { MentionRef } from "./types";

/** The inline text a reference is written as, e.g. `lead:Jennifer Price`. */
export function mentionToken(mention: MentionRef): string {
  return `${mention.kind}:${mention.label}`;
}

/** A run of text, tagged when it is a mention token. */
export interface MentionSegment {
  text: string;
  mention?: MentionRef;
}

/**
 * Split `text` into plain and tagged segments.
 *
 * Every occurrence of every known token is a tag. Overlapping matches keep the
 * first, so a shorter label contained in a longer one cannot split it.
 */
export function splitMentions(
  text: string,
  mentions: ReadonlyArray<MentionRef>,
): MentionSegment[] {
  const hits: Array<{ start: number; end: number; mention: MentionRef }> = [];

  for (const mention of mentions) {
    const token = mentionToken(mention);
    if (!token) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(token, from);
      if (at === -1) break;
      hits.push({ start: at, end: at + token.length, mention });
      from = at + token.length;
    }
  }

  hits.sort((a, b) => a.start - b.start || b.end - a.end);

  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start < cursor) continue;
    if (hit.start > cursor) segments.push({ text: text.slice(cursor, hit.start) });
    segments.push({
      text: text.slice(hit.start, hit.end),
      mention: hit.mention,
    });
    cursor = hit.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });

  return segments;
}

/**
 * The references whose token still appears in `text`.
 *
 * Used on send: editing a label so it no longer spells the record drops the
 * reference, so the request never carries a tag the message no longer shows.
 */
export function activeMentions(
  text: string,
  mentions: ReadonlyArray<MentionRef>,
): MentionRef[] {
  return mentions.filter((mention) => text.includes(mentionToken(mention)));
}

/** De-duplicate references by kind and id, newest last. */
export function mergeMentions(
  base: ReadonlyArray<MentionRef>,
  extra: ReadonlyArray<MentionRef>,
): MentionRef[] {
  const seen = new Map<string, MentionRef>();
  for (const mention of [...base, ...extra]) {
    seen.set(`${mention.kind}:${mention.id}`, mention);
  }
  return [...seen.values()];
}
