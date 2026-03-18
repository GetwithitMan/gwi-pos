/**
 * Base64url Encoding/Decoding — Edge-Safe
 *
 * Shared by cloud-auth.ts, tenant-context-signer.ts, and any other
 * module that needs base64url for JWT operations.
 *
 * No Node.js-only APIs — works in both edge and node runtimes.
 */

export function base64urlEncodeBytes(bytes: Uint8Array): string {
  const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function base64urlDecode(str: string): Uint8Array {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4)
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
