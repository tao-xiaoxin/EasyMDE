export function wordpressEndpoint(value: string, siteUrl: string, code: string): URL {
  let endpoint: URL;
  let site: URL;
  try {
    endpoint = new URL(value, siteUrl);
    site = new URL(siteUrl);
  } catch {
    throw new Error(code);
  }

  if (
    !/^https?:$/.test(site.protocol)
    || endpoint.origin !== site.origin
    || endpoint.username
    || endpoint.password
    || endpoint.hash
    || !/^https?:$/.test(endpoint.protocol)
  ) {
    throw new Error(code);
  }

  return endpoint;
}
