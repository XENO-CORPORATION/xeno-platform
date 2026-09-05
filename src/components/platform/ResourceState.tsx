import React from 'react';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';

interface Props {
  kind: 'loading' | 'empty' | 'error' | 'unavailable';
  title?: string;
  detail?: string;
  actionLabel?: string;
  onRetry?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  layout?: 'inline' | 'page';
  previewLabel?: string;
}

const ResourcePreview: React.FC<{ label: string }> = ({ label }) => <div className="xeno-resource-preview" aria-hidden="true">
  <div className="xeno-resource-preview-bar"><span /><span /><span /><b>{label}</b></div>
  <div className="xeno-resource-preview-tabs"><i /><i /><i /></div>
  <div className="xeno-resource-preview-head"><span /><span /><span /></div>
  {[82, 66, 91, 74, 57, 86].map((width, index) => <div className="xeno-resource-preview-row" key={width}>
    <i style={{ width: `${width}%` }} /><span /><span className={index % 3 === 0 ? 'is-accent' : ''} />
  </div>)}
</div>;

const ResourceState: React.FC<Props> = ({ kind, title, detail, actionLabel, onRetry, secondaryActionLabel, onSecondaryAction, layout = 'inline', previewLabel = 'XENO / Platform' }) => {
  const Icon = kind === 'loading' ? Loader2 : kind === 'empty' ? Inbox : AlertCircle;
  const fallback = kind === 'loading' ? 'Loading confirmed data' : kind === 'empty' ? 'Nothing here yet' : kind === 'unavailable' ? 'Capability unavailable' : 'Could not load this resource';
  return <div className={`xeno-resource-state is-${kind} is-${layout}`} role={kind === 'error' ? 'alert' : 'status'}>
    <div className="xeno-resource-copy">
      <span className="xeno-resource-icon"><Icon size={20} className={kind === 'loading' ? 'xeno-spin' : ''} /></span>
      <strong>{title || fallback}</strong>
      {detail ? <span>{detail}</span> : null}
      {onRetry || onSecondaryAction ? <div className="xeno-resource-actions">
        {onRetry ? <button type="button" className="is-primary" onClick={onRetry}>{actionLabel || 'Retry'}</button> : null}
        {onSecondaryAction ? <button type="button" onClick={onSecondaryAction}>{secondaryActionLabel || 'Go back'}</button> : null}
      </div> : null}
    </div>
    {layout === 'page' && kind !== 'loading' ? <ResourcePreview label={previewLabel} /> : null}
  </div>;
};
export default ResourceState;
