// Compatibility boundary for old imports and `/artifacts` routes. The product
// surface is now the account-wide Library; keeping this module avoids breaking
// embeds that imported the original component by filename.
export { default } from './ChatLibraryPage';
export type { ChatLibraryPageProps as ChatArtifactsPageProps } from './ChatLibraryPage';
