import React from 'react';
import CommsChat from './CommsChat';
import CommsAgentActions from './CommsAgentActions';
import CommsMobile from './CommsMobile';
import AgentCliTerminal from './AgentCliTerminal';
import PixelEditor from './PixelEditor';
import PhotoDevelop from './PhotoDevelop';
import CanvasEditor from './CanvasEditor';
import PostComposer from './PostComposer';
import DocsEditor from './DocsEditor';
import SheetsGrid from './SheetsGrid';
import MotionEditor from './MotionEditor';
import MotionColor from './MotionColor';
import MotionAgent from './MotionAgent';
import XenoHubLauncher from './XenoHubLauncher';
import XenoHubStore from './XenoHubStore';
import BrowserAgentPanel from './BrowserAgentPanel';
import BrowserFileIO from './BrowserFileIO';
import BrowserSpaces from './BrowserSpaces';
import WorkflowGraph from './WorkflowGraph';
import AcpGateway from './AcpGateway';
import SdkEmbed from './SdkEmbed';
import NotesEditor from './NotesEditor';
import UseInspector from './UseInspector';
import UseTape from './UseTape';
import EngineEditor from './EngineEditor';
import RtRuntime from './RtRuntime';
import ArchitectEditor from './ArchitectEditor';
import SoundStudio from './SoundStudio';
import Xeno3DEditor from './Xeno3DEditor';
import AnimaMind from './AnimaMind';
import AnimaSwarm from './AnimaSwarm';
import ShellDesktop from './ShellDesktop';
import ShellMounts from './ShellMounts';
import ShellDisplays from './ShellDisplays';

/* Built-in product mockups — referenced from a content module's Media as
 * { type: 'mockup', src: '<key>' }. Lets a landing page ship a crisp, faithful
 * UI mockup (no heavy screenshot asset) keyed by name. Add a product's mockup
 * here and reference it from src/content/products/<slug>.ts. */
const MOCKUPS: Record<string, React.ComponentType> = {
  'comms-chat': CommsChat,
  'comms-agent-actions': CommsAgentActions,
  'comms-mobile': CommsMobile,
  'agent-cli-terminal': AgentCliTerminal,
  'pixel-hero': PixelEditor,
  'photo-hero': PhotoDevelop,
  'canvas-hero': CanvasEditor,
  'post-hero': PostComposer,
  'docs-hero': DocsEditor,
  'sheets-hero': SheetsGrid,
  'motion-hero': MotionEditor,
  'motion-color': MotionColor,
  'motion-agent': MotionAgent,
  'hub-hero': XenoHubLauncher,
  'hub-store': XenoHubStore,
  'extension-hero': BrowserAgentPanel,
  'browser-hero': BrowserFileIO,
  'browser-spaces': BrowserSpaces,
  'workflow-hero': WorkflowGraph,
  'acp-hero': AcpGateway,
  'sdk-hero': SdkEmbed,
  'notes-hero': NotesEditor,
  'use-hero': UseInspector,
  'use-tape': UseTape,
  'engine-hero': EngineEditor,
  'rt-hero': RtRuntime,
  'architect-hero': ArchitectEditor,
  'sound-hero': SoundStudio,
  '3d-hero': Xeno3DEditor,
  'anima-hero': AnimaMind,
  'anima-swarm': AnimaSwarm,
  'shell-hero': ShellDesktop,
  'shell-mounts': ShellMounts,
  'shell-displays': ShellDisplays,
};

export function Mockup({ name }: { name: string }): React.ReactElement | null {
  const Cmp = MOCKUPS[name];
  return Cmp ? <Cmp /> : null;
}

export function hasMockup(name: string): boolean {
  return name in MOCKUPS;
}
