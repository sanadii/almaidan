/** The dev proxy must use the socket address; forwarding headers are untrusted. */
export const isLoopbackAddress = (address: string | undefined) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '');

const segment = (part: string) => { try { return decodeURIComponent(part).toLowerCase(); } catch { return part.toLowerCase(); } };

/**
 * URL has already normalized dot segments; filtering makes repeated slashes unambiguous.
 * Covers the hosted-admin dev API and the Enta local content admin proxied at /api/v1/local-admin.
 * Comparison is case-insensitive because Express route matching is.
 */
export const isLocalAdminPath = (pathname: string) => {
  const parts = pathname.split('/').filter(Boolean).map(segment);
  return parts[0] === 'api' && (parts[1] === 'admin' || (parts[1] === 'v1' && parts[2] === 'local-admin'));
};

export const mustRestrictLocalAdmin = (pathname: string, socketAddress: string | undefined) =>
  isLocalAdminPath(pathname) && !isLoopbackAddress(socketAddress);
