/**
 * Outbound link restriction and upstream Excalidraw chrome suppression.
 *
 * The canvas is a closed local surface: only the Doodle project repository may
 * open externally; upstream socials, web embeds, materials-library browse, and
 * AI/Mermaid generation entries are hidden.
 */

export const DOODLE_PROJECT_URL = "https://github.com/2648782102/Doodle";

export function isDoodleProjectLink(link: unknown): boolean {
  if (typeof link !== "string") return false;
  try {
    const url = new URL(link);
    const project = new URL(DOODLE_PROJECT_URL);
    return url.protocol === project.protocol &&
      url.hostname === project.hostname &&
      (url.pathname === project.pathname || url.pathname.startsWith(`${project.pathname}/`));
  } catch {
    return false;
  }
}

export function blockExternalCanvasLinks(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!target || !target.closest(".excalidraw")) return;
  const href = target.getAttribute("href");
  if (!href || href.startsWith("#") || isDoodleProjectLink(href)) return;
  event.preventDefault();
  event.stopPropagation();
}

export function hideExternalEmbedTool(): void {
  const selector = '.dropdown-menu.App-toolbar__extra-tools-dropdown button[data-testid="toolbar-embeddable"]';
  for (const button of document.querySelectorAll<HTMLElement>(selector)) {
    const external = !button.textContent?.includes("Mermaid");
    if (external) {
      button.dataset.doodleHidden = "true";
      button.setAttribute("aria-hidden", "true");
    }
  }
  for (const node of document.querySelectorAll<HTMLElement>(
    ".dropdown-menu.App-toolbar__extra-tools-dropdown .dropdown-menu-container > *",
  )) {
    const text = node.textContent?.trim() ?? "";
    if (text === "Generate" || text.startsWith("Mermaid") || text.startsWith("生成")) {
      node.dataset.doodleHidden = "true";
      node.setAttribute("aria-hidden", "true");
    }
  }
  for (const link of document.querySelectorAll<HTMLElement>(".excalidraw .library-menu-browse-button")) {
    link.dataset.doodleHidden = "true";
    link.setAttribute("aria-hidden", "true");
  }
}

export function initExternalLinkPolicy(): void {
  document.addEventListener("click", blockExternalCanvasLinks, true);
  const apply = () => {
    hideExternalEmbedTool();
    for (const group of document.querySelectorAll<HTMLElement>(".excalidraw .dropdown-menu-group")) {
      if (group.querySelector("a[href]")) {
        group.dataset.doodleHidden = "true";
      }
    }
  };
  const observer = new MutationObserver(apply);
  observer.observe(document.body, { childList: true, subtree: true });
  apply();
}
