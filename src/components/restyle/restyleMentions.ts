// ====================================================================
//  转绘输入框 @ 引用素材：项目内已上传的图片与视频分别按上传顺序编号为
//  @image1…/@video1…，发送时把文本中的别名解析回附件 id 随消息传递。
//  全部为纯函数，便于单测。
// ====================================================================

import type { RestyleAttachment } from "./restyleStorage";

export type MentionableAttachment = {
  attachment: RestyleAttachment;
  /** 草稿文本中插入的别名，如 @image1 / @video2。 */
  alias: string;
  kind: "image" | "video";
};

/** 可被 @ 的素材：项目内非文件夹的图片与视频。 */
export function isMentionableAttachment(file: RestyleAttachment): boolean {
  return (
    !file.isFolder && (file.type.startsWith("image/") || file.type.startsWith("video/"))
  );
}

/** 按项目文件顺序为图片/视频分别编号，生成 @ 别名列表。 */
export function buildMentionables(files: RestyleAttachment[]): MentionableAttachment[] {
  let imageIndex = 0;
  let videoIndex = 0;
  const mentionables: MentionableAttachment[] = [];
  for (const attachment of files) {
    if (attachment.isFolder) continue;
    if (attachment.type.startsWith("image/")) {
      imageIndex += 1;
      mentionables.push({ attachment, alias: `@image${imageIndex}`, kind: "image" });
    } else if (attachment.type.startsWith("video/")) {
      videoIndex += 1;
      mentionables.push({ attachment, alias: `@video${videoIndex}`, kind: "video" });
    }
  }
  return mentionables;
}

/** 解析文本中的 @imageN / @videoN，映射为对应附件 id（去重，忽略未知名别名）。 */
export function resolveMentionedAttachmentIds(
  text: string,
  mentionables: MentionableAttachment[],
): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(/@(image|video)(\d+)/gi)) {
    const alias = `@${match[1]!.toLowerCase()}${match[2]}`;
    const target = mentionables.find((item) => item.alias === alias);
    if (target) ids.add(target.attachment.id);
  }
  return [...ids];
}
