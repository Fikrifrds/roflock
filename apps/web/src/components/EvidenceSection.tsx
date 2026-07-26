import { formatValue } from '../lib/format.js';
import { Empty } from './primitives.js';

export function EvidenceSection({
  title,
  items,
}: {
  title: string;
  items: Array<Record<string, unknown>>;
}) {
  return (
    <section className="evidence-section">
      <h3>{title}</h3>
      {items.length ? (
        items.map((item, index) => (
          <article className="evidence-item" key={String(item.id ?? index)}>
            {Object.entries(item).map(([key, value]) => (
              <p key={key}>
                <span>{key.replace(/_/g, ' ')}</span> {formatValue(value)}
              </p>
            ))}
          </article>
        ))
      ) : (
        <Empty message={`No ${title.toLowerCase()} recorded yet.`} />
      )}
    </section>
  );
}
