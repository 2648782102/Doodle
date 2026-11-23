/**
 * Filtering, ordering, and time labels for the board library.
 *
 * Pure, so Node can test the parts a person would otherwise discover by
 * squinting at a list: which boards a search keeps, and whether "just now"
 * means what it says.
 */

export interface LibraryEntry {
  id: string;
  name: string;
  revision: number;
  itemCount: number;
  updatedAt?: string;
  active?: boolean;
}

export type LibraryOrder = "recent" | "name";

/**
 * Whether an element can actually take focus right now.
 *
 * The control that opened a modal can be hidden by the time it closes — opening
 * the library shuts the shortcut panel, and that panel is a plausible opener.
 * Focusing a hidden node silently leaves focus on `<body>`, which is the exact
 * outcome a "return focus to the opener" rule exists to prevent.
 */
export function canFocus(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element
    && document.contains(element)
    && !element.hidden
    && element.getClientRects().length > 0,
  );
}

/**
 * Narrow the library to a query, then order it.
 *
 * Filtering is a case-insensitive substring match on the name, because that is
 * what a person types into a box labelled 搜索画板. Ordering by name uses
 * `localeCompare` with the interface language rather than code-unit order: a
 * Chinese library sorted by raw codepoints is not alphabetical to anyone
 * reading it.
 *
 * The active board is always first. It is the one a person is looking at, and
 * hunting for it in a sorted list is busywork.
 */
export function orderLibrary(entries: LibraryEntry[], query: string, order: LibraryOrder): LibraryEntry[] {
  const needle = query.trim().toLowerCase();
  const matched = needle
    ? entries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : [...entries];
  return matched.sort((left, right) => {
    if (Boolean(left.active) !== Boolean(right.active)) return left.active ? -1 : 1;
    /*
     * Name order falls back to id when two boards share a name — which is the
     * common case here, since every generated board used to be called the same
     * thing. Without a tiebreak the list reshuffles between renders for no
     * visible reason.
     */
    if (order === "name") {
      return left.name.localeCompare(right.name, "zh-Hans-CN") || left.id.localeCompare(right.id);
    }
    const leftTime = Date.parse(left.updatedAt ?? "") || 0;
    const rightTime = Date.parse(right.updatedAt ?? "") || 0;
    // Same timestamp is common in imports; keep that tie stable too.
    return rightTime - leftTime || left.id.localeCompare(right.id);
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A time a person can read at a glance.
 *
 * Anything under a minute is "刚刚": a board saved two seconds ago is not more
 * usefully described as "0 分钟前". Days stop at a week, where the calendar date
 * becomes the more useful label. An unparseable timestamp returns an empty
 * string rather than "Invalid Date" leaking into the panel.
 */
export function relativeTime(iso: string | undefined, now: number = Date.now()): string {
  const time = Date.parse(iso ?? "");
  if (!Number.isFinite(time)) return "";
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE) return "刚刚";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} 分钟前`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} 小时前`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} 天前`;
  const date = new Date(time);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/** What a row says under its name: when it changed, and how full it is. */
export function describeEntry(entry: LibraryEntry, now: number = Date.now()): string {
  const when = relativeTime(entry.updatedAt, now);
  const count = `${entry.itemCount} 个对象`;
  return when ? `${count} · ${when}` : count;
}

export interface EntryHandlers {
  switchTo: (entry: LibraryEntry) => void;
  rename: (entry: LibraryEntry, name: string) => Promise<void>;
  exportJson: (entry: LibraryEntry) => void;
  delete: (entry: LibraryEntry) => void;
  /** Re-render, so a cancelled edit or an empty rename restores the row. */
  refresh: () => void;
  /**
   * The picture for a board, or `undefined` to keep the row text-only.
   *
   * Standalone serves it from `/api/board/library/:id.svg`; the embedded host
   * has no such route, and a broken `<img>` in every row would be worse than a
   * row with no picture.
   */
  thumbnailUrl?: (entry: LibraryEntry) => string | undefined;
}

/**
 * Render the visible boards into `list`.
 *
 * One row per board: its name and when it changed, then the three things a
 * person does to a board they are not looking at. Rename edits in place, and a
 * delete asks inline — both replaced controls that made the panel feel like a
 * settings dialog: a rename that required loading the board first, and a
 * `window.confirm` system alert.
 */
export function renderBoardRows(
  list: HTMLElement,
  entries: LibraryEntry[],
  handlers: EntryHandlers,
): void {
  list.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "doodle-library-entry";
    row.classList.toggle("active", Boolean(entry.active));

    const button = document.createElement("button");
    button.className = "doodle-library-entry-main";
    button.textContent = entry.name;
    // The row truncates long names, so the full one must still be reachable.
    button.title = entry.name;
    const meta = document.createElement("small");
    meta.textContent = describeEntry(entry);
    button.append(meta);
    button.addEventListener("click", () => handlers.switchTo(entry));

    const actions = document.createElement("div");
    actions.className = "doodle-library-entry-actions";

    /*
     * The picture replaces the row's left padding, not its text.
     *
     * A thumbnail beside the name would steal width from the one thing that has
     * to stay readable — the board's name — so it sits in its own column at a
     * fixed size. `loading="lazy"` keeps a twenty-board library from firing
     * twenty requests the moment the drawer opens; the ones below the fold are
     * only fetched when they are scrolled to. `alt=""` because the name beside
     * it already says what the board is; a screen reader reading the picture too
     * would repeat it.
     */
    const thumbnailSrc = handlers.thumbnailUrl?.(entry);
    if (thumbnailSrc) {
      const thumb = document.createElement("img");
      thumb.className = "doodle-library-thumb";
      thumb.src = thumbnailSrc;
      thumb.alt = "";
      thumb.loading = "lazy";
      thumb.decoding = "async";
      // A missing or failed render leaves an empty box; hide it so the row falls
      // back to the text-only layout it had before.
      thumb.addEventListener("error", () => { thumb.hidden = true; });
      row.append(thumb);
      row.classList.add("has-thumb");
    }

    const renameButton = document.createElement("button");
    renameButton.textContent = "改名";
    renameButton.title = "重命名这个画板";
    renameButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const field = document.createElement("input");
      field.className = "doodle-library-name";
      field.value = entry.name;
      field.maxLength = 80;
      field.setAttribute("aria-label", `重命名「${entry.name}」`);
      let done = false;
      const commit = async () => {
        if (done) return;
        done = true;
        const next = field.value.trim();
        if (!next || next === entry.name) {
          handlers.refresh();
          return;
        }
        await handlers.rename(entry, next);
      };
      field.addEventListener("keydown", (keyEvent) => {
        if (keyEvent.key === "Enter") {
          keyEvent.preventDefault();
          void commit();
        } else if (keyEvent.key === "Escape") {
          /*
           * Cancel this edit, not the drawer.
           *
           * The panel closes on Escape, so without stopping the event a person
           * trying to abandon a typo would close the library as well.
           */
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          done = true;
          handlers.refresh();
        }
      });
      field.addEventListener("blur", () => { void commit(); });
      button.replaceWith(field);
      field.focus();
      field.select();
    });

    const exportButton = document.createElement("button");
    exportButton.textContent = "导出";
    exportButton.title = "导出这个画板的 JSON";
    exportButton.addEventListener("click", (event) => {
      event.stopPropagation();
      handlers.exportJson(entry);
    });

    const deleteButton = document.createElement("button");
    deleteButton.textContent = "删除";
    deleteButton.className = "doodle-library-entry-delete";
    deleteButton.title = "删除这个画板";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const confirmBar = document.createElement("div");
      confirmBar.className = "doodle-library-entry-confirm";
      /*
       * The row is a two-column grid, so the bar spans both cells and sits below
       * them. The inline actions stay where they are and are hidden by
       * `.is-confirming`; only the new row is added, so nothing reflows.
       */
      confirmBar.style.gridColumn = "1 / -1";
      const question = document.createElement("p");
      question.textContent = `删除「${entry.name}」？此操作不可撤销。`;
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "取消";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "删除";
      remove.dataset.tone = "danger";
      cancel.addEventListener("click", (cancelEvent) => {
        cancelEvent.stopPropagation();
        row.classList.remove("is-confirming");
        confirmBar.remove();
        button.focus();
      });
      remove.addEventListener("click", (removeEvent) => {
        removeEvent.stopPropagation();
        remove.disabled = true;
        handlers.delete(entry);
      });
      confirmBar.append(question, cancel, remove);
      row.classList.add("is-confirming");
      row.append(confirmBar);
      // The safe answer gets focus, so Enter on autopilot cannot delete.
      cancel.focus();
    });

    actions.append(renameButton, exportButton, deleteButton);
    row.append(button, actions);
    list.append(row);
  }
}
