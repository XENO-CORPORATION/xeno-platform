import type { ProductContent } from './_types';

/* XENO Storage desktop — sourced from ../xeno-storage at the 0.1.0 release commit: apps/desktop/src/main
 * (account.ts sign-in door, mount.ts drive letters, mountBroker.ts Connect calls), crates/storage-mount
 * (the drive engine, letter_volume.rs) and crates/cloud-vfs-dokan, build/installer.nsh (Dokany), SPEC §10.3.
 *
 * HONESTY CONTRACT for this page:
 *  · Windows x64 only. Unsigned, experimental, NO in-app updater (download the next version from this page).
 *  · A drive letter shows the account's own name and space through Dokany, which the installer offers to
 *    install (one administrator prompt). Declining keeps the drive working with the disk's name and size.
 *  · In that mode every file request passes through the engine: fine for documents and media, much slower
 *    for builds, package installs and games run from the drive (measured 5–40x on small files). Never claim
 *    native speed for the drive letter.
 *  · Google Drive only, through XENO Connect. No OneDrive/Dropbox yet; do not name them as supported.
 *  · Virtual workspaces are in the app but not qualified; this page does not advertise them. */
const storage: ProductContent = {
  slug: 'storage',
  hero: {
    headline: 'Your XENO files and your Google Drive, as drives on this PC.',
    sub: 'XENO Storage puts your XENO Storage and each connected Google Drive account in File Explorer under their own letter. Files appear straight away and download when you open them; the ones you choose stay on this PC. Each drive shows its own account’s name and space.',
    media: { type: 'mockup', src: 'storage-hero', alt: 'File Explorer’s This PC listing BUNKER CAMP - Google Drive (Z:) with 5 TB of space beside the PC’s own disks' },
    badges: ['Windows', 'Experimental', 'Unsigned build', 'XENO account'],
    note: 'Experimental · v0.1.0 · Windows x64 only. No in-app updater yet — download newer versions from this page.',
  },
  trust: [
    'XENO Storage never holds your Google password or tokens: XENO Connect does, and the app gets short-lived access per request',
    'Nothing waiting to upload is ever discarded to make a shutdown look clean',
    'Uninstalling leaves your files where they are',
  ],
  highlights: [
    { value: 'A letter', label: 'Per account, in File Explorer' },
    { value: 'On open', label: 'Files download when you use them' },
    { value: 'Its own size', label: 'Each drive shows its account’s space' },
    { value: 'Windows', label: '10 and 11, x64' },
  ],
  features: [
    {
      eyebrow: 'Drives',
      icon: 'HardDrive',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,200,210,0.14), transparent 60%), linear-gradient(165deg,#15161a,#070707 74%)',
      title: 'Each account is a drive, with its own name and space',
      desc: 'Choose a letter for your XENO Storage and for each Google account you connect. This PC lists it like any disk — “BUNKER CAMP - Google Drive (Z:)”, with that account’s size and free space.',
      bullets: [
        'Files appear at once and download when opened',
        'Keep a folder on this PC, or free up space, from File Explorer',
        'Changes you make upload in the background',
      ],
    },
    {
      eyebrow: 'Connected clouds',
      icon: 'Cloud',
      accent: 'radial-gradient(ellipse at 28% 30%, rgba(200,200,210,0.12), transparent 60%), linear-gradient(165deg,#141417,#070707 74%)',
      title: 'Google Drive, connected once for your XENO account',
      desc: 'Add a Google account in Connected clouds and approve access in your browser. My Drive and your shared drives appear in the app and as a drive letter.',
      bullets: ['Several Google accounts, each its own drive', 'Approval happens in your browser, never in the app'],
    },
  ],
  howItWorks: [
    { step: '1', title: 'Install', desc: 'Run the installer. It may offer to install Dokany so your drives show their own name and size; Windows asks once for administrator rights.' },
    { step: '2', title: 'Sign in', desc: 'Sign in with your XENO account in the browser.' },
    { step: '3', title: 'Add a drive', desc: 'Pick a letter for XENO Storage, or connect a Google account in Connected clouds and mount it.' },
  ],
  specs: [
    { label: 'Platform', value: 'Windows 10/11, x64' },
    { label: 'Installs to', value: 'Your user profile (no administrator rights, except for Dokany)' },
    { label: 'Drive name and size', value: 'Through Dokany 2.3.1, installed by the installer if you accept' },
    { label: 'Updates', value: 'Download the new version from this page (no in-app updater yet)' },
  ],
  faq: [
    { q: 'Why does the installer ask for administrator rights?', a: 'Only to install Dokany, a signed open-source file-system driver that lets a drive show its own account’s name and space. XENO Storage itself installs for your user. If you decline, your drives still work and show the disk’s name and size instead.' },
    { q: 'Is the drive as fast as a local disk?', a: 'For documents, photos and video, yes in practice — opening a file is limited by the download. Programs that touch thousands of small files, such as builds, package installs or games, run noticeably slower from a drive shown with its own name and size. Keep that kind of work on a local disk.' },
    { q: 'OneDrive or Dropbox?', a: 'Not yet. Google Drive is the first connected cloud.' },
    { q: 'macOS or Linux?', a: 'Not yet. This release is Windows x64 only.' },
  ],
  downloadNotice: 'No in-app updater yet: download newer versions from this page.',
  autoUpdates: false,
};

export default storage;
