import { describe, expect, it } from 'vitest';

import { declaredStyleValue } from './wechat-clipboard-test-fixtures';
import { splitCssDeclarations, splitCssList } from './wechat-css-list';

describe('splitCssList', () => {
  it('splits a comma list on top-level commas only', () => {
    expect(splitCssList('url("a,b.png") center, linear-gradient(rgba(0, 0, 0, .5), red) no-repeat')).toEqual([
      'url("a,b.png") center',
      'linear-gradient(rgba(0, 0, 0, .5), red) no-repeat'
    ]);
  });

  it('keeps quoted and escaped commas inside one entry', () => {
    expect(splitCssList('"a,b", c\\,d')).toEqual(['"a,b"', 'c\\,d']);
  });

  it('drops empty and trailing entries', () => {
    expect(splitCssList(', ,none,')).toEqual(['none']);
  });
});

describe('splitCssDeclarations', () => {
  it('extracts trimmed properties and values in source order', () => {
    expect(splitCssDeclarations('display:block; position: absolute ;color:rgb(1, 2, 3)')).toEqual([
      { important: false, property: 'display', value: 'block' },
      { important: false, property: 'position', value: 'absolute' },
      { important: false, property: 'color', value: 'rgb(1, 2, 3)' }
    ]);
  });

  it('keeps a quoted semicolon inside one declaration value', () => {
    expect(splitCssDeclarations('content:"a;b";color:red')).toEqual([
      { important: false, property: 'content', value: '"a;b"' },
      { important: false, property: 'color', value: 'red' }
    ]);
  });

  it('keeps nested function separators inside one declaration value', () => {
    expect(splitCssDeclarations('background:linear-gradient(rgba(0, 0, 0, 0.5), rgb(255, 0, 0));width:16px')).toEqual([
      { important: false, property: 'background', value: 'linear-gradient(rgba(0, 0, 0, 0.5), rgb(255, 0, 0))' },
      { important: false, property: 'width', value: '16px' }
    ]);
  });

  it('keeps an escaped semicolon inside one declaration value', () => {
    expect(splitCssDeclarations('font-family:a\\;b;width:8px')).toEqual([
      { important: false, property: 'font-family', value: 'a\\;b' },
      { important: false, property: 'width', value: '8px' }
    ]);
  });

  it('treats an odd backslash run as escaping the closing quote', () => {
    expect(splitCssDeclarations('content:"a\\";color:red')).toEqual([
      { important: false, property: 'content', value: '"a\\";color:red' }
    ]);
  });

  it('lets an even backslash run close the quote again', () => {
    expect(splitCssDeclarations('content:"a\\\\";color:red')).toEqual([
      { important: false, property: 'content', value: '"a\\\\"' },
      { important: false, property: 'color', value: 'red' }
    ]);
  });

  it('drops empty, propertyless, and valueless entries', () => {
    expect(splitCssDeclarations('color:red;;  ;;width:1px;')).toEqual([
      { important: false, property: 'color', value: 'red' },
      { important: false, property: 'width', value: '1px' }
    ]);
    expect(splitCssDeclarations('')).toEqual([]);
    expect(splitCssDeclarations(';')).toEqual([]);
    expect(splitCssDeclarations('color')).toEqual([]);
    expect(splitCssDeclarations(':red;color: ;width:1px')).toEqual([
      { important: false, property: 'width', value: '1px' }
    ]);
  });

  it('keeps duplicate normal and important declarations in source order', () => {
    expect(splitCssDeclarations('color:red;color:blue!important; color:green ! important')).toEqual([
      { important: false, property: 'color', value: 'red' },
      { important: true, property: 'color', value: 'blue' },
      { important: true, property: 'color', value: 'green' }
    ]);
    expect(splitCssDeclarations('color:red!important;color:blue')).toEqual([
      { important: true, property: 'color', value: 'red' },
      { important: false, property: 'color', value: 'blue' }
    ]);
  });
});

describe('declaredStyleValue', () => {
  const styleOf = (style: string): HTMLElement => {
    const element = document.createElement('span');
    element.setAttribute('style', style);
    return element;
  };

  it('cascades by importance first and order second', () => {
    expect(declaredStyleValue(styleOf('color:red!important;color:blue'), 'color')).toBe('red');
    expect(declaredStyleValue(styleOf('color:red;color:blue!important'), 'color')).toBe('blue');
    expect(declaredStyleValue(styleOf('color:red;color:blue'), 'color')).toBe('blue');
  });

  it('reads a normalised property name and reports an absent declaration', () => {
    expect(declaredStyleValue(styleOf('width:8px'), ' WIDTH ')).toBe('8px');
    expect(declaredStyleValue(styleOf('width:8px'), 'height')).toBe('');
  });
});
