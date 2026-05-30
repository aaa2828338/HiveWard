import type { ReactNode } from "react";

type MarkdownRendererProps = {
  value: string;
  className?: string;
};

type MarkdownListKind = "ul" | "ol";

type MarkdownListLine = {
  kind: MarkdownListKind;
  text: string;
};

type MarkdownTableAlignment = "left" | "center" | "right" | undefined;

type MarkdownTable = {
  headers: string[];
  alignments: MarkdownTableAlignment[];
  rows: string[][];
  endLineIndex: number;
};

const INLINE_TOKEN_PATTERN =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\n]+?\]\([^) \n]+(?:\s+"[^"]*")?\)|\*[^*\n]+\*|_[^_\n]+_)/g;

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

export function MarkdownRenderer({ value, className }: MarkdownRendererProps) {
  const displayValue = shouldRenderAsJsonBlock(value) ? `\`\`\`json\n${value.trim()}\n\`\`\`` : value;
  const classes = ["markdown-body", className].filter(Boolean).join(" ");

  return <div className={classes}>{renderMarkdownBlocks(displayValue)}</div>;
}

function renderMarkdownBlocks(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraphLines: string[] = [];
  let blockIndex = 0;

  const flushParagraph = () => {
    const text = paragraphLines.join("\n").trimEnd();
    paragraphLines = [];
    if (!text.trim()) return;

    blocks.push(<p key={`paragraph-${blockIndex}`}>{renderInlineMarkdown(text, `paragraph-${blockIndex}`)}</p>);
    blockIndex += 1;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const language = sanitizeCodeLanguage(trimmed.slice(3).trim().split(/\s+/)[0] ?? "");
      const codeLines: string[] = [];

      lineIndex += 1;
      while (lineIndex < lines.length && !(lines[lineIndex] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[lineIndex] ?? "");
        lineIndex += 1;
      }

      blocks.push(
        <div className="markdown-code-section" key={`code-${blockIndex}`}>
          {language && <span className="markdown-code-language">{language}</span>}
          <pre className="markdown-code-block">
            <code>{codeLines.join("\n")}</code>
          </pre>
        </div>
      );
      blockIndex += 1;
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push(<hr key={`rule-${blockIndex}`} />);
      blockIndex += 1;
      continue;
    }

    const table = parseMarkdownTable(lines, lineIndex);
    if (table) {
      flushParagraph();
      blocks.push(renderMarkdownTable(table, `table-${blockIndex}`));
      blockIndex += 1;
      lineIndex = table.endLineIndex;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      const HeadingTag: (typeof HEADING_TAGS)[number] = HEADING_TAGS[headingMatch[1]!.length - 1] ?? "h6";
      blocks.push(
        <HeadingTag key={`heading-${blockIndex}`}>
          {renderInlineMarkdown(headingMatch[2] ?? "", `heading-${blockIndex}`)}
        </HeadingTag>
      );
      blockIndex += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const quoteLines = [trimmed.replace(/^>\s?/, "")];

      while (lineIndex + 1 < lines.length && /^>\s?/.test((lines[lineIndex + 1] ?? "").trim())) {
        lineIndex += 1;
        quoteLines.push((lines[lineIndex] ?? "").trim().replace(/^>\s?/, ""));
      }

      blocks.push(<blockquote key={`quote-${blockIndex}`}>{renderMarkdownBlocks(quoteLines.join("\n"))}</blockquote>);
      blockIndex += 1;
      continue;
    }

    const listLine = parseMarkdownListLine(line);
    if (listLine) {
      flushParagraph();
      const items = [listLine.text];
      const ListTag = listLine.kind;

      while (lineIndex + 1 < lines.length) {
        const nextListLine = parseMarkdownListLine(lines[lineIndex + 1] ?? "");
        if (!nextListLine || nextListLine.kind !== listLine.kind) break;
        lineIndex += 1;
        items.push(nextListLine.text);
      }

      blocks.push(
        <ListTag key={`list-${blockIndex}`}>
          {items.map((item, itemIndex) => (
            <li key={`${blockIndex}-${itemIndex}`}>{renderInlineMarkdown(item, `list-${blockIndex}-${itemIndex}`)}</li>
          ))}
        </ListTag>
      );
      blockIndex += 1;
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  return blocks;
}

function renderMarkdownTable(table: MarkdownTable, key: string): ReactNode {
  return (
    <div className="markdown-table-scroll" key={key}>
      <table className="markdown-table">
        <thead>
          <tr>
            {table.headers.map((header, columnIndex) => (
              <th className={alignmentClass(table.alignments[columnIndex])} key={`${key}-head-${columnIndex}`}>
                {renderInlineMarkdown(header, `${key}-head-${columnIndex}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={`${key}-row-${rowIndex}`}>
              {table.headers.map((_, columnIndex) => (
                <td className={alignmentClass(table.alignments[columnIndex])} key={`${key}-cell-${rowIndex}-${columnIndex}`}>
                  {renderInlineMarkdown(row[columnIndex] ?? "", `${key}-cell-${rowIndex}-${columnIndex}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(INLINE_TOKEN_PATTERN)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      tokenIndex = pushPlainText(nodes, text.slice(lastIndex, matchIndex), keyPrefix, tokenIndex);
    }

    const token = match[0];
    const tokenKey = `${keyPrefix}-token-${tokenIndex}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={tokenKey}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={tokenKey}>{renderInlineMarkdown(token.slice(2, -2), `${tokenKey}-strong`)}</strong>
      );
    } else if (token.startsWith("[") && token.includes("](")) {
      const linkNode = renderMarkdownLink(token, tokenKey);
      if (linkNode) {
        nodes.push(linkNode);
      } else {
        tokenIndex = pushPlainText(nodes, token, keyPrefix, tokenIndex);
      }
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(<em key={tokenKey}>{renderInlineMarkdown(token.slice(1, -1), `${tokenKey}-em`)}</em>);
    } else {
      tokenIndex = pushPlainText(nodes, token, keyPrefix, tokenIndex);
    }

    tokenIndex += 1;
    lastIndex = matchIndex + token.length;
  }

  if (lastIndex < text.length) {
    pushPlainText(nodes, text.slice(lastIndex), keyPrefix, tokenIndex);
  }

  return nodes;
}

function renderMarkdownLink(token: string, key: string): ReactNode | null {
  const match = /^\[([^\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(token);
  if (!match) return null;

  const label = match[1] ?? "";
  const href = match[2] ?? "";
  if (!isSafeMarkdownUrl(href)) return null;

  const external = /^https?:/i.test(href);
  const opensInNewTab = external || href.startsWith("/artifacts/");
  return (
    <a href={href} key={key} rel={opensInNewTab ? "noreferrer" : undefined} target={opensInNewTab ? "_blank" : undefined}>
      {renderInlineMarkdown(label, `${key}-link`)}
    </a>
  );
}

function pushPlainText(nodes: ReactNode[], text: string, keyPrefix: string, startIndex: number): number {
  let nextIndex = startIndex;
  const parts = text.split("\n");

  parts.forEach((part, partIndex) => {
    if (part) {
      nodes.push(<span key={`${keyPrefix}-text-${nextIndex}`}>{part}</span>);
      nextIndex += 1;
    }
    if (partIndex < parts.length - 1) {
      nodes.push(<br key={`${keyPrefix}-break-${nextIndex}`} />);
      nextIndex += 1;
    }
  });

  return nextIndex;
}

function parseMarkdownListLine(line: string): MarkdownListLine | null {
  const unordered = /^\s{0,3}[-*+]\s+(.+)$/.exec(line);
  if (unordered) return { kind: "ul", text: unordered[1] ?? "" };

  const ordered = /^\s{0,3}\d+[.)]\s+(.+)$/.exec(line);
  if (ordered) return { kind: "ol", text: ordered[1] ?? "" };

  return null;
}

function parseMarkdownTable(lines: string[], startLineIndex: number): MarkdownTable | null {
  const header = parseMarkdownTableRow(lines[startLineIndex] ?? "");
  const separator = parseMarkdownTableRow(lines[startLineIndex + 1] ?? "");
  if (!header || !separator || !isMarkdownTableSeparator(separator)) return null;

  const columnCount = Math.max(header.length, separator.length);
  if (columnCount < 2) return null;

  const rows: string[][] = [];
  let endLineIndex = startLineIndex + 1;

  for (let lineIndex = startLineIndex + 2; lineIndex < lines.length; lineIndex += 1) {
    const row = parseMarkdownTableRow(lines[lineIndex] ?? "");
    if (!row) break;

    rows.push(normalizeMarkdownTableRow(row, columnCount));
    endLineIndex = lineIndex;
  }

  return {
    headers: normalizeMarkdownTableRow(header, columnCount),
    alignments: normalizeMarkdownTableRow(separator, columnCount).map(parseMarkdownTableAlignment),
    rows,
    endLineIndex
  };
}

function parseMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;

  const cells = splitMarkdownTableCells(trimmed);
  return cells.length >= 2 ? cells : null;
}

function splitMarkdownTableCells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);

  const cells: string[] = [];
  let cell = "";

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === "\\" && row[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }

  cells.push(cell.trim());
  return cells;
}

function isMarkdownTableSeparator(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function normalizeMarkdownTableRow(row: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
}

function parseMarkdownTableAlignment(cell: string): MarkdownTableAlignment {
  const trimmed = cell.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.endsWith(":")) return "right";
  if (trimmed.startsWith(":")) return "left";
  return undefined;
}

function alignmentClass(alignment: MarkdownTableAlignment): string | undefined {
  return alignment ? `markdown-table-align-${alignment}` : undefined;
}

function sanitizeCodeLanguage(language: string): string {
  return language.replace(/[^a-zA-Z0-9_+.-]/g, "").slice(0, 32);
}

function shouldRenderAsJsonBlock(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return false;

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function isSafeMarkdownUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return true;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}
