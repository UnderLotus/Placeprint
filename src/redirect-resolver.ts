const DOMAINEE_REDIRECT_CHECKER_URL =
  'https://api.domainee.dev/v1/tools/redirect-checker';

export interface RedirectResolverOptions {
  fetcher?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Expand one valid HTTP(S) URL through Domainee's public redirect checker. */
export async function resolveRedirectUrl(
  sourceUrl: string,
  options: RedirectResolverOptions = {},
): Promise<string> {
  const endpoint = new URL(DOMAINEE_REDIRECT_CHECKER_URL);
  endpoint.searchParams.set('url', sourceUrl);
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(endpoint.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error('Redirect resolver failed with HTTP ' + response.status + '.');
  }

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch (error) {
    throw new Error('Redirect resolver returned invalid JSON: ' + String(error));
  }
  if (!isRecord(envelope) || envelope.ok !== true || !isRecord(envelope.data)) {
    throw new Error('Redirect resolver returned an unsuccessful response.');
  }

  const finalUrl = envelope.data.finalUrl;
  if (typeof finalUrl !== 'string' || !finalUrl.trim()) {
    throw new Error('Redirect resolver response did not include data.finalUrl.');
  }
  const trimmedFinalUrl = finalUrl.trim();
  try {
    const parsed = new URL(trimmedFinalUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
  } catch (error) {
    throw new Error('Redirect resolver returned an invalid final URL: ' + String(error));
  }
  return trimmedFinalUrl;
}

export { DOMAINEE_REDIRECT_CHECKER_URL };
