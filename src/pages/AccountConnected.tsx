import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Check, X as Cross, Clock, AlertTriangle, ShieldAlert } from 'lucide-react';
import AuthMark from '../components/auth/AuthMark';

/* /account/connected — the ONE page every XENO flow lands on after a third party (Google, Meta, LinkedIn, X…) sends the
 * person back (owner, 2026-10-18: "one that is reused properly"). XENO Connect finishes its callback, then answers 303
 * here with the outcome.
 *
 * It only DISPLAYS. Every value it shows comes from a closed vocabulary below: the query string chooses among fixed
 * strings and is never rendered itself, so a crafted link cannot put words on this page. No token, code or id is read,
 * shown or logged. It sits outside the site gate (nginx), because people arrive here straight from the provider.
 *
 *   ?result=completed|scope_not_granted|denied|expired|failed   (anything else → failed)
 *   &provider=google|meta|linkedin|x                             (anything else → "the service")
 *   &service=drive|…                                             (must belong to the provider, else omitted)
 *   &app=storage|post|hub|…                                      (anything else → "XENO")
 */

import { connectedView, type Result } from '../lib/accountConnected';

const ICON: Record<Result, React.ReactNode> = {
  completed: <Check size={18} />, scope_not_granted: <ShieldAlert size={18} />, denied: <Cross size={18} />,
  expired: <Clock size={18} />, failed: <AlertTriangle size={18} />,
};

const AccountConnected: React.FC = () => {
  const { search } = useLocation();
  const v = connectedView(search);
  const ok = v.result === 'completed';
  return (
    <>
      <header className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5 sm:py-4">
        <Link to="/" className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-all duration-300">
          <ArrowLeft size={14} /><span>Back to home</span>
        </Link>
        <AuthMark />
      </header>
      <div className="flex-1 min-h-0 flex flex-col justify-center px-6 pb-6 lg:px-12 xl:px-20 pt-6">
        <div className="w-full max-w-[400px] mx-auto" data-connected-result={v.result} role="status" aria-live="polite">
          <div className={`mb-5 inline-flex h-10 w-10 items-center justify-center rounded-[8px] border ${ok ? 'border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300' : 'border-white/[0.08] bg-white/[0.04] text-white/70'}`}>
            {ICON[v.result]}
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-white">{v.title}</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-white/60">{v.body}</p>
          {ok && <p className="mt-6 text-[12.5px] text-white/35">This tab can be closed.</p>}
        </div>
      </div>
    </>
  );
};

export default AccountConnected;
