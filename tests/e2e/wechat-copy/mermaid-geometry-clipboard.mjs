// System clipboard payload reader.


export async function readSystemClipboardPayload(page) {
  return page.evaluate(async () => {
    if (!navigator.clipboard?.read) throw new Error('wechat-system-clipboard-read-unavailable');
    const items = await navigator.clipboard.read();
    const item = items[0];
    if (!item) throw new Error('wechat-system-clipboard-item-unavailable');
    const html = await (await item.getType('text/html')).text();
    const text = await (await item.getType('text/plain')).text();
    return { html, text };
  });
}
