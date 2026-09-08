import { render, waitFor } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it } from 'vitest';

import { useImmersiveDocumentDerivations } from './ImmersiveEditor';

function DerivationProbe({ markdown }: Readonly<{ markdown: string }>) {
  const { outline, stats } = useImmersiveDocumentDerivations(markdown);
  return (
    <div>
      <output data-testid="canonical">{markdown}</output>
      <output data-testid="characters">{stats.characters}</output>
      <output data-testid="headings">{outline.length}</output>
    </div>
  );
}

describe('ImmersiveEditor document derivations', () => {
  it('keeps the canonical value immediate while deferred stats and outline settle', async () => {
    const initial = '# Initial\n\nshort';
    const next = `${Array.from(
      { length: 1200 },
      (_, index) => `## Section ${index}\n\nbody ${index}`
    ).join('\n\n')}\n\nend`;
    const view = render(<DerivationProbe markdown={initial} />);

    expect(view.getByTestId('canonical').textContent).toBe(initial);
    expect(view.getByTestId('characters').textContent).toBe('12');
    expect(view.getByTestId('headings').textContent).toBe('1');

    view.rerender(<DerivationProbe markdown={next} />);

    expect(view.getByTestId('canonical').textContent).toBe(next);
    await waitFor(() => {
      expect(view.getByTestId('characters').textContent).toBe(
        String(next.replace(/[#*_~`>|()[\]]/g, '').replace(/\s/gu, '').length)
      );
      expect(view.getByTestId('headings').textContent).toBe('1200');
    });
  });

  it('settles on the final derivation after rapid consecutive edits', async () => {
    const first = '# First\n\nbody';
    const second = '# Second\n\n## Intermediate\n\nbody';
    const final = '# Final\n\n## Stable\n\n## More\n\nbody';
    const view = render(<DerivationProbe markdown={first} />);

    view.rerender(<DerivationProbe markdown={second} />);
    view.rerender(<DerivationProbe markdown={final} />);

    expect(view.getByTestId('canonical').textContent).toBe(final);
    await waitFor(() => {
      expect(view.getByTestId('headings').textContent).toBe('3');
      expect(view.getByTestId('characters').textContent).toBe('19');
    });
  });
});
