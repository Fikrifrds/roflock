import type { ReactNode } from 'react';
import { formatValue } from '../lib/format.js';
import { Empty } from './primitives.js';

const TECHNICAL_FIELDS = new Set(['id', 'task_id', 'node_run_id']);

function formatTimestamp(value: unknown): string {
  if (typeof value !== 'string') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function inlineMarkup(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/**
 * Provider findings are Markdown-like, but evidence must remain inert. This
 * small renderer handles the structures agents commonly return without using
 * raw HTML or turning the evidence view into a Markdown execution surface.
 */
function EvidenceNarrative({ children }: { children: string }) {
  const lines = children
    .replaceAll('\r\n', '\n')
    // Streaming CLIs occasionally omit the newline between a completed
    // sentence and the next Markdown heading.
    .replace(/([.!?])(?=#{1,3}\s)/g, '$1\n\n')
    .split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith('```')) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre className="evidence-code" key={`code-${index}`}>
          {language ? <span className="evidence-code-language">{language}</span> : null}
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      const Heading = heading[1]?.length === 1 ? 'h4' : 'h5';
      blocks.push(<Heading key={`heading-${index}`}>{inlineMarkup(heading[2] ?? '')}</Heading>);
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ul key={`list-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inlineMarkup(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const orderedMatch = /^\s*(\d+)[.)]\s+/.exec(line);
    if (orderedMatch) {
      const items: string[] = [];
      const start = Number(orderedMatch[1]) || 1;
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+[.)]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ol start={start} key={`steps-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inlineMarkup(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !/^(#{1,3})\s+/.test((lines[index] ?? '').trim()) &&
      !/^\s*[-*]\s+/.test(lines[index] ?? '') &&
      !/^\s*\d+[.)]\s+/.test(lines[index] ?? '') &&
      !(lines[index] ?? '').trimStart().startsWith('```')
    ) {
      paragraph.push((lines[index] ?? '').trim());
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkup(paragraph.join(' '))}</p>);
  }

  return <div className="evidence-narrative">{blocks}</div>;
}

function FindingCard({ item, index }: { item: Record<string, unknown>; index: number }) {
  const summary = String(item.summary ?? 'Untitled finding');
  const severity = String(item.severity ?? 'info').toLowerCase();
  const details = typeof item.details === 'string' ? item.details.trim() : '';
  const createdAt = formatTimestamp(item.created_at);
  const technical = Object.entries(item).filter(
    ([key, value]) => TECHNICAL_FIELDS.has(key) && value !== null && value !== undefined,
  );

  return (
    <article
      className={`evidence-record evidence-record-${severity}`}
      key={String(item.id ?? index)}
    >
      <header className="evidence-record-header">
        <span className={`evidence-severity evidence-severity-${severity}`}>{severity}</span>
        <div>
          <h4>{summary}</h4>
          {createdAt ? <time dateTime={String(item.created_at)}>{createdAt}</time> : null}
        </div>
      </header>

      {details ? (
        <div className="evidence-record-content">
          <span className="evidence-record-label">Details</span>
          <EvidenceNarrative>{details}</EvidenceNarrative>
        </div>
      ) : null}

      {technical.length ? (
        <details className="evidence-technical">
          <summary>Technical details</summary>
          <dl>
            {technical.map(([key, value]) => (
              <div key={key}>
                <dt>{key.replaceAll('_', ' ')}</dt>
                <dd>{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </article>
  );
}

export function EvidenceSection({
  title,
  items,
}: {
  title: string;
  items: Array<Record<string, unknown>>;
}) {
  const findings = title === 'Findings';

  return (
    <section className="evidence-section">
      <h3>{title}</h3>
      {items.length ? (
        findings ? (
          <div className="evidence-record-list">
            {items.map((item, index) => (
              <FindingCard item={item} index={index} key={String(item.id ?? index)} />
            ))}
          </div>
        ) : (
          items.map((item, index) => (
            <article className="evidence-item" key={String(item.id ?? index)}>
              {Object.entries(item).map(([key, value]) => (
                <p key={key}>
                  <span>{key.replace(/_/g, ' ')}</span> {formatValue(value)}
                </p>
              ))}
            </article>
          ))
        )
      ) : (
        <Empty message={`No ${title.toLowerCase()} recorded yet.`} />
      )}
    </section>
  );
}
