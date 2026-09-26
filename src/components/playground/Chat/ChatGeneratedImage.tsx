/**
 * The images a chat turn made with its `generate_image` tool — drawn in the reply, under the
 * transcript head, in the order the turn made them.
 *
 * ## The three states a generated image passes through
 *
 *   generating  a placeholder ALREADY the image's shape (the server announces the aspect ratio
 *               before the wait), so nothing below it moves when the picture lands — ChatGPT's
 *               in-chat generation behaves the same way, and a square box that jumps to 16:9 on
 *               arrival is the defect this avoids;
 *   preview     the bytes the turn carried on its live `image_result` frame, shown the moment the
 *               image exists. The library copy is quarantined until its malware scan passes and the
 *               library refuses to serve it until then, so this is the only thing that CAN show;
 *   library     the stored asset, through a signed link — what a reload, the viewer and every other
 *               surface read once the scan is done.
 *
 * A failed image keeps its frame and says why, rather than vanishing: the turn really did try, and
 * the model is told the same thing so it can say so in its reply.
 *
 * ⚠️ Colours come from the chat's tokens (`--chat-*`), never literals — this renders in the light,
 * dim and dark palettes, and the image's own frame is the only thing here that is not the page.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Download } from '@/lib/icons';
import { LibraryAssetImage, type LibraryAssetImageState } from '@/components/library/LibraryAssetImage';
import { libraryService, type LibraryAssetRef } from '@/services/libraryService';
import type { ChatTurnImageStep } from './chatTurnTranscript';
import './chatGeneratedImage.css';

/** One image of a turn, as the chat has it: the step from the turn record, plus what the live frame carried. */
export interface ChatTurnImageView {
  step: ChatTurnImageStep;
  /** A data URL from the live `image_result` frame. Never stored. */
  previewUrl?: string;
  /** The library asset, once the image is stored. */
  asset?: LibraryAssetRef;
}

export interface ChatGeneratedImagesProps {
  images: ChatTurnImageView[];
  /** The turn is still running — an image step with no end is still being drawn. */
  live: boolean;
  /** Open the image in the library viewer. */
  onOpen?: (image: ChatTurnImageView) => void;
}

/** "16:9" → 16/9. Anything unreadable is square — the one shape the placeholder can always be. */
export const aspectValue = (aspectRatio: string | undefined): number => {
  const match = /^(\d+):(\d+)$/.exec(aspectRatio || '');
  if (!match) return 1;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? w / h : 1;
};

/**
 * The frame's width, from its shape: wide images get the full column, tall ones are narrower so a
 * 9:16 picture does not become a 900-pixel wall. The same numbers ChatGPT's column settles on —
 * about the height of a phone screenshot at most.
 */
export const frameMaxWidth = (aspect: number): number => {
  const MAX_WIDTH = 560;
  const MAX_HEIGHT = 560;
  return Math.round(Math.min(MAX_WIDTH, MAX_HEIGHT * aspect));
};

/**
 * The library asset for an image step, when it has one. A step whose `assetId` is missing was never
 * stored (the generation failed, or the turn was interrupted) and has nothing to fetch.
 */
export const imageAssetFor = (step: ChatTurnImageStep): LibraryAssetRef | undefined => (step.assetId
  ? {
      assetId: step.assetId,
      name: `XENO image ${new Date(step.startedAt).toISOString().replace(/[:.]/g, '-')}.png`,
      mimeType: 'image/png',
      contentUrl: `/api/library/assets/${step.assetId}/content`,
    }
  : undefined);

/** How long to wait before asking the library again for an image still in its scan. */
const QUARANTINE_RETRY_MS = [4000, 8000, 15000, 30000, 60000];

/**
 * Download the stored PNG through a signed link. While the library copy is still in its scan the
 * link is refused, and the preview the turn carried is saved instead — the person has the picture on
 * screen, and a button that does nothing for the first minute reads as broken.
 */
export async function downloadImage(image: ChatTurnImageView, asset: LibraryAssetRef | undefined): Promise<void> {
  let href = '';
  let name = asset?.name || 'XENO image.png';
  if (asset) {
    href = await libraryService.createSignedLink(asset.assetId, { download: true }).catch(() => '');
  }
  if (!href && image.previewUrl) {
    href = image.previewUrl;
    name = name.replace(/\.png$/i, '.webp');
  }
  if (!href) return;
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.rel = 'noopener';
  anchor.click();
}

const Shimmer: React.FC<{ label: string }> = ({ label }) => (
  <span className="chat-genimage-shimmer" role="status" aria-live="polite">
    <span className="chat-genimage-glint" aria-hidden="true" />
    <span className="chat-genimage-caption">{label}</span>
  </span>
);

const GeneratedImageFrame: React.FC<{ image: ChatTurnImageView; live: boolean; onOpen?: (image: ChatTurnImageView) => void }> = ({ image, live, onOpen }) => {
  const { step } = image;
  // the announced ratio sizes the placeholder; the real pixel size, once known, sizes the picture —
  // the models round (16:9 arrives as 1792x1024), and a frame that crops the result is wrong by design
  const aspect = step.width && step.height ? step.width / step.height : aspectValue(step.aspectRatio);
  const generating = !step.error && !step.assetId && step.endedAt === undefined && live;
  const failed = Boolean(step.error) || (!step.assetId && !generating && !image.previewUrl);
  const asset = image.asset || imageAssetFor(step);

  /*
   * The library copy, retried while it is in quarantine. `LibraryAssetImage` asks for a signed link
   * once; a 404 there means "not yet safe" for a minute or two after the image is made, so the frame
   * keeps showing the preview (if it has one) and asks again on a backoff. `attempt` in the key makes
   * each retry a fresh request.
   */
  const [libraryState, setLibraryState] = useState<LibraryAssetImageState>('resolving');
  // a signed link is not a picture: the preview stays up until the library copy has actually LOADED,
  // or the swap would flash an empty frame between the two
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retryTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(retryTimer.current), []);
  useEffect(() => {
    if (libraryState !== 'unavailable' || !asset || attempt >= QUARANTINE_RETRY_MS.length) return undefined;
    retryTimer.current = window.setTimeout(() => setAttempt((n) => n + 1), QUARANTINE_RETRY_MS[attempt]);
    return () => window.clearTimeout(retryTimer.current);
  }, [libraryState, asset, attempt]);

  const libraryReady = Boolean(asset) && libraryState === 'ready' && libraryLoaded;
  const showPreview = Boolean(image.previewUrl) && !libraryReady;
  const exhausted = libraryState === 'unavailable' && attempt >= QUARANTINE_RETRY_MS.length && !image.previewUrl;
  const alt = step.prompt ? `Generated image: ${step.prompt.slice(0, 180)}` : 'Generated image';
  const openable = !generating && !failed && (libraryReady || showPreview);

  return (
    <figure
      className="chat-genimage"
      data-genimage-state={generating ? 'generating' : failed ? 'failed' : libraryReady ? 'library' : showPreview ? 'preview' : 'pending'}
      data-aspect={step.aspectRatio}
      style={{ maxWidth: `${frameMaxWidth(aspect)}px` }}
    >
      <div className="chat-genimage-frame" style={{ aspectRatio: `${aspect}` }}>
        {generating ? (
          <Shimmer label="Creating image" />
        ) : failed ? (
          <span className="chat-genimage-failed" role="note">
            <span className="chat-genimage-failed-title">Image not created</span>
            <span className="chat-genimage-failed-reason">{step.error || 'This image was not finished.'}</span>
          </span>
        ) : (
          <>
            {asset && (
              <LibraryAssetImage
                key={`${asset.assetId}:${attempt}`}
                asset={asset}
                alt={alt}
                onStateChange={setLibraryState}
                onLoad={() => setLibraryLoaded(true)}
                className={`chat-genimage-img${libraryReady ? '' : ' chat-genimage-img--hidden'}`}
                loadingFallback={<span />}
                fallback={<span />}
              />
            )}
            {showPreview && (
              <img src={image.previewUrl} alt={alt} className="chat-genimage-img" draggable={false} />
            )}
            {!libraryReady && !showPreview && (
              exhausted
                ? <span className="chat-genimage-failed" role="note"><span className="chat-genimage-failed-reason">This image is still being checked. It will appear here once it is ready.</span></span>
                : <Shimmer label="Preparing image" />
            )}
            {openable && (
              <>
                <button
                  type="button"
                  className="chat-genimage-open"
                  onClick={() => onOpen?.(image)}
                  aria-label="Open image"
                />
                <span className="chat-genimage-actions">
                  <button
                    type="button"
                    className="chat-genimage-action"
                    onClick={() => void downloadImage(image, asset)}
                    aria-label="Download image"
                    title="Download"
                  >
                    <Download size={15} aria-hidden="true" />
                  </button>
                </span>
              </>
            )}
          </>
        )}
      </div>
    </figure>
  );
};

/** Every image the turn made, in order. Renders nothing for a turn that made none. */
export const ChatGeneratedImages: React.FC<ChatGeneratedImagesProps> = ({ images, live, onOpen }) => {
  if (!images.length) return null;
  return (
    <div className="chat-genimages" data-chat-generated-images={images.length}>
      {images.map((image) => (
        <GeneratedImageFrame key={image.step.id} image={image} live={live} onOpen={onOpen} />
      ))}
    </div>
  );
};

export default ChatGeneratedImages;
