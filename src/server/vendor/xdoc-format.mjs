// GENERATED from @xenosystem/blocks@0.20.0/docs (xeno-blocks b04187be4b88) by scripts/build-workspace-docs.mjs — the .xdoc format for the server (no editor, no DOM). Do not edit; rebuild.

// ../../../../.worktrees/xeno-blocks-docs/packages/blocks/src/docs/document/format.ts
var XDOC_FORMAT = "xeno.xdoc";
var XDOC_VERSION = 1;
var XDOC_EXTENSION = ".xdoc";
var DOCUMENT_NODE_TYPES = Object.freeze([
  "doc",
  "paragraph",
  "text",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "image",
  "callout",
  "toggleBlock",
  "pageBreak"
]);
var DOCUMENT_MARK_TYPES = Object.freeze([
  "bold",
  "italic",
  "strike",
  "code",
  "underline",
  "link",
  "subscript",
  "superscript",
  "highlight",
  "wikiLink"
]);
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var SAFE_LINK = /^(https?:\/\/|mailto:)/i;
var SAFE_IMAGE = /^(https:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i;
var CALLOUT_TYPES = /* @__PURE__ */ new Set(["info", "warning", "error", "success", "tip"]);
var ALIGN = /* @__PURE__ */ new Set(["left", "center", "right", "justify"]);
var COLOUR_VALUE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|var\(--[a-zA-Z0-9-]{1,60}\))$/;
var LANGUAGE = /^[a-zA-Z0-9_+#.-]{0,40}$/;
var LIMITS = Object.freeze({ depth: 64, nodes: 5e4, text: 2e6 });
var isNull = (v) => v === null || v === void 0;
var optString = (max) => (v) => isNull(v) || typeof v === "string" && v.length <= max;
var align = (v) => isNull(v) || typeof v === "string" && ALIGN.has(v);
var int = (lo, hi) => (v) => isNull(v) || Number.isInteger(v) && v >= lo && v <= hi;
var bool = (v) => isNull(v) || typeof v === "boolean";
var colwidth = (v) => isNull(v) || Array.isArray(v) && v.length <= 64 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 1e4);
var dims = (v) => isNull(v) || typeof v === "number" && v >= 0 && v <= 1e5 || typeof v === "string" && /^\d{1,6}(px|%)?$/.test(v);
var NODE_ATTRS = {
  paragraph: { textAlign: align },
  heading: { level: int(1, 6), textAlign: align },
  orderedList: { start: int(0, 1e6), type: optString(8) },
  taskItem: { checked: bool },
  codeBlock: { language: (v) => isNull(v) || typeof v === "string" && LANGUAGE.test(v) },
  tableCell: { colspan: int(1, 1e3), rowspan: int(1, 1e3), colwidth },
  tableHeader: { colspan: int(1, 1e3), rowspan: int(1, 1e3), colwidth },
  image: { src: (v) => typeof v === "string" && v.length <= 8e6 && SAFE_IMAGE.test(v), alt: optString(1e3), title: optString(1e3), width: dims, height: dims },
  callout: { type: (v) => isNull(v) || typeof v === "string" && CALLOUT_TYPES.has(v) },
  toggleBlock: { open: bool, summary: optString(500) }
};
var MARK_ATTRS = {
  link: {
    href: (v) => typeof v === "string" && v.length <= 4e3 && SAFE_LINK.test(v.trim()),
    target: (v) => isNull(v) || v === "_blank",
    rel: optString(200),
    class: (v) => isNull(v)
  },
  highlight: { color: (v) => isNull(v) || typeof v === "string" && COLOUR_VALUE.test(v) },
  wikiLink: { pageId: (v) => isNull(v) || typeof v === "string" && (UUID.test(v) || /^[A-Za-z0-9_-]{1,128}$/.test(v)), pageTitle: optString(500) }
};
function validateContent(content, options = {}) {
  const nodes = /* @__PURE__ */ new Set([...DOCUMENT_NODE_TYPES, ...options.extraNodes ?? []]);
  const marks = /* @__PURE__ */ new Set([...DOCUMENT_MARK_TYPES, ...options.extraMarks ?? []]);
  const extraN = new Set(options.extraNodes ?? []);
  const extraM = new Set(options.extraMarks ?? []);
  const problems = [];
  let count = 0;
  let text = 0;
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const attrs = (where, kind, value, rules) => {
    if (isNull(value)) return;
    if (!isObj(value)) {
      problems.push({ path: where, code: "bad_shape", detail: `${kind}.attrs is not an object` });
      return;
    }
    for (const [k, v] of Object.entries(value)) {
      const rule = rules?.[k];
      if (!rule) {
        if (!isNull(v)) problems.push({ path: where, code: "bad_attr", detail: `${kind} does not take "${k}"` });
        continue;
      }
      if (!rule(v)) problems.push({ path: where, code: "bad_attr", detail: `${kind}.${k} is not allowed` });
    }
  };
  const walk = (n, where, depth) => {
    if (problems.length > 50) return;
    if (depth > LIMITS.depth) {
      problems.push({ path: where, code: "too_deep", detail: `deeper than ${LIMITS.depth}` });
      return;
    }
    if (++count > LIMITS.nodes) {
      if (count === LIMITS.nodes + 1) problems.push({ path: where, code: "too_large", detail: `more than ${LIMITS.nodes} nodes` });
      return;
    }
    if (!isObj(n) || typeof n.type !== "string") {
      problems.push({ path: where, code: "bad_shape", detail: "a node needs a string type" });
      return;
    }
    if (!nodes.has(n.type)) {
      problems.push({ path: where, code: "unknown_node", detail: n.type });
      return;
    }
    if (!extraN.has(n.type)) attrs(where, n.type, n.attrs, NODE_ATTRS[n.type]);
    if (n.type === "text") {
      if (typeof n.text !== "string" || !n.text) problems.push({ path: where, code: "bad_shape", detail: "a text node needs text" });
      else if ((text += n.text.length) > LIMITS.text) problems.push({ path: where, code: "too_large", detail: `more than ${LIMITS.text} characters` });
    } else if (n.text !== void 0) problems.push({ path: where, code: "bad_shape", detail: `${n.type} cannot carry text` });
    if (n.marks !== void 0) {
      if (!Array.isArray(n.marks)) problems.push({ path: where, code: "bad_shape", detail: "marks is not a list" });
      else n.marks.forEach((m, i) => {
        if (!isObj(m) || typeof m.type !== "string") problems.push({ path: `${where}.marks[${i}]`, code: "bad_shape", detail: "a mark needs a string type" });
        else if (!marks.has(m.type)) problems.push({ path: `${where}.marks[${i}]`, code: "unknown_mark", detail: m.type });
        else if (!extraM.has(m.type)) attrs(`${where}.marks[${i}]`, m.type, m.attrs, MARK_ATTRS[m.type]);
      });
    }
    if (n.content !== void 0) {
      if (!Array.isArray(n.content)) problems.push({ path: where, code: "bad_shape", detail: "content is not a list" });
      else n.content.forEach((c, i) => walk(c, `${where}.content[${i}]`, depth + 1));
    }
  };
  if (!isObj(content) || content.type !== "doc") return [{ path: "content", code: "bad_shape", detail: "the root must be a doc node" }];
  walk(content, "content", 0);
  return problems;
}
var XdocError = class extends Error {
  problems;
  constructor(message, problems = []) {
    super(message);
    this.name = "XdocError";
    this.problems = problems;
  }
};
var emptyContent = () => ({ type: "doc", content: [{ type: "paragraph" }] });
function parseXdoc(input, options = {}) {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new XdocError("Not a XENO document: the file is not JSON");
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new XdocError("Not a XENO document");
  const r = raw;
  if (r.format !== void 0 && r.format !== XDOC_FORMAT) throw new XdocError(`Not a XENO document (format "${String(r.format)}")`);
  if (r.version !== void 0 && (!Number.isInteger(r.version) || r.version > XDOC_VERSION)) {
    throw new XdocError(`This document was written by a newer XENO Docs (version ${String(r.version)})`);
  }
  const problems = validateContent(r.content, options);
  if (problems.length) throw new XdocError(`The document contains content this editor cannot show (${problems[0].detail})`, problems);
  const now = Date.now();
  const num = (v, d) => typeof v === "number" && Number.isFinite(v) ? v : d;
  const content = r.content;
  return {
    format: XDOC_FORMAT,
    version: XDOC_VERSION,
    ...typeof r.id === "string" ? { id: r.id } : {},
    title: typeof r.title === "string" ? r.title : "",
    content,
    created: num(r.created, now),
    lastModified: num(r.lastModified, now),
    wordCount: num(r.wordCount, wordCount(content)),
    ...r.commentThreads && typeof r.commentThreads === "object" ? { commentThreads: r.commentThreads } : {}
  };
}
function serializeXdoc(doc, options = {}) {
  const problems = validateContent(doc.content, options);
  if (problems.length) throw new XdocError(`The document contains content that cannot be saved (${problems[0].detail})`, problems);
  const file = {
    format: XDOC_FORMAT,
    version: XDOC_VERSION,
    ...doc.id ? { id: doc.id } : {},
    title: doc.title,
    content: doc.content,
    created: doc.created,
    lastModified: doc.lastModified,
    wordCount: doc.wordCount ?? wordCount(doc.content),
    ...doc.commentThreads && typeof doc.commentThreads === "object" ? { commentThreads: doc.commentThreads } : {}
  };
  return JSON.stringify(file, null, options.pretty === false ? void 0 : 2);
}
var BLOCKS = /* @__PURE__ */ new Set(["paragraph", "heading", "blockquote", "listItem", "taskItem", "codeBlock", "tableCell", "tableHeader", "callout", "toggleBlock"]);
function plainText(content) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === "text" && typeof n.text === "string") out.push(n.text);
    else if (n.type === "hardBreak") out.push(" ");
    if (n.type === "toggleBlock" && typeof n.attrs?.summary === "string") out.push(` ${n.attrs.summary} `);
    for (const c of n.content ?? []) walk(c);
    if (BLOCKS.has(n.type)) out.push(" ");
  };
  walk(content);
  return out.join("").replace(/\s+/g, " ").trim();
}
function wordCount(content) {
  const t = plainText(content);
  return t ? t.split(" ").length : 0;
}
function pageLinksIn(content) {
  const seen = /* @__PURE__ */ new Set();
  const walk = (n) => {
    if (!n) return;
    for (const m of n.marks ?? []) {
      const id = m.type === "wikiLink" ? m.attrs?.pageId : null;
      if (typeof id === "string" && id) seen.add(id.toLowerCase());
    }
    for (const c of n.content ?? []) walk(c);
  };
  walk(content);
  return [...seen];
}
function nodeTypesIn(content) {
  const seen = /* @__PURE__ */ new Set();
  const walk = (n) => {
    if (!n) return;
    seen.add(n.type);
    for (const m of n.marks ?? []) seen.add(`mark:${m.type}`);
    for (const c of n.content ?? []) walk(c);
  };
  walk(content);
  return seen;
}

// ../../../../.worktrees/xeno-blocks-docs/packages/blocks/src/docs/document/markdown.ts
var PAGE_LINK = /^xeno-doc:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
function documentToMarkdown(doc) {
  if (!doc.content) return "";
  return doc.content.map((node) => nodeToMarkdown(node, 0)).join("\n\n");
}
function nodeToMarkdown(node, depth) {
  switch (node.type) {
    case "heading":
      return `${"#".repeat(node.attrs?.level || 1)} ${inlineToMarkdown(node.content)}`;
    case "paragraph":
      return inlineToMarkdown(node.content);
    case "bulletList":
      return (node.content || []).map((item) => listItemToMarkdown(item, depth, "-")).join("\n");
    case "orderedList":
      return (node.content || []).map((item, i) => listItemToMarkdown(item, depth, `${i + 1}.`)).join("\n");
    case "taskList":
      return (node.content || []).map((item) => {
        const checked = item.attrs?.checked ? "x" : " ";
        const content = (item.content || []).map((c) => nodeToMarkdown(c, depth + 1)).join("\n");
        return `${"  ".repeat(depth)}- [${checked}] ${content}`;
      }).join("\n");
    case "blockquote":
      return (node.content || []).map((c) => `> ${nodeToMarkdown(c, depth)}`).join("\n");
    case "codeBlock": {
      const lang = node.attrs?.language || "";
      const code = node.content?.map((c) => c.text || "").join("") || "";
      return `\`\`\`${lang}
${code}
\`\`\``;
    }
    case "horizontalRule":
      return "---";
    case "image": {
      const alt = node.attrs?.alt || "";
      const src = node.attrs?.src || "";
      const title = node.attrs?.title ? ` "${node.attrs.title}"` : "";
      return `![${alt}](${src}${title})`;
    }
    case "table":
      return tableToMarkdown(node);
    case "callout": {
      const type = node.attrs?.type || "info";
      const content = (node.content || []).map((c) => nodeToMarkdown(c, depth)).join("\n");
      return `> **${type.charAt(0).toUpperCase() + type.slice(1)}:** ${content}`;
    }
    case "mathBlock":
      return `$$
${node.attrs?.content || ""}
$$`;
    case "toggleBlock": {
      const summary = node.attrs?.summary || "Toggle";
      const content = (node.content || []).map((c) => nodeToMarkdown(c, depth)).join("\n");
      return `<details>
<summary>${summary}</summary>

${content}
</details>`;
    }
    case "multiColumn": {
      return (node.content || []).map((col, i) => {
        const colContent = (col.content || []).map((c) => nodeToMarkdown(c, depth)).join("\n\n");
        return `<!-- Column ${i + 1} -->
${colContent}`;
      }).join("\n\n");
    }
    default:
      return inlineToMarkdown(node.content);
  }
}
function listItemToMarkdown(item, depth, bullet) {
  const content = (item.content || []).map((c, i) => {
    const text = nodeToMarkdown(c, depth + 1);
    if (i === 0) return text;
    return "  ".repeat(depth + 1) + text;
  }).join("\n");
  return `${"  ".repeat(depth)}${bullet} ${content}`;
}
function inlineToMarkdown(content) {
  if (!content) return "";
  return content.map((node) => {
    let text = node.text || "";
    if (node.type === "hardBreak") return "  \n";
    if (node.type === "image") {
      return `![${node.attrs?.alt || ""}](${node.attrs?.src || ""})`;
    }
    if (!node.marks) return text;
    for (const mark of node.marks) {
      switch (mark.type) {
        case "bold":
          text = `**${text}**`;
          break;
        case "italic":
          text = `*${text}*`;
          break;
        case "strike":
          text = `~~${text}~~`;
          break;
        case "code":
          text = `\`${text}\``;
          break;
        case "link":
          text = `[${text}](${mark.attrs?.href || ""})`;
          break;
        case "wikiLink":
          text = `[${text}](xeno-doc:${mark.attrs?.pageId || ""})`;
          break;
        case "underline":
          text = `<u>${text}</u>`;
          break;
        case "subscript":
          text = `<sub>${text}</sub>`;
          break;
        case "superscript":
          text = `<sup>${text}</sup>`;
          break;
      }
    }
    return text;
  }).join("");
}
function tableToMarkdown(node) {
  if (!node.content) return "";
  const rows = node.content.filter((r) => r.type === "tableRow");
  if (rows.length === 0) return "";
  const lines = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].content || [];
    const line = cells.map((cell) => {
      const text = (cell.content || []).map((c) => inlineToMarkdown(c.content)).join(" ");
      return ` ${text} `;
    }).join("|");
    lines.push(`|${line}|`);
    if (i === 0) {
      const sep = cells.map(() => " --- ").join("|");
      lines.push(`|${sep}|`);
    }
  }
  return lines.join("\n");
}
function markdownToDocument(md) {
  let input = md;
  const frontmatterMatch = input.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (frontmatterMatch) {
    input = input.slice(frontmatterMatch[0].length);
  }
  const lines = input.split("\n");
  const content = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      content.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: parseInlineMarkdown(headingMatch[2])
      });
      i++;
      continue;
    }
    if (/^(---|\*\*\*|___)/.test(line.trim())) {
      content.push({ type: "horizontalRule" });
      i++;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      content.push({
        type: "codeBlock",
        attrs: { language: lang || null },
        content: [{ type: "text", text: codeLines.join("\n") }]
      });
      continue;
    }
    if (line.trim() === "$$") {
      const mathLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "$$") {
        mathLines.push(lines[i]);
        i++;
      }
      i++;
      content.push({
        type: "mathBlock",
        attrs: { content: mathLines.join("\n") }
      });
      continue;
    }
    if (line.startsWith(">")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      content.push({
        type: "blockquote",
        content: quoteLines.map((ql) => ({
          type: "paragraph",
          content: parseInlineMarkdown(ql)
        }))
      });
      continue;
    }
    if (/^\s*[-*+]\s/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*+]\s/, "");
        const taskMatch = itemText.match(/^\[([ xX])\]\s*(.*)$/);
        if (taskMatch) {
          listItems.push({
            type: "taskItem",
            attrs: { checked: taskMatch[1] !== " " },
            content: [{ type: "paragraph", content: parseInlineMarkdown(taskMatch[2]) }]
          });
        } else {
          listItems.push({
            type: "listItem",
            content: [{ type: "paragraph", content: parseInlineMarkdown(itemText) }]
          });
        }
        i++;
      }
      if (listItems[0]?.type === "taskItem") {
        content.push({ type: "taskList", content: listItems });
      } else {
        content.push({ type: "bulletList", content: listItems });
      }
      continue;
    }
    if (/^\s*\d+\.\s/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*\d+\.\s/, "");
        listItems.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInlineMarkdown(itemText) }]
        });
        i++;
      }
      content.push({ type: "orderedList", content: listItems });
      continue;
    }
    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableRows = [];
      let isFirst = true;
      while (i < lines.length && lines[i].includes("|")) {
        const trimmed = lines[i].trim();
        if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
          i++;
          continue;
        }
        const cells = trimmed.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map((cell) => cell.trim());
        const cellType = isFirst ? "tableHeader" : "tableCell";
        tableRows.push({
          type: "tableRow",
          content: cells.map((cellText) => ({
            type: cellType,
            content: [{ type: "paragraph", content: parseInlineMarkdown(cellText) }]
          }))
        });
        isFirst = false;
        i++;
      }
      content.push({ type: "table", content: tableRows });
      continue;
    }
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      content.push({
        type: "image",
        attrs: { src: imgMatch[2], alt: imgMatch[1] }
      });
      i++;
      continue;
    }
    const paraLines = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|```|>|\s*[-*+]\s|\s*\d+\.\s|---|\*\*\*|___|!\[|\|)/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    content.push({
      type: "paragraph",
      content: parseInlineMarkdown(paraLines.join(" "))
    });
  }
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}
function parseInlineMarkdown(text) {
  if (!text) return [];
  const result = [];
  const inlineRegex = /(\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|<u>(.+?)<\/u>|<sub>(.+?)<\/sub>|<sup>(.+?)<\/sup>)/g;
  let lastIndex = 0;
  let match;
  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    if (match[2]) {
      result.push({ type: "text", text: match[2], marks: [{ type: "bold" }] });
    } else if (match[3]) {
      result.push({ type: "text", text: match[3], marks: [{ type: "italic" }] });
    } else if (match[4]) {
      result.push({ type: "text", text: match[4], marks: [{ type: "strike" }] });
    } else if (match[5]) {
      result.push({ type: "text", text: match[5], marks: [{ type: "code" }] });
    } else if (match[6] && match[7]) {
      const page = PAGE_LINK.exec(match[7]);
      if (page) result.push({ type: "text", text: match[6], marks: [{ type: "wikiLink", attrs: { pageId: page[1].toLowerCase(), pageTitle: match[6] } }] });
      else if (SAFE_LINK.test(match[7].trim())) result.push({ type: "text", text: match[6], marks: [{ type: "link", attrs: { href: match[7] } }] });
      else result.push({ type: "text", text: match[6] });
    } else if (match[8]) {
      result.push({ type: "text", text: match[8], marks: [{ type: "underline" }] });
    } else if (match[9]) {
      result.push({ type: "text", text: match[9], marks: [{ type: "subscript" }] });
    } else if (match[10]) {
      result.push({ type: "text", text: match[10], marks: [{ type: "superscript" }] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    result.push({ type: "text", text: text.slice(lastIndex) });
  }
  const kept = result.filter((n) => n.type !== "text" || (n.text ?? "") !== "");
  return kept.length > 0 ? kept : text ? [{ type: "text", text }] : [];
}

// ../../../../.worktrees/xeno-blocks-docs/packages/blocks/src/docs/xdoc-format-entry.ts
var BUILT_FROM = "@xenosystem/blocks@0.20.0/docs (xeno-blocks b04187be4b88)";
export {
  BUILT_FROM,
  DOCUMENT_MARK_TYPES,
  DOCUMENT_NODE_TYPES,
  LIMITS,
  SAFE_IMAGE,
  SAFE_LINK,
  XDOC_EXTENSION,
  XDOC_FORMAT,
  XDOC_VERSION,
  XdocError,
  documentToMarkdown,
  emptyContent,
  markdownToDocument,
  nodeTypesIn,
  pageLinksIn,
  parseXdoc,
  plainText,
  serializeXdoc,
  validateContent,
  wordCount
};
