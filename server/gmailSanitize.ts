import sanitizeHtml from "sanitize-html";

/**
 * Turns a raw HTML email body into something safe to render inside the CRM.
 * Three concerns, all handled here rather than at render time, so every
 * caller (thread view, search snippet, future export) gets the same safety
 * guarantee automatically:
 *   - No scripts, iframes, forms, or event handlers — this is someone else's
 *     HTML landing straight in our app shell.
 *   - No remote images or stylesheets — blocks tracking pixels and read
 *     receipts without needing a per-message "load images" click.
 *   - Inline (data:) images are kept, since those are genuinely part of the
 *     message content (e.g. a small inline chart) rather than a remote call.
 */
export function sanitizeEmailHtml(rawHtml: string): string {
  return sanitizeHtml(rawHtml, {
    allowedTags: [
      "a", "b", "strong", "i", "em", "u", "s", "strike", "br", "p", "div", "span",
      "ul", "ol", "li", "blockquote", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6",
      "table", "thead", "tbody", "tr", "td", "th", "hr", "img", "font", "sub", "sup",
    ],
    allowedAttributes: {
      a: ["href", "title", "target"],
      img: ["src", "alt", "width", "height"],
      table: ["border", "cellpadding", "cellspacing", "width"],
      td: ["colspan", "rowspan", "align", "valign", "width"],
      th: ["colspan", "rowspan", "align", "valign", "width"],
      font: ["color", "size", "face"],
      "*": ["style"],
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    allowedStyles: {
      "*": {
        color: [/.*/],
        "background-color": [/.*/],
        "font-weight": [/.*/],
        "font-style": [/.*/],
        "text-decoration": [/.*/],
        "text-align": [/.*/],
      },
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
    exclusiveFilter: (frame) => {
      // Drop remote images outright (tracking pixels and any other externally
      // hosted image) — only inline data: images survive.
      if (frame.tag === "img") {
        const src = frame.attribs.src || "";
        if (!src.startsWith("data:")) return true;
      }
      return false;
    },
    // Belt-and-braces: sanitize-html already strips <script>/<style>/<iframe>/
    // <object>/<embed>/<form>/<link>/<meta> by not allow-listing them above.
  });
}

/** Plain-text fallback when a message has no HTML part at all. */
export function textToSafeHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre style="white-space:pre-wrap;font-family:inherit;">${escaped}</pre>`;
}
