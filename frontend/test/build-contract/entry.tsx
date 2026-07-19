import { createElement } from '@wordpress/element';
import { Fragment } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

import fixtureAssetUrl from './fixture.svg?url';

const wordPressReactContract = Object.freeze({
  Fragment,
  createElement,
  createPortal,
  createRoot,
  fixtureAssetUrl,
  fixture: <span data-easymde-build-contract="wordpress-element" />
});

Object.defineProperty(globalThis, 'EasyMDEBuildContract', {
  configurable: true,
  value: wordPressReactContract
});
