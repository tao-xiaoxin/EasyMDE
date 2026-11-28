import { describe, expect, it } from 'vitest';

import { normalizePortableMedia } from './wechat-portable-media';

function expectResponsiveMediaBounds(element: Element): void {
  expect(element).toHaveProperty('style');
  const style = (element as HTMLElement).style;
  expect(style.getPropertyValue('max-width')).toBe('100%');
  expect(style.getPropertyPriority('max-width')).toBe('important');
  expect(style.getPropertyValue('height')).toBe('auto');
  expect(style.getPropertyPriority('height')).toBe('important');
}

describe('normalizePortableMedia', () => {
  it.each([
    ['IMG', 'img'],
    ['VIDEO', 'video']
  ])('preserves a %s percentage width when a width attribute exists', (_label, tagName) => {
    const element = document.createElement(tagName);
    element.style.setProperty('display', 'block');
    element.style.setProperty('width', '50%', 'important');
    element.setAttribute('width', '640');

    normalizePortableMedia(element);

    expect(element.style.getPropertyValue('width')).toBe('50%');
    expect(element.style.getPropertyPriority('width')).toBe('important');
    expectResponsiveMediaBounds(element);
  });

  it('preserves authored auto widths when image and video intrinsic sizes exist', () => {
    const image = document.createElement('img');
    image.style.setProperty('display', 'block');
    image.style.setProperty('width', 'auto', 'important');
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 640 });

    const video = document.createElement('video');
    video.style.setProperty('display', 'block');
    video.style.setProperty('width', 'auto', 'important');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });

    [image, video].forEach((element) => {
      normalizePortableMedia(element);
      expect(element.style.getPropertyValue('width')).toBe('auto');
      expect(element.style.getPropertyPriority('width')).toBe('important');
      expectResponsiveMediaBounds(element);
    });
  });

  it.each([
    ['IMG', 'img', 'attribute'],
    ['IMG', 'img', 'intrinsic'],
    ['VIDEO', 'video', 'attribute'],
    ['VIDEO', 'video', 'intrinsic']
  ])('preserves an explicit 0px width for %s with %s dimensions', (_label, tagName, source) => {
    const element = document.createElement(tagName);
    element.style.setProperty('display', 'block');
    element.style.setProperty('width', '0px', 'important');
    if ('attribute' === source) element.setAttribute('width', '640');
    else Object.defineProperty(element, 'img' === tagName ? 'naturalWidth' : 'videoWidth', { value: 640 });

    normalizePortableMedia(element);

    expect(element.style.getPropertyValue('width')).toBe('0px');
    expect(element.style.getPropertyPriority('width')).toBe('important');
    expectResponsiveMediaBounds(element);
  });

  it('keeps the capped pixel width behavior for block media', () => {
    const image = document.createElement('img');
    image.style.setProperty('display', 'block');
    image.style.setProperty('width', '1200px', 'important');
    image.style.setProperty('max-width', '332px', 'important');
    image.style.setProperty('height', '268px', 'important');

    normalizePortableMedia(image);

    expect(image.style.getPropertyValue('width')).toBe('332px');
    expect(image.style.getPropertyPriority('width')).toBe('important');
    expectResponsiveMediaBounds(image);
  });
});
