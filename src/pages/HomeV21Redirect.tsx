import { useEffect } from 'react';

// The homepage is the static XENOsystem Home v21 document, served by nginx at
// exactly `/` (public/home-v21/). This route only exists for in-app
// navigation: when the SPA is already loaded and something routes to `/`,
// hand the browser back to nginx so it gets the real homepage document.
export default function HomeV21Redirect() {
  useEffect(() => {
    window.location.replace('/');
  }, []);
  return null;
}
