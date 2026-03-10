/**
 * 解析 agent 文本输出中的 <lximg> <lxfile> 标签，构建发送队列。
 * 类似 qqbot 的 <qqimg> 解析，用于自研 gateway 媒体发送。
 */

export type LanxinMediaTagKind = "image" | "file";

export type LanxinSendQueueItem =
  | { type: "text"; content: string }
  | { type: "image"; path: string }
  | { type: "file"; path: string };

const LXIMG_REGEX = /<lximg>([^<>]+)<\/(?:lximg|img)>/gi;
const LXFILE_REGEX = /<lxfile>([^<>]+)<\/(?:lxfile|file)>/gi;

type TagMatch = { index: number; length: number; kind: LanxinMediaTagKind; path: string };

function collectTagMatches(text: string): TagMatch[] {
  const matches: TagMatch[] = [];
  let m: RegExpExecArray | null;

  const re1 = new RegExp(LXIMG_REGEX.source, "gi");
  while ((m = re1.exec(text)) !== null) {
    const path = m[1]?.trim();
    if (path) {
      matches.push({ index: m.index, length: m[0].length, kind: "image", path });
    }
  }

  const re2 = new RegExp(LXFILE_REGEX.source, "gi");
  while ((m = re2.exec(text)) !== null) {
    const path = m[1]?.trim();
    if (path) {
      matches.push({ index: m.index, length: m[0].length, kind: "file", path });
    }
  }

  matches.sort((a, b) => a.index - b.index);
  return matches;
}

/**
 * 解析文本中的 <lximg> <lxfile> 标签，返回发送队列。
 * 若无标签则返回 null，表示按普通文本发送。
 */
export function parseLanxinMediaTags(text: string): LanxinSendQueueItem[] | null {
  const matches = collectTagMatches(text);
  if (matches.length === 0) {
    return null;
  }

  const queue: LanxinSendQueueItem[] = [];
  let lastIndex = 0;

  for (const match of matches) {
    const textBefore = text
      .slice(lastIndex, match.index)
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (textBefore) {
      queue.push({ type: "text", content: textBefore });
    }

    if (match.kind === "image") {
      queue.push({ type: "image", path: match.path });
    } else {
      queue.push({ type: "file", path: match.path });
    }

    lastIndex = match.index + match.length;
  }

  const textAfter = text
    .slice(lastIndex)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (textAfter) {
    queue.push({ type: "text", content: textAfter });
  }

  return queue;
}
