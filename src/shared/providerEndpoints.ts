function httpEndpoint(endpoint: string): URL {
  const url = new URL(endpoint)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('The API base URL must use HTTP or HTTPS without credentials or a fragment')
  }
  return url
}

export function geminiUrl(endpoint: string, model?: string): URL {
  const url = httpEndpoint(endpoint)
  const path = url.pathname.replace(/\/+$/, '')
  const collection = /\/models(?:\/[^/]+)?$/.test(path)
    ? path.replace(/\/models(?:\/[^/]+)?$/, '/models')
    : `${path || '/v1beta'}/models`
  url.pathname = model === undefined ? collection : `${collection}/${encodeURIComponent(model)}:generateContent`
  return url
}

export function azureChatUrl(endpoint: string, model: string, apiVersion = ''): URL {
  const url = httpEndpoint(endpoint)
  const path = url.pathname.replace(/\/+$/, '')
  const deploymentPath = `/deployments/${encodeURIComponent(model)}/chat/completions`
  if (/\/deployments\/[^/]+(?:\/chat\/completions)?$/.test(path)) {
    url.pathname = path.replace(/\/deployments\/[^/]+(?:\/chat\/completions)?$/, () => deploymentPath)
  } else {
    const base = path.replace(/\/chat\/completions$/, '')
    url.pathname = `${base}${base.endsWith('/openai') ? '' : '/openai'}${deploymentPath}`
  }
  const version = apiVersion || url.searchParams.get('api-version') || '2024-10-21'
  const query = url.search ? url.search.slice(1).split('&') : []
  url.search = [...query.filter(parameter => !new URLSearchParams(parameter).has('api-version')), `api-version=${encodeURIComponent(version)}`].join('&')
  return url
}
