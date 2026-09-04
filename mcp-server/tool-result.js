export function formatToolResult(name, result) {
  if (name !== 'rav_capture_canvas') {
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return { content: [{ type: 'text', text }], ...(result?.applied === false ? { isError: true } : {}) };
  }

  const data = result?.image?.data;
  const mimeType = result?.image?.mimeType;
  if (typeof data !== 'string' || !data || mimeType !== 'image/png') {
    throw new Error('RAV returned an invalid canvas screenshot payload');
  }
  const metadata = result?.metadata && typeof result.metadata === 'object'
    ? result.metadata
    : {};
  return {
    content: [
      { type: 'text', text: JSON.stringify({ metadata }, null, 2) },
      { type: 'image', data, mimeType },
    ],
    structuredContent: { metadata },
  };
}
