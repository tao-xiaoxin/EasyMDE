import { describe, expect, it } from 'vitest';

import {
  type PreviewEnhancementBootstrapError,
  parsePreviewEnhancementBootstrap
} from './preview-enhancement-bootstrap';
import { previewEnhancementBootstrapFixture } from '../../test/preview-enhancement-bootstrap-fixture';

describe('parsePreviewEnhancementBootstrap', () => {
  it('validates local runtime assets, code theme assets and translated failures', () => {
    expect(parsePreviewEnhancementBootstrap(previewEnhancementBootstrapFixture))
      .toEqual(previewEnhancementBootstrapFixture);
  });

  it.each([
    {
      code: 'preview-enhancement-assets-invalid',
      name: 'missing runtime asset URL',
      value: {
        ...previewEnhancementBootstrapFixture,
        assets: { ...previewEnhancementBootstrapFixture.assets, mermaidScriptUrl: '' }
      }
    },
    {
      code: 'preview-enhancement-asset-base-invalid',
      name: 'non-HTTP plugin asset base',
      value: {
        ...previewEnhancementBootstrapFixture,
        assetBaseUrl: 'data:text/plain,invalid'
      }
    },
    {
      code: 'preview-enhancement-assets-invalid',
      name: 'remote runtime asset URL',
      value: {
        ...previewEnhancementBootstrapFixture,
        assets: {
          ...previewEnhancementBootstrapFixture.assets,
          mermaidScriptUrl: 'https://invalid.example/mermaid.js'
        }
      }
    },
    {
      code: 'preview-enhancement-assets-invalid',
      name: 'encoded plugin-path traversal',
      value: {
        ...previewEnhancementBootstrapFixture,
        assets: {
          ...previewEnhancementBootstrapFixture.assets,
          mermaidScriptUrl: 'assets/%2e%2e%2foutside.js'
        }
      }
    },
    {
      code: 'preview-enhancement-code-themes-invalid',
      name: 'duplicate code theme ID',
      value: {
        ...previewEnhancementBootstrapFixture,
        codeThemes: [
          ...previewEnhancementBootstrapFixture.codeThemes,
          previewEnhancementBootstrapFixture.codeThemes[0]
        ]
      }
    },
    {
      code: 'preview-enhancement-code-theme-invalid',
      name: 'executable code theme URL',
      value: {
        ...previewEnhancementBootstrapFixture,
        codeThemes: [{ cssUrl: 'javascript:alert(1)', id: 'unsafe' }]
      }
    },
    {
      code: 'preview-enhancement-assets-invalid',
      name: 'duplicate stylesheet owner ID',
      value: {
        ...previewEnhancementBootstrapFixture,
        assets: {
          ...previewEnhancementBootstrapFixture.assets,
          codeFrameLinkId: previewEnhancementBootstrapFixture.assets.highlightThemeLinkId
        }
      }
    },
    {
      code: 'preview-enhancement-code-theme-invalid',
      name: 'unsafe code theme ID',
      value: {
        ...previewEnhancementBootstrapFixture,
        codeThemes: [{ cssUrl: '/theme.css', id: '../theme' }]
      }
    },
    {
      code: 'preview-enhancement-strings-invalid',
      name: 'missing translated failure string',
      value: {
        ...previewEnhancementBootstrapFixture,
        strings: { renderingFailed: '' }
      }
    }
  ])('rejects $name', ({ code, value }) => {
    expect(() => parsePreviewEnhancementBootstrap(value)).toThrowError(
      expect.objectContaining<Partial<PreviewEnhancementBootstrapError>>({ code })
    );
  });
});
