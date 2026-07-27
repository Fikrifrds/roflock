import type { ReactNode } from 'react';
import { formatTimestamp, formatTokenCount, formatValue, parseJsonField } from '../lib/format.js';
import { Empty } from './primitives.js';

const TECHNICAL_FIELDS = new Set(['id', 'task_id', 'node_run_id', 'invocation_id']);

function isTimestampField(key: string): boolean {
  return /(?:created|updated)_?at$/i.test(key);
}

function displayFieldValue(key: string, value: unknown): string {
  return isTimestampField(key) ? formatTimestamp(value) : formatValue(value);
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

function DisclosureCard({ item, index }: { item: Record<string, unknown>; index: number }) {
  const selectedRaw = parseJsonField(item.selected_context_json);
  const selected =
    selectedRaw && !Array.isArray(selectedRaw) ? (selectedRaw as Record<string, unknown>) : {};
  const contract =
    selected.contract && typeof selected.contract === 'object' && !Array.isArray(selected.contract)
      ? (selected.contract as Record<string, unknown>)
      : {};
  const exclusionsRaw = parseJsonField(item.exclusions_json);
  const exclusions = Array.isArray(exclusionsRaw)
    ? exclusionsRaw.map(String)
    : Object.keys(exclusionsRaw);
  const entries = Array.isArray(selected.entries)
    ? (selected.entries as Array<{ source?: string; tokens?: number }>)
    : [];
  const omitted = Array.isArray(selected.omitted)
    ? (selected.omitted as Array<{ id?: string; reason?: string }>)
    : [];
  const role = String(selected.role ?? 'Unknown role');
  const provider = String(item.provider_connection_id ?? 'Unknown provider');
  const createdAt = formatTimestamp(item.created_at);
  const technical = Object.entries(item).filter(
    ([key, value]) => TECHNICAL_FIELDS.has(key) && value !== null && value !== undefined,
  );

  return (
    <article className="evidence-record disclosure-record" key={String(item.id ?? index)}>
      <header className="evidence-record-header">
        <span className="evidence-severity">{provider}</span>
        <div>
          <h4>{role.replaceAll('_', ' ')} context disclosure</h4>
          {createdAt ? <time dateTime={String(item.created_at)}>{createdAt}</time> : null}
        </div>
      </header>

      <div className="disclosure-summary">
        <div>
          <span>Selected context</span>
          <strong>{formatTokenCount(selected.totalTokens)} tokens</strong>
        </div>
        <div>
          <span>Payload</span>
          <strong>{formatTokenCount(selected.totalBytes)} bytes</strong>
        </div>
        <div>
          <span>Sources</span>
          <strong>{entries.length}</strong>
        </div>
        <div>
          <span>Omitted</span>
          <strong>{omitted.length}</strong>
        </div>
      </div>

      <div className="disclosure-groups">
        {contract.purpose ? (
          <div>
            <span className="evidence-record-label">Context policy</span>
            <p className="disclosure-purpose">{String(contract.purpose)}</p>
            <div className="evidence-chip-list">
              <span className="evidence-chip">
                Limit · {formatTokenCount(contract.maxTokens)} tokens
              </span>
              <span className="evidence-chip evidence-chip-muted">
                {contract.allowWrites ? 'Writes allowed' : 'Read only'}
              </span>
              <span className="evidence-chip evidence-chip-muted">
                {contract.allowCommands ? 'Commands allowed' : 'No commands'}
              </span>
              {Array.isArray(contract.allowedSensitivity)
                ? contract.allowedSensitivity.map((sensitivity) => (
                    <span className="evidence-chip evidence-chip-muted" key={String(sensitivity)}>
                      {String(sensitivity)}
                    </span>
                  ))
                : null}
            </div>
          </div>
        ) : null}

        <div>
          <span className="evidence-record-label">Selected sources</span>
          <div className="evidence-chip-list">
            {entries.length ? (
              entries.map((entry, entryIndex) => (
                <span className="evidence-chip" key={`${entry.source ?? 'source'}-${entryIndex}`}>
                  {entry.source ?? 'Unknown source'}
                  {entry.tokens === undefined ? '' : ` · ${formatTokenCount(entry.tokens)} tok`}
                </span>
              ))
            ) : (
              <span className="hint">No sources selected.</span>
            )}
          </div>
        </div>

        <div>
          <span className="evidence-record-label">Excluded by policy</span>
          <div className="evidence-chip-list">
            {exclusions.length ? (
              exclusions.map((exclusion) => (
                <span className="evidence-chip evidence-chip-muted" key={exclusion}>
                  {exclusion}
                </span>
              ))
            ) : (
              <span className="hint">No exclusions recorded.</span>
            )}
          </div>
        </div>

        {omitted.length ? (
          <div>
            <span className="evidence-record-label">Omitted context</span>
            <ul className="disclosure-omitted">
              {omitted.map((entry, omittedIndex) => (
                <li key={`${entry.id ?? 'omitted'}-${omittedIndex}`}>
                  <strong>{entry.id ?? 'Unknown item'}</strong>
                  <span>{entry.reason ?? 'No reason recorded'}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

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
  const disclosures = title === 'Disclosures';

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
        ) : disclosures ? (
          <div className="evidence-record-list">
            {items.map((item, index) => (
              <DisclosureCard item={item} index={index} key={String(item.id ?? index)} />
            ))}
          </div>
        ) : (
          items.map((item, index) => (
            <article className="evidence-item" key={String(item.id ?? index)}>
              {Object.entries(item).map(([key, value]) => (
                <p key={key}>
                  <span>{key.replace(/_/g, ' ')}</span> {displayFieldValue(key, value)}
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
