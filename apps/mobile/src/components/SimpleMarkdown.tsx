import { View, Text, Linking, type TextStyle } from 'react-native';
import { colors } from '../constants/colors';

/**
 * A deliberately small Markdown renderer for help-centre article bodies.
 *
 * Web renders the same bodies with `react-markdown`, which is DOM-only and
 * cannot run here. Rather than pull a React Native markdown package in right
 * before the SDK 54 upgrade — one more dependency to reconcile — this covers
 * the subset help articles actually use: headings, paragraphs, bullet and
 * numbered lists, bold, inline code, links and simple tables.
 *
 * Anything outside that subset degrades to plain text, which is the right
 * failure mode for support content: the reader still gets the words.
 */

type Inline = { text: string; bold?: boolean; code?: boolean; href?: string };

// Splits a line into styled runs. One pass, alternating between the plain text
// and whichever marker matched first, so nested markers resolve outside-in.
function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /(\*\*(.+?)\*\*)|(`([^`]+?)`)|(\[([^\]]+)\]\(([^)\s]+)\))/;
  let rest = line;

  while (rest.length > 0) {
    const m = pattern.exec(rest);
    if (!m || m.index === undefined) {
      out.push({ text: rest });
      break;
    }
    if (m.index > 0) out.push({ text: rest.slice(0, m.index) });

    if (m[2] !== undefined) out.push({ text: m[2], bold: true });
    else if (m[4] !== undefined) out.push({ text: m[4], code: true });
    else if (m[6] !== undefined) out.push({ text: m[6], href: m[7] });

    rest = rest.slice(m.index + m[0].length);
  }
  return out.length > 0 ? out : [{ text: line }];
}

function InlineRuns({ runs, style }: { runs: Inline[]; style?: TextStyle }) {
  return (
    <Text style={[{ fontSize: 15, lineHeight: 23, color: colors.charcoal }, style]}>
      {runs.map((run, i) => {
        if (run.href) {
          return (
            <Text
              key={i}
              style={{ color: colors.brand.DEFAULT, fontWeight: '600' }}
              onPress={() => Linking.openURL(run.href!).catch(() => { /* dead link — leave the text visible */ })}
            >
              {run.text}
            </Text>
          );
        }
        return (
          <Text
            key={i}
            style={{
              fontWeight: run.bold ? '700' : undefined,
              fontFamily: run.code ? 'JetBrainsMono' : undefined,
              color: run.code ? colors.ink : undefined,
            }}
          >
            {run.text}
          </Text>
        );
      })}
    </Text>
  );
}

export default function SimpleMarkdown({ body }: { body: string }) {
  // Normalise Windows line endings so the block splitter behaves the same
  // whichever editor the article was written in.
  const lines = (body ?? '').replace(/\r\n/g, '\n').split('\n');

  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let sawTableHeader = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (!text) return;
    blocks.push(
      <View key={`p-${blocks.length}`} style={{ marginBottom: 14 }}>
        <InlineRuns runs={parseInline(text)} />
      </View>,
    );
  };

  lines.forEach((raw) => {
    const line = raw.trimEnd();

    if (!line.trim()) { flushParagraph(); return; }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const size = level === 1 ? 21 : level === 2 ? 18 : 16;
      blocks.push(
        <View key={`h-${blocks.length}`} style={{ marginTop: blocks.length === 0 ? 0 : 10, marginBottom: 8 }}>
          <InlineRuns
            runs={parseInline(heading[2])}
            style={{ fontSize: size, lineHeight: size + 6, fontWeight: '700', color: colors.ink }}
          />
        </View>,
      );
      return;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const marker = bullet ? '•' : `${numbered![1]}.`;
      const content = bullet ? bullet[1] : numbered![2];
      blocks.push(
        <View key={`li-${blocks.length}`} style={{ flexDirection: 'row', gap: 8, marginBottom: 8, paddingLeft: 4 }}>
          <Text style={{ fontSize: 15, lineHeight: 23, color: colors.muted, minWidth: 16 }}>{marker}</Text>
          <View style={{ flex: 1 }}>
            <InlineRuns runs={parseInline(content)} />
          </View>
        </View>,
      );
      return;
    }

    // ── Tables ────────────────────────────────────────────────────────
    // Added for the privacy policy and terms, which use tables for the
    // data / retention / recipient breakdowns. Rendered as stacked
    // label-value rows rather than real columns: three columns of legal
    // text at phone width is unreadable, and the separator row would
    // otherwise fall through to a paragraph of pipes and dashes.
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      flushParagraph();

      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());

      // The |---|---| separator carries no content; drop it.
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return;

      const isHeader = !sawTableHeader;
      sawTableHeader = true;

      blocks.push(
        <View
          key={`tr-${blocks.length}`}
          style={{
            flexDirection: 'row', gap: 10, paddingVertical: 7,
            borderBottomWidth: 1, borderBottomColor: colors.border,
          }}
        >
          {cells.map((cell, ci) => (
            <View key={ci} style={{ flex: ci === 0 ? 4 : 6 }}>
              <InlineRuns
                runs={parseInline(cell)}
                style={isHeader
                  ? { fontSize: 12, fontWeight: '700', color: colors.muted }
                  : { fontSize: 13.5, lineHeight: 20, color: colors.ink }}
              />
            </View>
          ))}
        </View>,
      );
      return;
    }
    // Any non-table line ends the current table, so a later one gets its
    // own header row rather than inheriting this one's.
    sawTableHeader = false;

    // A horizontal rule is common in longer articles and cheap to honour.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph();
      blocks.push(
        <View key={`hr-${blocks.length}`} style={{ height: 1, backgroundColor: colors.border, marginVertical: 14 }} />,
      );
      return;
    }

    paragraph.push(line.trim());
  });

  flushParagraph();

  return <View>{blocks}</View>;
}
