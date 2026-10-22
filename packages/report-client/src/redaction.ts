import {redactAcpText} from '../vendor/acp-text-redaction.js';
/** Calls the canonical ACP implementation, bundled at build time; no second policy. */
export function redact(text:string,maxLength=4000):string { return redactAcpText(text,maxLength); }
