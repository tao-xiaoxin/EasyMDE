import { createElement } from '@wordpress/element';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToolbarErrorBoundary } from './ToolbarErrorBoundary';

function BrokenToolbar(): never {
  throw new Error('synthetic toolbar render failure');
}

describe('ToolbarErrorBoundary', () => {
  it('reports a descendant render failure and removes the failed React surface', () => {
    const onFailure = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const preventSyntheticError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', preventSyntheticError);

    try {
      const { container } = render(
        <ToolbarErrorBoundary onFailure={onFailure}>
          <BrokenToolbar />
        </ToolbarErrorBoundary>
      );

      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(container.childElementCount).toBe(0);
    } finally {
      window.removeEventListener('error', preventSyntheticError);
      consoleError.mockRestore();
    }
  });
});
