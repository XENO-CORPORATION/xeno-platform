/**
 * XENO Storage as agent capabilities (XENO WORKSPACE AGENT SURFACE - SPEC.md P1, Storage division first).
 *
 * Every tool calls the SAME service function the person's Storage screen calls (storageFolders.js,
 * libraryAssets.registerManagedLibraryFile, storageFolderLinks.js), so there is one code path. An agent acts
 * FOR its owner: the files and folders are the owner's, and the owner's own rights are the ceiling (an agent
 * can never reach a folder its owner cannot). Who did it is recorded by the call log against the agent.
 *
 * Owner decision 2026-10-20 (§5 Q1): agents create SIGN-IN links only, never public links. `create_signin_link`
 * makes a PR #824 link (opening it needs a XENO account); there is no tool for a public file link.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFolders, createFolder, moveItemToFolder } from './storageFolders.js';
import { registerManagedLibraryFile } from './libraryAssets.js';
import { createFolderLink } from './storageFolderLinks.js';
import { storeFileObject } from './storageObjects.js';
import { publicSiteOrigin } from '../config/hosts.js';

export class StorageMcpError extends Error { constructor(message, code) { super(message); this.name = 'StorageMcpError'; this.code = code; } }

const RO = { readOnlyHint: true, openWorldHint: false }, RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const ID = (what) => ({ type: 'string', description: `${what} id (a UUID).` });
const UPLOADS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');

/** What an agent may upload. The same types the person's upload accepts; smaller, because it travels as JSON. */
export const UPLOAD_MIMES = Object.freeze(new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'application/json', 'text/csv', 'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'video/mp4', 'audio/mpeg',
]));
export const MAX_AGENT_UPLOAD = 10 * 1024 * 1024;

export const TOOLS = [
  { name: 'list_folders', title: 'List folders', annotations: RO,
    description: 'The folders in one place of your owner’s Storage: the top of their own Storage (no arguments), inside one folder (`parent`), or the top of a workspace’s team folders (`workspace`). Each has id, name, and how many items and folders it holds. Use it to find a folder id before uploading or sharing.',
    inputSchema: { type: 'object', properties: { parent: ID('A folder'), workspace: ID('A workspace') }, additionalProperties: false } },
  { name: 'create_folder', title: 'Create a folder', annotations: RW,
    description: 'Make a folder in your owner’s Storage — at the top, inside `parent`, or (with `workspace`) as a team folder. A name already used in the same place is refused (folder_exists), so a retry cannot make a second one. Returns the folder with its id.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'The folder name, 1–120 characters.' }, parent: ID('The parent folder'), workspace: ID('A workspace (team folder)') }, additionalProperties: false } },
  { name: 'upload_file', title: 'Upload a file', annotations: RW,
    description: 'Upload one file (up to 10 MB, sent as base64) into your owner’s Storage, optionally straight into a folder. It counts against their storage allowance and is scanned before anyone can open it (state starts "quarantined"). Pass `request_key` so a retried upload is answered rather than stored twice. Do not use it for a file you made with image or video tools: those are already in the Library.',
    inputSchema: { type: 'object', required: ['name', 'mime_type', 'content_base64', 'request_key'], properties: {
      name: { type: 'string', description: 'The file name people will see, e.g. "deck.pdf".' },
      mime_type: { type: 'string', description: 'Its type, e.g. application/pdf.' },
      content_base64: { type: 'string', description: 'The file bytes, base64.' },
      folder: ID('The folder to put it in'),
      request_key: { type: 'string', description: 'Your own key for this upload, 8–128 characters.' } }, additionalProperties: false } },
  { name: 'create_signin_link', title: 'Share a folder by a sign-in link', annotations: RW,
    description: 'Make a link to one of your owner’s own folders that opens ONLY for someone signed in to a XENO account: they can read the folder and download its files, never change it; every open is recorded; the owner can revoke it. Never a public link — agents cannot make one. The link is shown once in `url`; give it to the person who asked.',
    inputSchema: { type: 'object', required: ['folder'], properties: { folder: ID('The folder to share'), expires_in_days: { type: 'integer', description: 'Optional: 1–365 days until it stops working.' }, label: { type: 'string', description: 'Optional: a name for the link in the owner’s list.' } }, additionalProperties: false } },
];

/** The account whose Storage this actor works in: an agent's owner, or the person themselves. */
export async function storageOwnerOf(db, actor) {
  if (!actor || !actor.id) throw new StorageMcpError('No caller', 'not_allowed');
  if (actor.kind !== 'agent') return String(actor.id);
  const r = (await db.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [actor.id])).rows[0];
  if (!r || !r.owner_user_id) throw new StorageMcpError('This agent has no owner, so it has no Storage to work in', 'no_owner');
  return String(r.owner_user_id);
}

const refuse = (r, what) => {
  if (r.notFound) throw new StorageMcpError(`${what} not found, or your owner cannot use it`, 'not_found');
  if (r.forbidden) throw new StorageMcpError(`Your owner may only view ${what.toLowerCase()}`, 'forbidden');
  if (r.conflict) throw new StorageMcpError(r.code === 'folder_exists' ? 'A folder with that name is already there' : `Refused: ${r.code}`, r.code);
  if (r.invalid) throw new StorageMcpError(`Invalid: ${r.code || 'input'}`, r.code || 'invalid');
};

/** Agent uploads keyed by (owner, request_key): a retry returns the first upload instead of storing again. */
const uploaded = new Map();

export async function callTool(db, actor, name, a = {}) {
  const owner = await storageOwnerOf(db, actor);
  switch (name) {
    case 'list_folders': {
      const r = await listFolders(db, owner, a.parent || null, a.workspace || null);
      refuse(r, 'Folder');
      return ok({ folders: r.folders || [] });
    }
    case 'create_folder': {
      const r = await createFolder(db, owner, { name: a.name, parentId: a.parent || null, workspaceId: a.workspace || null });
      refuse(r, 'Folder');
      return ok({ folder: r.folder });
    }
    case 'upload_file': return ok(await upload(db, owner, a));
    case 'create_signin_link': {
      const r = await createFolderLink(db, owner, String(a.folder || ''), { expiresInDays: a.expires_in_days ?? null, label: a.label ?? null });
      if (r.invalid) throw new StorageMcpError('expires_in_days must be a whole number from 1 to 365', 'invalid_expiry');
      refuse(r, 'Folder (only your owner’s own folders can be shared by link)');
      return ok({ link: r.link, url: `${publicSiteOrigin()}/storage/shared/${r.token}` });
    }
    default: throw new StorageMcpError(`Unknown tool ${name}`, 'unknown_tool');
  }
}

async function upload(db, owner, a) {
  const key = String(a.request_key || '');
  if (key.length < 8 || key.length > 128) throw new StorageMcpError('request_key must be 8–128 characters', 'invalid_request_key');
  const memo = `${owner}:${key}`;
  if (uploaded.has(memo)) return { ...uploaded.get(memo), replayed: true };
  const mime = String(a.mime_type || '');
  if (!UPLOAD_MIMES.has(mime)) throw new StorageMcpError(`File type '${mime}' is not allowed`, 'type_not_allowed');
  const name = path.basename(String(a.name || '')).trim().slice(0, 200);
  if (!name) throw new StorageMcpError('name is required', 'invalid_name');
  const b64 = String(a.content_base64 || '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw new StorageMcpError('content_base64 is not base64', 'invalid_content');
  const bytes = Buffer.from(b64, 'base64');
  if (!bytes.length) throw new StorageMcpError('The file is empty', 'invalid_content');
  if (bytes.length > MAX_AGENT_UPLOAD) throw new StorageMcpError('The file is over 10 MB; upload it from the Storage screen', 'too_large');
  fs.mkdirSync(UPLOADS, { recursive: true });
  const filename = `${crypto.randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const storagePath = path.join(UPLOADS, filename);
  fs.writeFileSync(storagePath, bytes);
  let stored;
  try {
    stored = await registerManagedLibraryFile(db, { userId: owner, workspaceId: null, enforceAllowance: true, filename, originalName: name, mimeType: mime, fileSize: bytes.length, storagePath, metadata: { source: 'agent-upload' }, area: null });
  } catch (e) {
    try { fs.unlinkSync(storagePath); } catch { /* best effort */ }
    if (e && e.code === 'storage_full') throw new StorageMcpError('Your owner’s Storage is full', 'storage_full');
    throw e;
  }
  storeFileObject(db, { id: stored.id, storage_path: storagePath, content_sha256: stored.content_sha256 }).catch(() => {});
  let folderId = null;
  if (a.folder) {
    const r = await moveItemToFolder(db, { id: owner, type: 'user' }, 'file', stored.id, String(a.folder));
    refuse(r, 'Folder');
    folderId = r.folderId;
  }
  const out = { file: { id: stored.id, name, size: bytes.length, type: stored.mime_type, folderId, state: stored.ingestion_state } };
  uploaded.set(memo, out);
  if (uploaded.size > 5000) uploaded.delete(uploaded.keys().next().value);
  return out;
}
