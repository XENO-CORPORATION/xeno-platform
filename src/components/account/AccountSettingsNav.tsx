import React from 'react';
import { Bell, CreditCard, Plug, Settings, ShieldCheck, User, Users, type LucideIcon } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

interface AccountSection {
  label: string;
  path: string;
  icon: LucideIcon;
  hash?: string;
}

const sections: AccountSection[] = [
  { label: 'Profile', path: '/overview/profile', icon: User },
  { label: 'Preferences', path: '/overview/settings', icon: Settings },
  { label: 'Members', path: '/overview/team', icon: Users },
  { label: 'Teams', path: '/overview/teams', icon: Users },
  { label: 'Security', path: '/overview/settings', icon: ShieldCheck, hash: '#security' },
  { label: 'Integrations', path: '/overview/integrations', icon: Plug },
  { label: 'Billing', path: '/overview/billing', icon: CreditCard },
  { label: 'Notifications', path: '/overview/notifications', icon: Bell },
];

const AccountSettingsNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className="xeno-account-tabs" aria-label="Account settings sections">
      {sections.map(({ label, path, icon: Icon, hash }) => {
        const target = `${path}${hash || ''}`;
        const active = hash
          ? location.pathname === path && location.hash === hash
          : location.pathname === path && !location.hash;
        return (
          <button
            type="button"
            key={label}
            className={active ? 'is-active' : ''}
            aria-label={label}
            title={label}
            aria-current={active ? 'page' : undefined}
            onClick={() => navigate(target)}
          >
            <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default AccountSettingsNav;
