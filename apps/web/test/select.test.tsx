import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Select, type SelectOption } from '../src/components/Select.js';

const OPTIONS: SelectOption[] = [
  { value: 'direct', label: 'Direct', description: 'Writer → test → accept' },
  { value: 'fast', label: 'Fast', description: 'Planner → writer → test' },
  { value: 'standard', label: 'Standard', description: 'Adds a reviewer' },
  { value: 'critical', label: 'Critical Feature', description: 'Highest assurance' },
];

function Harness({ initial = 'fast' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <span id="mode-label" className="field-label">
        Workflow
      </span>
      <Select id="mode" labelledBy="mode-label" value={value} options={OPTIONS} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const trigger = () => screen.getByRole('combobox');
const value = () => screen.getByTestId('value').textContent;

describe('Select', () => {
  it('shows the selected label and its description', () => {
    render(<Harness />);
    expect(trigger()).toHaveTextContent('Fast');
    expect(trigger()).toHaveTextContent('Planner → writer → test');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on click and marks the current value as selected', async () => {
    render(<Harness />);
    await userEvent.click(trigger());

    const list = screen.getByRole('listbox');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(within(list).getByRole('option', { selected: true })).toHaveTextContent('Fast');
    // Every option carries its explanation, which is the reason this is not a
    // native select.
    expect(within(list).getByText('Highest assurance')).toBeInTheDocument();
  });

  it('selects with the mouse and closes', async () => {
    render(<Harness />);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('option', { name: /Critical Feature/ }));

    expect(value()).toBe('critical');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('navigates and commits with the keyboard', async () => {
    render(<Harness initial="direct" />);
    trigger().focus();

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(value()).toBe('fast');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('wraps at both ends and supports Home/End', async () => {
    render(<Harness initial="direct" />);
    trigger().focus();

    // Opening lands on the current option, so one ArrowUp wraps to the last.
    await userEvent.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    expect(value()).toBe('critical');

    await userEvent.keyboard('{ArrowDown}{Home}{Enter}');
    expect(value()).toBe('direct');

    await userEvent.keyboard('{ArrowDown}{End}{Enter}');
    expect(value()).toBe('critical');
  });

  it('jumps to an option by typing its first letters', async () => {
    render(<Harness initial="direct" />);
    trigger().focus();

    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('sta');
    await userEvent.keyboard('{Enter}');
    expect(value()).toBe('standard');
  });

  it('closes on Escape without changing the value', async () => {
    render(<Harness />);
    trigger().focus();

    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(value()).toBe('fast');
  });

  it('closes when a pointer goes down outside it', async () => {
    render(
      <>
        <Harness />
        <button type="button">elsewhere</button>
      </>,
    );
    await userEvent.click(trigger());
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps focus on the trigger and points at the active option', async () => {
    render(<Harness initial="direct" />);
    trigger().focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');

    // The ARIA combobox pattern: options never take focus themselves.
    expect(document.activeElement).toBe(trigger());
    const active = trigger().getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)).toHaveTextContent('Fast');
  });

  it('renders a placeholder when nothing is selected', () => {
    render(
      <Select value="" options={OPTIONS} onChange={vi.fn()} placeholder="Choose a workflow" />,
    );
    expect(screen.getByRole('combobox')).toHaveTextContent('Choose a workflow');
  });

  it('says so when there is nothing to choose', async () => {
    render(<Select value="" options={[]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByText('Nothing to choose from yet.')).toBeInTheDocument();
  });

  it('cannot be opened when disabled', async () => {
    render(<Select value="fast" options={OPTIONS} onChange={vi.fn()} disabled />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
