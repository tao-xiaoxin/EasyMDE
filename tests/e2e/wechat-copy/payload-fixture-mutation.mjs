// Payload fixture mutation owner.


export async function mutateMdmdtLinkPayload(page, html, mutation) {
  return page.evaluate(({ sourceHtml, mutationName }) => {
    const holder = document.createElement('template');
    holder.innerHTML = sourceHtml;
    const anchor = [...holder.content.querySelectorAll('a')]
      .find((candidate) => candidate.textContent?.includes('STYLE-LINK'));
    const marker = anchor?.querySelector(':scope > span[aria-hidden="true"]');
    const image = marker?.querySelector(':scope > img');
    if (!marker || !image) throw new Error('wechat-mdmdt-negative-fixture-unavailable');
    if ('svg' === mutationName) {
      image.setAttribute(
        'src',
        'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect width=%22200%22 height=%22200%22 fill=%22red%22/%3E%3C/svg%3E'
      );
    } else if ('size' === mutationName) {
      marker.style.setProperty('width', '200px', 'important');
    } else {
      throw new Error('wechat-mdmdt-negative-fixture-mutation-invalid');
    }
    return holder.innerHTML;
  }, { sourceHtml: html, mutationName: mutation });
}
