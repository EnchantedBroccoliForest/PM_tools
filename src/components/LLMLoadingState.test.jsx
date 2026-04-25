/**
 * LLMLoadingState rigor-chip test.
 *
 * Phase 3 added a small Machine/Human chip next to the phase label.
 * The chip is the only at-a-glance signal the user gets that the in-flight
 * stage is running under the rigor they intended; a refactor that
 * silently drops it (or breaks the prop wiring) would erase that signal
 * with no other failure mode firing.
 *
 * The repo doesn't have a full React testing harness (no jsdom / no
 * @testing-library/react), so this test renders the component to static
 * HTML via react-dom/server. That's enough to check the chip text and
 * its rigor-specific class without standing up a DOM environment.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LLMLoadingState from './LLMLoadingState.jsx';

const META = { models: ['gpt-test'], startTime: Date.now() };

describe('LLMLoadingState rigor chip', () => {
  it('renders a Human chip when rigor=human', () => {
    const html = renderToStaticMarkup(
      <LLMLoadingState phase="draft" meta={META} rigor="human" />,
    );
    expect(html).toContain('Human');
    expect(html).toContain('llm-loading__rigor--human');
  });

  it('renders a Machine chip when rigor=machine', () => {
    const html = renderToStaticMarkup(
      <LLMLoadingState phase="draft" meta={META} rigor="machine" />,
    );
    expect(html).toContain('Machine');
    expect(html).toContain('llm-loading__rigor--machine');
  });

  it('renders no chip when rigor is omitted (back-compat for older callers)', () => {
    const html = renderToStaticMarkup(
      <LLMLoadingState phase="draft" meta={META} />,
    );
    expect(html).not.toContain('llm-loading__rigor');
  });
});
