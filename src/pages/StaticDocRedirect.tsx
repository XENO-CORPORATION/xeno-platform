import { useEffect } from 'react';

// Some pages are static documents served by nginx at their own address (the
// Home v21 homepage at `/`, the v2 product designs at `/products` and
// `/product/<slug>`). When the SPA is already loaded and something routes to
// one of them, hand the browser back to nginx so it gets the real document.
export default function StaticDocRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return null;
}
