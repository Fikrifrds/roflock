import type { ReactNode } from 'react';
import type { Tone } from '../lib/format.js';

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

export function Empty({ message }: { message: string }) {
  return <div className="empty">{message}</div>;
}
