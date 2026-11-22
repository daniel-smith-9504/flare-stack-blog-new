// The values of the database's enum columns. They live apart from the table
// definitions (src/lib/db/schema), which import them, so that code running in
// the browser can take them without pulling in the tables and drizzle-orm.

export const POST_STATUSES = ["draft", "published"] as const;

export const POST_REVISION_REASONS = [
  "auto",
  "publish",
  "restore_backup",
] as const;

export const COMMENT_STATUSES = ["published", "deleted"] as const;

export const EMAIL_UNSUBSCRIBE_TYPES = ["reply_notification"] as const;

export const FRIEND_LINK_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;

export const NOVEL_STATUSES = [
  "pending",
  "parsing",
  "ready",
  "failed",
] as const;

export const NOVEL_SOURCES = ["upload", "gutenberg"] as const;

export const NOVEL_FILE_FORMATS = ["epub", "txt"] as const;

export const NOVEL_READER_THEMES = [
  "light",
  "sepia",
  "dark",
  "green",
  "blue",
] as const;

export const NOVEL_FONT_FAMILIES = ["serif", "sans"] as const;

export const NOVEL_READING_MODES = ["scroll", "paged"] as const;

export const NOVEL_NOTE_STATUSES = ["visible", "removed"] as const;

export const NOVEL_VOTE_CHOICES = ["remove", "keep"] as const;

export const NOVEL_REPORT_STATUSES = ["pending", "resolved"] as const;
