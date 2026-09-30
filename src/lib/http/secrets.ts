// Compares fixed-size SHA-256 digests in constant time using byte-level XOR
// to eliminate observable timing side channels. Used by the internal
// endpoints that have no admin session and rely on a shared secret.
export async function secretsMatch(
  provided: string,
  expected: string
): Promise<boolean> {
  if (!provided || !expected) return false;
  const enc = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const a = new Uint8Array(digestA);
  const b = new Uint8Array(digestB);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}
