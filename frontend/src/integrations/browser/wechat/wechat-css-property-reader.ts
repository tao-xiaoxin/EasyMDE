/**
 * Narrowest CSS reading contract for the WeChat geometry and projection
 * helpers. They only read individual property values, so they must not claim a
 * complete `CSSStyleDeclaration`. A real `CSSStyleDeclaration` satisfies this
 * contract structurally, and a projected style reader can implement it without
 * an unsafe cast.
 */
export type CssPropertyReader = Pick<CSSStyleDeclaration, 'getPropertyValue'>;
