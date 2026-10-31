// Signing with a passkey in the browser. The server's options are JSON; WebAuthn takes bytes, and answers in bytes.
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const toB64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const passkeysAvailable = () => typeof window !== 'undefined' && !!window.PublicKeyCredential;

export async function signWithPasskey(options: any) {
  const cred = await navigator.credentials.get({
    publicKey: { ...options, challenge: fromB64url(options.challenge), allowCredentials: (options.allowCredentials || []).map((c: any) => ({ ...c, id: fromB64url(c.id) })) },
  }) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelled');
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id, rawId: toB64url(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(),
    response: { clientDataJSON: toB64url(r.clientDataJSON), authenticatorData: toB64url(r.authenticatorData), signature: toB64url(r.signature), userHandle: r.userHandle ? toB64url(r.userHandle) : undefined },
  };
}
