import React, { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Type,
  Image as ImageIcon,
  Square,
  Circle,
  StickyNote,
  ArrowRight,
  Trash2,
  Copy,
  ZoomIn,
  ZoomOut,
  Move,
  MousePointer,
  Save,
  Download,
  Users,
  Settings,
  Undo,
  Redo,
  Palette,
  Link2,
  FileText,
  CheckSquare,
  MessageCircle,
  Paperclip,
  Code2,
  Quote,
  // Content & Media
  Video,
  Table,
  BarChart3,
  Pencil,
  Network,
  // Interactive & Input
  Vote,
  Timer,
  Calendar,
  ClipboardList,
  MousePointerClick,
  // Organization & Reference
  ExternalLink,
  Bookmark,
  Tag,
  BookOpen,
  GitBranch,
  // Collaboration
  User,
  Users as UsersIcon,
  FileCheck,
  AlertCircle,
  Heart,
  // Smart
  Sparkles,
  Calculator,
  Cloud,
  Clock,
  // Modal & Context Menu
  X,
  MoreVertical,
  Edit3,
  Sliders,
  Search,
  CheckCheck
} from 'lucide-react';

type NodeType =
  // Existing
  | 'sticky' | 'text' | 'shape' | 'image' | 'document' | 'todo' | 'comment' | 'file' | 'code' | 'quote'
  // Content & Media
  | 'video' | 'table' | 'chart' | 'drawing' | 'mermaid'
  // Interactive & Input
  | 'poll' | 'timer' | 'calendar' | 'form' | 'button'
  // Organization & Reference
  | 'link' | 'bookmarks' | 'tags' | 'citation' | 'changelog'
  // Collaboration
  | 'profile' | 'meeting' | 'decision' | 'status' | 'reactions'
  // Smart
  | 'ai' | 'calc' | 'weather' | 'clock'
  // Special
  | 'search';

type ShapeType = 'rectangle' | 'circle' | 'triangle';
type ChartType = 'bar' | 'line' | 'pie';
type StatusType = 'todo' | 'in-progress' | 'done' | 'blocked';

interface Block {
  id: string;
  type: 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'bulletList' | 'numberedList' | 'checkbox' | 'quote' | 'code' | 'divider' | 'image' | 'video' | 'file';
  content: string;
  checked?: boolean; // for checkbox items
  url?: string; // for media/files
  formatting?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
    color?: string;
  };
}

interface TodoItem {
  id: string;
  text: string;
  checked: boolean;
}

interface TableCell {
  id: string;
  content: string;
}

interface TableRow {
  id: string;
  cells: TableCell[];
}

interface PollOption {
  id: string;
  text: string;
  votes: number;
}

interface FormField {
  id: string;
  label: string;
  type: 'text' | 'email' | 'number' | 'textarea';
  value: string;
}

interface BookmarkItem {
  id: string;
  title: string;
  url: string;
}

interface ChangelogEntry {
  id: string;
  version: string;
  date: string;
  changes: string;
}

interface Node {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  color?: string;
  shapeType?: ShapeType;
  rotation?: number;
  zIndex?: number;

  // Existing nodes
  todos?: TodoItem[];
  author?: string;
  timestamp?: Date;
  mentions?: string[];
  fileName?: string;
  fileSize?: string;
  fileType?: string;
  fileUrl?: string;

  // Content & Media
  videoUrl?: string;
  tableRows?: TableRow[];
  chartType?: ChartType;
  chartData?: number[];
  chartLabels?: string[];
  drawingPaths?: string[];
  mermaidCode?: string;

  // Interactive & Input
  pollQuestion?: string;
  pollOptions?: PollOption[];
  timerTarget?: Date;
  timerLabel?: string;
  calendarDate?: Date;
  formFields?: FormField[];
  buttonLabel?: string;
  buttonAction?: string;

  // Organization & Reference
  linkUrl?: string;
  linkTitle?: string;
  linkDescription?: string;
  linkPreview?: string;
  bookmarksList?: BookmarkItem[];
  tagsList?: string[];
  citationAuthor?: string;
  citationTitle?: string;
  citationYear?: string;
  citationSource?: string;
  changelogEntries?: ChangelogEntry[];

  // Collaboration
  profileName?: string;
  profileRole?: string;
  profileAvatar?: string;
  profileStatus?: string;
  meetingTitle?: string;
  meetingDate?: Date;
  meetingNotes?: string;
  meetingAttendees?: string[];
  decisionTitle?: string;
  decisionContext?: string;
  decisionDecision?: string;
  decisionConsequences?: string;
  decisionStatus?: string;
  statusLabel?: string;
  statusType?: StatusType;
  reactionsLikes?: number;
  reactionsHearts?: number;
  reactionsThumbsUp?: number;

  // Smart
  aiPrompt?: string;
  aiResponse?: string;
  calcExpression?: string;
  calcResult?: string;
  weatherLocation?: string;
  weatherTemp?: string;
  weatherCondition?: string;
  clockTimezone?: string;
  clockCity?: string;
}

interface Comment {
  id: string;
  userId: string;
  userName: string;
  content: string;
  timestamp: Date;
  resolved?: boolean;
  blockId?: string; // which block this comment is attached to
}

interface Connection {
  id: string;
  from: string;
  to: string;
  color?: string;
}

const COLORS = [
  '#FEF3C7', // Yellow
  '#DBEAFE', // Blue
  '#FCE7F3', // Pink
  '#D1FAE5', // Green
  '#E0E7FF', // Indigo
  '#FED7AA', // Orange
  '#E9D5FF', // Purple
  '#1F2937', // Dark Gray
  '#374151', // Medium Gray
];

const DARK_COLORS = [
  '#3B82F6', // Blue
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#10B981', // Green
  '#F59E0B', // Orange
  '#EF4444', // Red
  '#6366F1', // Indigo
  '#14B8A6', // Teal
];

// Node Registry - Single source of truth for all node types
interface NodeMetadata {
  type: NodeType;
  name: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
  category: 'Basic' | 'Content & Media' | 'Interactive' | 'Organization' | 'Collaboration' | 'Smart';
  keywords: string[]; // For better search
}

const NODE_REGISTRY: NodeMetadata[] = [
  // Basic
  { type: 'sticky', name: 'Sticky Note', icon: StickyNote, color: 'text-yellow-400', category: 'Basic', keywords: ['note', 'sticky', 'post-it', 'memo'] },
  { type: 'text', name: 'Text Box', icon: Type, color: 'text-white/60', category: 'Basic', keywords: ['text', 'paragraph', 'writing'] },
  { type: 'shape', name: 'Shape', icon: Square, color: 'text-white/60', category: 'Basic', keywords: ['shape', 'rectangle', 'circle', 'square'] },
  { type: 'image', name: 'Image', icon: ImageIcon, color: 'text-purple-400', category: 'Basic', keywords: ['image', 'picture', 'photo'] },

  // Content & Media
  { type: 'document', name: 'Document', icon: FileText, color: 'text-blue-400', category: 'Content & Media', keywords: ['document', 'doc', 'file', 'text'] },
  { type: 'video', name: 'Video Embed', icon: Video, color: 'text-red-400', category: 'Content & Media', keywords: ['video', 'youtube', 'embed'] },
  { type: 'table', name: 'Table', icon: Table, color: 'text-green-400', category: 'Content & Media', keywords: ['table', 'grid', 'spreadsheet'] },
  { type: 'chart', name: 'Chart', icon: BarChart3, color: 'text-cyan-400', category: 'Content & Media', keywords: ['chart', 'graph', 'data', 'visualization'] },
  { type: 'drawing', name: 'Drawing', icon: Pencil, color: 'text-orange-400', category: 'Content & Media', keywords: ['drawing', 'sketch', 'canvas'] },
  { type: 'mermaid', name: 'Diagram', icon: Network, color: 'text-pink-400', category: 'Content & Media', keywords: ['diagram', 'flowchart', 'mermaid'] },
  { type: 'code', name: 'Code Block', icon: Code2, color: 'text-green-400', category: 'Content & Media', keywords: ['code', 'programming', 'snippet'] },
  { type: 'quote', name: 'Quote', icon: Quote, color: 'text-blue-400', category: 'Content & Media', keywords: ['quote', 'citation', 'blockquote'] },

  // Interactive
  { type: 'todo', name: 'To-Do List', icon: CheckSquare, color: 'text-blue-400', category: 'Interactive', keywords: ['todo', 'task', 'checklist', 'list'] },
  { type: 'poll', name: 'Poll', icon: Vote, color: 'text-purple-400', category: 'Interactive', keywords: ['poll', 'vote', 'survey'] },
  { type: 'timer', name: 'Countdown', icon: Timer, color: 'text-red-400', category: 'Interactive', keywords: ['timer', 'countdown', 'clock'] },
  { type: 'calendar', name: 'Calendar', icon: Calendar, color: 'text-cyan-400', category: 'Interactive', keywords: ['calendar', 'date', 'schedule'] },
  { type: 'form', name: 'Form', icon: ClipboardList, color: 'text-green-400', category: 'Interactive', keywords: ['form', 'input', 'fields'] },
  { type: 'button', name: 'Button', icon: MousePointerClick, color: 'text-yellow-400', category: 'Interactive', keywords: ['button', 'action', 'click'] },

  // Organization
  { type: 'file', name: 'File Attachment', icon: Paperclip, color: 'text-white/60', category: 'Organization', keywords: ['file', 'attachment', 'upload'] },
  { type: 'link', name: 'Link Preview', icon: ExternalLink, color: 'text-blue-400', category: 'Organization', keywords: ['link', 'url', 'website'] },
  { type: 'bookmarks', name: 'Bookmarks', icon: Bookmark, color: 'text-yellow-400', category: 'Organization', keywords: ['bookmarks', 'favorites', 'links'] },
  { type: 'tags', name: 'Tags', icon: Tag, color: 'text-pink-400', category: 'Organization', keywords: ['tags', 'labels', 'categories'] },
  { type: 'citation', name: 'Citation', icon: BookOpen, color: 'text-purple-400', category: 'Organization', keywords: ['citation', 'reference', 'source'] },
  { type: 'changelog', name: 'Changelog', icon: GitBranch, color: 'text-green-400', category: 'Organization', keywords: ['changelog', 'history', 'updates'] },

  // Collaboration
  { type: 'comment', name: 'Comment', icon: MessageCircle, color: 'text-blue-400', category: 'Collaboration', keywords: ['comment', 'feedback', 'discussion'] },
  { type: 'profile', name: 'Profile Card', icon: User, color: 'text-cyan-400', category: 'Collaboration', keywords: ['profile', 'user', 'person'] },
  { type: 'meeting', name: 'Meeting Notes', icon: UsersIcon, color: 'text-purple-400', category: 'Collaboration', keywords: ['meeting', 'notes', 'agenda'] },
  { type: 'decision', name: 'Decision Record', icon: FileCheck, color: 'text-green-400', category: 'Collaboration', keywords: ['decision', 'choice', 'record'] },
  { type: 'status', name: 'Status Badge', icon: AlertCircle, color: 'text-yellow-400', category: 'Collaboration', keywords: ['status', 'badge', 'state'] },
  { type: 'reactions', name: 'Reactions', icon: Heart, color: 'text-pink-400', category: 'Collaboration', keywords: ['reactions', 'emoji', 'feedback'] },

  // Smart
  { type: 'ai', name: 'AI Assistant', icon: Sparkles, color: 'text-purple-400', category: 'Smart', keywords: ['ai', 'assistant', 'gpt', 'chat'] },
  { type: 'calc', name: 'Calculator', icon: Calculator, color: 'text-blue-400', category: 'Smart', keywords: ['calculator', 'math', 'compute'] },
  { type: 'weather', name: 'Weather', icon: Cloud, color: 'text-cyan-400', category: 'Smart', keywords: ['weather', 'forecast', 'temperature'] },
  { type: 'clock', name: 'World Clock', icon: Clock, color: 'text-orange-400', category: 'Smart', keywords: ['clock', 'time', 'world', 'timezone'] },
];

const CanvasPlanningVisual: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<Node[]>([
    {
      id: '1',
      type: 'sticky',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      content: 'Double-click to edit',
      color: '#FEF3C7',
      zIndex: 1
    },
    {
      id: '2',
      type: 'text',
      x: 400,
      y: 100,
      width: 250,
      height: 150,
      content: 'Dark themed text box',
      color: '#1a1a1a',
      zIndex: 1
    },
    {
      id: '3',
      type: 'document',
      x: 100,
      y: 350,
      width: 300,
      height: 250,
      content: 'Start planning your project here...',
      color: '#0a0a0a',
      zIndex: 1
    }
  ]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [showNodeMenu, setShowNodeMenu] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [searchNodeQuery, setSearchNodeQuery] = useState<{ nodeId: string; query: string } | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsNodeId, setSettingsNodeId] = useState<string | null>(null);
  const [originalNodeState, setOriginalNodeState] = useState<any>(null);
  const [outsideClickCount, setOutsideClickCount] = useState(0);
  const outsideClickTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Add new node with comprehensive defaults
  const addNode = (type: NodeType, color?: string) => {
    const baseNode = {
      id: Date.now().toString(),
      type,
      x: (window.innerWidth / 2 - panOffset.x) / zoom - 150,
      y: (window.innerHeight / 2 - panOffset.y) / zoom - 100,
      zIndex: Math.max(...nodes.map(n => n.zIndex || 1), 0) + 1,
    };

    // Default sizing by node type
    const sizeMap: Record<string, { width: number; height: number }> = {
      sticky: { width: 200, height: 200 },
      text: { width: 300, height: 200 },
      shape: { width: 150, height: 150 },
      file: { width: 280, height: 120 },
      todo: { width: 300, height: 250 },
      video: { width: 400, height: 250 },
      table: { width: 400, height: 300 },
      chart: { width: 350, height: 300 },
      drawing: { width: 400, height: 300 },
      poll: { width: 320, height: 280 },
      timer: { width: 250, height: 150 },
      calendar: { width: 300, height: 280 },
      form: { width: 350, height: 400 },
      link: { width: 350, height: 140 },
      bookmarks: { width: 320, height: 300 },
      tags: { width: 300, height: 180 },
      citation: { width: 350, height: 180 },
      changelog: { width: 380, height: 350 },
      profile: { width: 280, height: 200 },
      meeting: { width: 380, height: 320 },
      decision: { width: 400, height: 400 },
      status: { width: 200, height: 80 },
      reactions: { width: 280, height: 120 },
      ai: { width: 400, height: 350 },
      calc: { width: 280, height: 180 },
      weather: { width: 280, height: 200 },
      clock: { width: 250, height: 150 },
      search: { width: 400, height: 400 },
    };

    const { width, height } = sizeMap[type] || { width: 300, height: 200 };

    const newNode: Node = {
      ...baseNode,
      width,
      height,
      content: '',
      color: color || (type === 'sticky' ? COLORS[Math.floor(Math.random() * COLORS.length)] : '#0a0a0a'),
    };

    // Type-specific initialization
    switch (type) {
      case 'sticky':
        newNode.content = 'New note';
        break;
      case 'text':
        newNode.content = 'Text box';
        break;
      case 'shape':
        newNode.shapeType = 'rectangle';
        break;
      case 'todo':
        newNode.todos = [
          { id: '1', text: 'First task', checked: false },
          { id: '2', text: 'Second task', checked: false },
          { id: '3', text: 'Third task', checked: false }
        ];
        break;
      case 'comment':
        newNode.content = 'Add a comment...';
        newNode.author = 'User';
        newNode.timestamp = new Date();
        newNode.mentions = [];
        break;
      case 'file':
        newNode.fileName = 'document.pdf';
        newNode.fileSize = '2.4 MB';
        newNode.fileType = 'PDF';
        newNode.fileUrl = '#';
        break;
      case 'code':
        newNode.content = '// Write your code here';
        break;
      case 'quote':
        newNode.content = 'Inspirational quote';
        break;
      case 'video':
        newNode.videoUrl = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
        break;
      case 'table':
        newNode.tableRows = [
          { id: '1', cells: [{ id: '1-1', content: 'Header 1' }, { id: '1-2', content: 'Header 2' }, { id: '1-3', content: 'Header 3' }] },
          { id: '2', cells: [{ id: '2-1', content: 'Row 1' }, { id: '2-2', content: 'Data' }, { id: '2-3', content: 'Data' }] },
          { id: '3', cells: [{ id: '3-1', content: 'Row 2' }, { id: '3-2', content: 'Data' }, { id: '3-3', content: 'Data' }] }
        ];
        break;
      case 'chart':
        newNode.chartType = 'bar';
        newNode.chartData = [30, 50, 40, 60, 45];
        newNode.chartLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May'];
        break;
      case 'drawing':
        newNode.drawingPaths = [];
        break;
      case 'mermaid':
        newNode.mermaidCode = 'graph TD\n  A[Start] --> B[Process]\n  B --> C[End]';
        break;
      case 'poll':
        newNode.pollQuestion = 'What do you think?';
        newNode.pollOptions = [
          { id: '1', text: 'Option A', votes: 0 },
          { id: '2', text: 'Option B', votes: 0 },
          { id: '3', text: 'Option C', votes: 0 }
        ];
        break;
      case 'timer':
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        newNode.timerTarget = tomorrow;
        newNode.timerLabel = 'Event Countdown';
        break;
      case 'calendar':
        newNode.calendarDate = new Date();
        break;
      case 'form':
        newNode.formFields = [
          { id: '1', label: 'Name', type: 'text', value: '' },
          { id: '2', label: 'Email', type: 'email', value: '' },
          { id: '3', label: 'Message', type: 'textarea', value: '' }
        ];
        break;
      case 'button':
        newNode.buttonLabel = 'Click Me';
        newNode.buttonAction = 'alert';
        break;
      case 'link':
        newNode.linkUrl = 'https://example.com';
        newNode.linkTitle = 'Example Website';
        newNode.linkDescription = 'A great resource for information';
        break;
      case 'bookmarks':
        newNode.bookmarksList = [
          { id: '1', title: 'Documentation', url: 'https://docs.example.com' },
          { id: '2', title: 'GitHub', url: 'https://github.com' },
          { id: '3', title: 'Stack Overflow', url: 'https://stackoverflow.com' }
        ];
        break;
      case 'tags':
        newNode.tagsList = ['Design', 'Development', 'Research'];
        break;
      case 'citation':
        newNode.citationAuthor = 'Author Name';
        newNode.citationTitle = 'Paper Title';
        newNode.citationYear = '2025';
        newNode.citationSource = 'Journal Name';
        break;
      case 'changelog':
        newNode.changelogEntries = [
          { id: '1', version: 'v1.2.0', date: '2025-01-15', changes: 'Added new features' },
          { id: '2', version: 'v1.1.0', date: '2025-01-10', changes: 'Bug fixes and improvements' }
        ];
        break;
      case 'profile':
        newNode.profileName = 'User Name';
        newNode.profileRole = 'Product Designer';
        newNode.profileStatus = 'online';
        break;
      case 'meeting':
        newNode.meetingTitle = 'Team Sync';
        newNode.meetingDate = new Date();
        newNode.meetingNotes = 'Discussion points...';
        newNode.meetingAttendees = ['Alice', 'Bob', 'Charlie'];
        break;
      case 'decision':
        newNode.decisionTitle = 'Technical Decision';
        newNode.decisionContext = 'Why this decision was needed';
        newNode.decisionDecision = 'What we decided to do';
        newNode.decisionConsequences = 'Expected outcomes';
        newNode.decisionStatus = 'Proposed';
        break;
      case 'status':
        newNode.statusLabel = 'In Progress';
        newNode.statusType = 'in-progress';
        break;
      case 'reactions':
        newNode.reactionsLikes = 0;
        newNode.reactionsHearts = 0;
        newNode.reactionsThumbsUp = 0;
        break;
      case 'ai':
        newNode.aiPrompt = 'Ask AI anything...';
        newNode.aiResponse = '';
        break;
      case 'calc':
        newNode.calcExpression = '2 + 2';
        newNode.calcResult = '4';
        break;
      case 'weather':
        newNode.weatherLocation = 'San Francisco';
        newNode.weatherTemp = '72°F';
        newNode.weatherCondition = 'Sunny';
        break;
      case 'clock':
        newNode.clockTimezone = 'PST';
        newNode.clockCity = 'San Francisco';
        break;
    }

    setNodes([...nodes, newNode]);
    setShowNodeMenu(false);
  };

  // Handle node drag start
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    if (tool !== 'select') return;

    e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    setDraggingNodeId(nodeId);
    setSelectedNodeId(nodeId);
    setDragOffset({
      x: e.clientX / zoom - node.x,
      y: e.clientY / zoom - node.y
    });

    // Bring to front
    const maxZ = Math.max(...nodes.map(n => n.zIndex || 1));
    setNodes(nodes.map(n =>
      n.id === nodeId ? { ...n, zIndex: maxZ + 1 } : n
    ));
  };

  // Handle canvas panning
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (tool === 'pan' || e.button === 1 || isSpacePressed) { // Middle mouse button or space + click
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    } else {
      // Clicking on canvas background deselects nodes
      setSelectedNodeId(null);
      setShowColorPicker(false);
    }
  };

  // Handle mouse move
  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggingNodeId) {
      const node = nodes.find(n => n.id === draggingNodeId);
      if (node) {
        setNodes(nodes.map(n =>
          n.id === draggingNodeId
            ? {
                ...n,
                x: e.clientX / zoom - dragOffset.x,
                y: e.clientY / zoom - dragOffset.y
              }
            : n
        ));
      }
    } else if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };

  // Handle mouse up
  const handleMouseUp = () => {
    setDraggingNodeId(null);
    setIsPanning(false);
  };

  // Handle double click to edit
  const handleNodeDoubleClick = (nodeId: string) => {
    setEditingNodeId(nodeId);
  };

  // Update node content
  const updateNodeContent = (nodeId: string, content: string) => {
    setNodes(nodes.map(n =>
      n.id === nodeId ? { ...n, content } : n
    ));
  };

  // Update node color
  const updateNodeColor = (nodeId: string, color: string) => {
    setNodes(nodes.map(n =>
      n.id === nodeId ? { ...n, color } : n
    ));
    setShowColorPicker(false);
  };

  // Update node size and position
  const updateNodeSize = (nodeId: string, width: number, height: number, x?: number, y?: number) => {
    setNodes(nodes.map(n =>
      n.id === nodeId ? { ...n, width, height, ...(x !== undefined && { x }), ...(y !== undefined && { y }) } : n
    ));
  };

  // Delete node
  const deleteNode = (nodeId: string) => {
    setNodes(nodes.filter(n => n.id !== nodeId));
    setSelectedNodeId(null);
  };

  // Duplicate node
  const duplicateNode = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      const newNode = {
        ...node,
        id: Date.now().toString(),
        x: node.x + 20,
        y: node.y + 20,
        zIndex: Math.max(...nodes.map(n => n.zIndex || 1)) + 1
      };
      setNodes([...nodes, newNode]);
    }
  };

  // Zoom controls (zoom towards center of viewport)
  const handleZoomIn = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const delta = 1.2;
    const newZoom = Math.min(zoom * delta, 3);

    // Calculate the point under the center before zoom
    const pointX = (centerX - panOffset.x) / zoom;
    const pointY = (centerY - panOffset.y) / zoom;

    // Calculate new pan offset to keep the point under the center
    const newPanOffsetX = centerX - pointX * newZoom;
    const newPanOffsetY = centerY - pointY * newZoom;

    setZoom(newZoom);
    setPanOffset({ x: newPanOffsetX, y: newPanOffsetY });
  };

  const handleZoomOut = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const delta = 0.8;
    const newZoom = Math.max(zoom * delta, 0.3);

    // Calculate the point under the center before zoom
    const pointX = (centerX - panOffset.x) / zoom;
    const pointY = (centerY - panOffset.y) / zoom;

    // Calculate new pan offset to keep the point under the center
    const newPanOffsetX = centerX - pointX * newZoom;
    const newPanOffsetY = centerY - pointY * newZoom;

    setZoom(newZoom);
    setPanOffset({ x: newPanOffsetX, y: newPanOffsetY });
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  };

  // Mouse wheel zoom (cursor-centric)
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();

        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.min(Math.max(zoom * delta, 0.3), 3);

        // Calculate the point under the cursor in canvas space before zoom
        const pointX = (mouseX - panOffset.x) / zoom;
        const pointY = (mouseY - panOffset.y) / zoom;

        // Calculate new pan offset to keep the point under the cursor
        const newPanOffsetX = mouseX - pointX * newZoom;
        const newPanOffsetY = mouseY - pointY * newZoom;

        setZoom(newZoom);
        setPanOffset({ x: newPanOffsetX, y: newPanOffsetY });
      }
    };

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', handleWheel);
    }
  }, [zoom, panOffset]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space for temporary pan mode (don't trigger when editing)
      if (e.key === ' ' && !editingNodeId) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
      // V for select tool
      else if (e.key === 'v' || e.key === 'V') {
        setTool('select');
      }
      // H for pan tool
      else if (e.key === 'h' || e.key === 'H') {
        setTool('pan');
      }
      // Ctrl/Cmd + = for zoom in
      else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        handleZoomIn();
      }
      // Ctrl/Cmd + - for zoom out
      else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        handleZoomOut();
      }
      // Ctrl/Cmd + 0 for reset zoom
      else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        handleResetZoom();
      }
      // Delete key to delete selected node
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId && !editingNodeId) {
        e.preventDefault();
        deleteNode(selectedNodeId);
      }
      // Escape to deselect
      else if (e.key === 'Escape') {
        setSelectedNodeId(null);
        setEditingNodeId(null);
        setShowBlockMenu(false);
        setShowColorPicker(false);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Release space key
      if (e.key === ' ') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedNodeId, editingNodeId]);

  // Handle context menu (right-click)
  const handleNodeContextMenu = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId });
  };

  // Open settings modal
  const openSettings = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      // Store original node state for potential revert
      setOriginalNodeState({ ...node });
    }
    setSettingsNodeId(nodeId);
    setShowSettingsModal(true);
    setContextMenu(null);
    setOutsideClickCount(0);
  };

  // Close context menu when clicking elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  // Helper function to render resize handles
  const renderResizeHandles = (node: Node) => (
    <div className="resize-area-container absolute z-5" style={{ inset: '-5px' }}>
      {/* Top-left corner */}
      <div
        className="absolute w-3 h-3 bg-transparent hover:bg-blue-500/30 cursor-nwse-resize transition-colors rounded-tl-lg"
        style={{ top: 0, left: 0, width: '10px', height: '10px' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const startWidth = node.width;
          const startHeight = node.height;
          const startNodeX = node.x;
          const startNodeY = node.y;

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const deltaY = moveEvent.clientY - startY;

            const newWidth = Math.max(100, startWidth - deltaX);
            const newHeight = Math.max(80, startHeight - deltaY);
            const newX = startNodeX + (startWidth - newWidth);
            const newY = startNodeY + (startHeight - newHeight);

            updateNodeSize(node.id, newWidth, newHeight, newX, newY);
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />

      {/* Top edge */}
      <div
        className="absolute bg-transparent hover:bg-blue-500/30 cursor-ns-resize transition-colors"
        style={{ top: 0, left: '10px', right: '10px', height: '10px' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          const startY = e.clientY;
          const startHeight = node.height;
          const startNodeY = node.y;

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaY = moveEvent.clientY - startY;

            const newHeight = Math.max(80, startHeight - deltaY);
            const newY = startNodeY + (startHeight - newHeight);

            updateNodeSize(node.id, node.width, newHeight, undefined, newY);
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />

      {/* Top-right corner */}
      <div
        className="absolute w-3 h-3 bg-transparent hover:bg-blue-500/30 cursor-nesw-resize transition-colors rounded-tr-lg"
        style={{ top: 0, right: 0, width: '10px', height: '10px' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const startWidth = node.width;
          const startHeight = node.height;
          const startNodeY = node.y;

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const deltaY = moveEvent.clientY - startY;

            const newWidth = Math.max(100, startWidth + deltaX);
            const newHeight = Math.max(80, startHeight - deltaY);
            const newY = startNodeY + (startHeight - newHeight);

            updateNodeSize(node.id, newWidth, newHeight, undefined, newY);
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />

      {/* Left edge */}
      <div
        className="absolute bg-transparent hover:bg-blue-500/30 cursor-ew-resize transition-colors"
        style={{ top: '10px', bottom: '10px', left: 0, width: '10px' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startWidth = node.width;
          const startNodeX = node.x;

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;

            const newWidth = Math.max(100, startWidth - deltaX);
            const newX = startNodeX + (startWidth - newWidth);

            updateNodeSize(node.id, newWidth, node.height, newX, undefined);
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />

      {/* Right edge */}
      <div
        className="absolute bg-transparent hover:bg-blue-500/30 cursor-ew-resize transition-colors"
        style={{ top: '10px', bottom: '10px', right: 0, width: '10px' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startWidth = node.width;

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;

            const newWidth = Math.max(100, startWidth + deltaX);

            updateNodeSize(node.id, newWidth, node.height);
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />

      {/* Bottom-left corner */}
      <div
        className="absolute w-3 h-3 bg-transparent hover:bg-blue-500/30 cursor-nesw-resize transition-colors rounded-bl-lg"
        style={{ bottom: 0, left: 0, width: '10px', height: '10px' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const startWidth = node.width;
          const startHeight = node.height;
          const startNodeX = node.x;

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const deltaY = moveEvent.clientY - startY;

            const newWidth = Math.max(100, startWidth - deltaX);
            const newHeight = Math.max(80, startHeight + deltaY);
            const newX = startNodeX + (startWidth - newWidth);

            updateNodeSize(node.id, newWidth, newHeight, newX, undefined);
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />

      {/* Bottom edge */}
      <div
        className="absolute bg-transparent hover:bg-blue-500/30 cursor-ns-resize transition-colors"
        style={{ bottom: 0, left: '10px', right: '10px', height: '10px' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          const startY = e.clientY;
          const startHeight = node.height;

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaY = moveEvent.clientY - startY;

            const newHeight = Math.max(80, startHeight + deltaY);

            updateNodeSize(node.id, node.width, newHeight);
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />

      {/* Bottom-right corner */}
      <div
        className="absolute w-3 h-3 bg-transparent hover:bg-blue-500/30 cursor-nwse-resize transition-colors rounded-br-lg"
        style={{ bottom: 0, right: 0, width: '10px', height: '10px' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const startWidth = node.width;
          const startHeight = node.height;

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const deltaY = moveEvent.clientY - startY;

            const newWidth = Math.max(100, startWidth + deltaX);
            const newHeight = Math.max(80, startHeight + deltaY);

            updateNodeSize(node.id, newWidth, newHeight);
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />
    </div>
  );

  // Helper function to render settings panel
  const renderSettingsPanel = (node: Node) => showSettingsModal && settingsNodeId === node.id && (
    <div
      className="absolute bg-black/95 backdrop-blur-md border-2 border-blue-500/50 rounded-lg shadow-2xl z-0"
      style={{
        top: '-50px',
        left: '-10px',
        right: '-10px',
        bottom: '-10px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
    </div>
  );

  // Render node based on type
  const renderNode = (node: Node) => {
    const isSelected = selectedNodeId === node.id;
    const isEditing = editingNodeId === node.id;

    return (
      <div
        key={node.id}
        className={`absolute cursor-move select-none rounded-lg ${isSelected ? 'ring-2 ring-white/40' : ''}`}
        style={{
          left: node.x,
          top: node.y,
          width: node.width,
          height: node.height,
          transform: `rotate(${node.rotation || 0}deg)`,
          zIndex: node.zIndex || 1
        }}
        onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
        onDoubleClick={() => handleNodeDoubleClick(node.id)}
        onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
      >
        {node.type === 'sticky' && (
          <div className="relative w-full h-full">
            {renderSettingsPanel(node)}
            {renderResizeHandles(node)}

            {/* The actual sticky note - always visible in center */}
            <div
              className="w-full h-full p-4 rounded-lg shadow-2xl backdrop-blur-sm border border-white/10 relative z-10 cursor-grab active:cursor-grabbing"
              style={{
                backgroundColor: node.color,
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)'
              }}
            >
              {isEditing ? (
                <textarea
                  autoFocus
                  value={node.content}
                  onChange={(e) => updateNodeContent(node.id, e.target.value)}
                  onBlur={() => setEditingNodeId(null)}
                  className="w-full h-full bg-transparent resize-none focus:outline-none text-gray-900 font-medium"
                  placeholder="Type your note..."
                />
              ) : (
                <div className="w-full h-full text-gray-900 font-medium break-words overflow-hidden">
                  {node.content}
                </div>
              )}
            </div>
          </div>
        )}

        {node.type === 'text' && (
          <div className="relative w-full h-full">
            {renderSettingsPanel(node)}
            {renderResizeHandles(node)}

            <div
              className="w-full h-full p-4 rounded-lg border border-white/20 bg-[#1a1a1a] shadow-2xl backdrop-blur-md relative z-10 cursor-grab active:cursor-grabbing"
              style={{
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)'
              }}
            >
            {isEditing ? (
              <textarea
                autoFocus
                value={node.content}
                onChange={(e) => updateNodeContent(node.id, e.target.value)}
                onBlur={() => setEditingNodeId(null)}
                className="w-full h-full bg-transparent resize-none focus:outline-none text-white/90"
                placeholder="Type your text..."
              />
            ) : (
              <div className="w-full h-full text-white/90 break-words overflow-hidden">
                {node.content}
              </div>
            )}
            </div>
          </div>
        )}

        {node.type === 'shape' && (
          <div className="relative w-full h-full">
            {renderSettingsPanel(node)}
            {renderResizeHandles(node)}

            <div
              className="w-full h-full flex items-center justify-center shadow-2xl relative z-10 cursor-grab active:cursor-grabbing"
              style={{
                backgroundColor: node.color,
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)'
              }}
            >
              {node.shapeType === 'rectangle' && (
                <div className="w-full h-full rounded-lg border border-white/10" />
              )}
              {node.shapeType === 'circle' && (
                <div className="w-full h-full rounded-full border border-white/10" />
              )}
            </div>
          </div>
        )}

        {node.type === 'document' && (
          <div className="relative w-full h-full">
            {renderSettingsPanel(node)}
            {renderResizeHandles(node)}

            <div
              className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md relative z-10 cursor-grab active:cursor-grabbing"
              style={{
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)'
              }}
            >
            <div className="flex items-center gap-2 mb-2 border-b border-white/10 pb-2">
              <FileText size={16} className="text-blue-400" />
              <span className="text-sm font-medium text-white/80">Document</span>
            </div>
            {isEditing ? (
              <textarea
                autoFocus
                value={node.content}
                onChange={(e) => updateNodeContent(node.id, e.target.value)}
                onBlur={() => setEditingNodeId(null)}
                className="w-full h-[calc(100%-40px)] bg-transparent resize-none focus:outline-none text-white/90 text-sm"
                placeholder="Write your document..."
              />
            ) : (
              <div className="w-full h-[calc(100%-40px)] text-white/90 text-sm break-words overflow-auto">
                {node.content || 'Empty document'}
              </div>
            )}
            </div>
          </div>
        )}

        {/* To-Do List Node */}
        {node.type === 'todo' && (
          <div className="relative w-full h-full">
            {renderSettingsPanel(node)}
            {renderResizeHandles(node)}

            <div
              className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md relative z-10 cursor-grab active:cursor-grabbing"
              style={{
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)'
              }}
            >
            <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
              <CheckSquare size={16} className="text-blue-400" />
              <span className="text-sm font-medium text-white/80">To-Do List</span>
            </div>
            <div className="space-y-2">
              {node.todos && node.todos.map((todo, index) => (
                <div key={todo.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={todo.checked}
                    onChange={(e) => {
                      const newTodos = [...(node.todos || [])];
                      newTodos[index] = { ...todo, checked: e.target.checked };
                      setNodes(nodes.map(n =>
                        n.id === node.id ? { ...n, todos: newTodos } : n
                      ));
                    }}
                    className="mt-1 accent-blue-500"
                  />
                  <input
                    type="text"
                    value={todo.text}
                    onChange={(e) => {
                      const newTodos = [...(node.todos || [])];
                      newTodos[index] = { ...todo, text: e.target.value };
                      setNodes(nodes.map(n =>
                        n.id === node.id ? { ...n, todos: newTodos } : n
                      ));
                    }}
                    className={`flex-1 bg-transparent focus:outline-none text-sm ${
                      todo.checked ? 'line-through text-white/40' : 'text-white/90'
                    }`}
                    placeholder="Task"
                  />
                </div>
              ))}
              <button
                onClick={() => {
                  const newTodo: TodoItem = {
                    id: Date.now().toString(),
                    text: 'New task',
                    checked: false
                  };
                  setNodes(nodes.map(n =>
                    n.id === node.id ? { ...n, todos: [...(n.todos || []), newTodo] } : n
                  ));
                }}
                className="flex items-center gap-1 text-white/40 hover:text-white/60 text-xs py-1 px-1 hover:bg-white/5 rounded transition-colors"
              >
                <Plus size={12} />
                <span>Add task</span>
              </button>
            </div>
            </div>
          </div>
        )}

        {/* Comment Node */}
        {node.type === 'comment' && (
          <div className="relative w-full h-full">
            {renderSettingsPanel(node)}
            {renderResizeHandles(node)}

            <div
              className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md relative z-10 cursor-grab active:cursor-grabbing"
              style={{
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)'
              }}
            >
            <div className="flex items-center gap-2 mb-2">
              <MessageCircle size={14} className="text-blue-400" />
              <span className="text-xs font-medium text-white/60">{node.author}</span>
              <span className="text-xs text-white/40">
                {node.timestamp?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            {isEditing ? (
              <textarea
                autoFocus
                value={node.content}
                onChange={(e) => updateNodeContent(node.id, e.target.value)}
                onBlur={() => setEditingNodeId(null)}
                className="w-full h-[calc(100%-40px)] bg-transparent resize-none focus:outline-none text-white/90 text-sm"
                placeholder="Add a comment..."
              />
            ) : (
              <div className="w-full h-[calc(100%-40px)] text-white/90 text-sm break-words overflow-auto">
                {node.content || 'Click to add comment...'}
              </div>
            )}
            </div>
          </div>
        )}

        {/* File Attachment Node */}
        {node.type === 'file' && (
          <div className="relative w-full h-full">
            {renderSettingsPanel(node)}
            {renderResizeHandles(node)}

            <div
              className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md flex flex-col justify-between relative z-10 cursor-grab active:cursor-grabbing"
              style={{
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)'
              }}
            >
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-500/10 rounded-lg">
                <Paperclip size={24} className="text-blue-400" />
              </div>
              <div className="flex-1 overflow-hidden">
                <div className="text-sm font-medium text-white/90 truncate">{node.fileName}</div>
                <div className="text-xs text-white/60">{node.fileType} • {node.fileSize}</div>
              </div>
            </div>
            <button className="mt-3 w-full py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded text-sm transition-colors">
              Download
            </button>
            </div>
          </div>
        )}

        {/* Code Block Node */}
        {node.type === 'code' && (
          <div className="relative w-full h-full">
            {renderSettingsPanel(node)}
            {renderResizeHandles(node)}

            <div
              className="w-full h-full rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md overflow-hidden relative z-10 cursor-grab active:cursor-grabbing"
              style={{
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)'
              }}
            >
            <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] border-b border-white/10">
              <Code2 size={14} className="text-green-400" />
              <span className="text-xs font-medium text-white/60">Code Block</span>
            </div>
            {isEditing ? (
              <textarea
                autoFocus
                value={node.content}
                onChange={(e) => updateNodeContent(node.id, e.target.value)}
                onBlur={() => setEditingNodeId(null)}
                className="w-full h-[calc(100%-40px)] bg-[#1a1a1a] p-4 resize-none focus:outline-none text-green-400 text-sm font-mono"
                placeholder="// Enter code..."
              />
            ) : (
              <pre className="w-full h-[calc(100%-40px)] bg-[#1a1a1a] p-4 overflow-auto">
                <code className="text-sm text-green-400 font-mono">{node.content}</code>
              </pre>
            )}
            </div>
          </div>
        )}

        {/* Quote Node */}
        {node.type === 'quote' && (
          <div className="relative w-full h-full">
            {renderSettingsPanel(node)}
            {renderResizeHandles(node)}

            <div
              className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border-l-4 border-blue-500 backdrop-blur-md relative z-10 cursor-grab active:cursor-grabbing"
              style={{
                boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)',
              backgroundColor: 'rgba(59, 130, 246, 0.05)'
            }}
          >
            <Quote size={20} className="text-blue-400 mb-2 opacity-50" />
            {isEditing ? (
              <textarea
                autoFocus
                value={node.content}
                onChange={(e) => updateNodeContent(node.id, e.target.value)}
                onBlur={() => setEditingNodeId(null)}
                className="w-full h-[calc(100%-40px)] bg-transparent resize-none focus:outline-none text-white/90 text-lg italic"
                placeholder="Enter quote..."
              />
            ) : (
              <div className="w-full h-[calc(100%-40px)] text-white/90 text-lg italic break-words overflow-auto">
                "{node.content}"
              </div>
            )}
            </div>
          </div>
        )}

        {/* Video Embed Node */}
        {node.type === 'video' && (
          <div className="relative w-full h-full">
            {renderSettingsPanel(node)}
            {renderResizeHandles(node)}

            <div className="w-full h-full rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md overflow-hidden relative z-10 cursor-grab active:cursor-grabbing" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] border-b border-white/10">
              <Video size={14} className="text-red-400" />
              <span className="text-xs font-medium text-white/60">Video</span>
            </div>
            {node.videoUrl ? (
              <iframe src={node.videoUrl} className="w-full h-[calc(100%-40px)]" frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            ) : (
              <div className="w-full h-[calc(100%-40px)] flex items-center justify-center text-white/40 text-sm">No video URL</div>
            )}
            </div>
          </div>
        )}

        {/* Table Node */}
        {node.type === 'table' && (
          <div className="relative w-full h-full">
            {renderSettingsPanel(node)}
            {renderResizeHandles(node)}

            <div className="w-full h-full rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md overflow-hidden relative z-10 cursor-grab active:cursor-grabbing" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] border-b border-white/10">
              <Table size={14} className="text-green-400" />
              <span className="text-xs font-medium text-white/60">Table</span>
            </div>
            <div className="w-full h-[calc(100%-40px)] overflow-auto p-2">
              <table className="w-full border-collapse">
                <tbody>
                  {node.tableRows && node.tableRows.map((row, rowIdx) => (
                    <tr key={row.id} className={rowIdx === 0 ? 'bg-white/5' : ''}>
                      {row.cells.map((cell) => (
                        <td key={cell.id} className="border border-white/10 p-2">
                          <input type="text" value={cell.content} onChange={(e) => {
                            const newRows = [...(node.tableRows || [])];
                            const cellIdx = row.cells.findIndex(c => c.id === cell.id);
                            newRows[rowIdx].cells[cellIdx].content = e.target.value;
                            setNodes(nodes.map(n => n.id === node.id ? { ...n, tableRows: newRows } : n));
                          }} className="w-full bg-transparent text-white/90 text-sm focus:outline-none" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          </div>
        )}

        {/* Chart Node */}
        {node.type === 'chart' && (
          <div className="w-full h-full rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md overflow-hidden" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] border-b border-white/10">
              <BarChart3 size={14} className="text-cyan-400" />
              <span className="text-xs font-medium text-white/60">Chart - {node.chartType}</span>
            </div>
            <div className="w-full h-[calc(100%-40px)] p-6 flex items-end justify-around gap-2">
              {node.chartData && node.chartData.map((value, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-gradient-to-t from-blue-500 to-cyan-400 rounded-t" style={{ height: `${(value / Math.max(...node.chartData!)) * 100}%` }}></div>
                  <span className="text-xs text-white/60">{node.chartLabels?.[idx] || idx}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Drawing Node */}
        {node.type === 'drawing' && (
          <div className="w-full h-full rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md overflow-hidden" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] border-b border-white/10">
              <Pencil size={14} className="text-orange-400" />
              <span className="text-xs font-medium text-white/60">Drawing Canvas</span>
            </div>
            <div className="w-full h-[calc(100%-40px)] flex items-center justify-center bg-white/5">
              <div className="text-white/40 text-sm">Drawing canvas (interactive canvas coming soon)</div>
            </div>
          </div>
        )}

        {/* Mermaid Diagram Node */}
        {node.type === 'mermaid' && (
          <div className="w-full h-full rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md overflow-hidden" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] border-b border-white/10">
              <Network size={14} className="text-pink-400" />
              <span className="text-xs font-medium text-white/60">Diagram</span>
            </div>
            <div className="w-full h-[calc(100%-40px)] p-4">
              {isEditing ? (
                <textarea autoFocus value={node.mermaidCode} onChange={(e) => setNodes(nodes.map(n => n.id === node.id ? { ...n, mermaidCode: e.target.value } : n))} onBlur={() => setEditingNodeId(null)} className="w-full h-full bg-[#1a1a1a] p-4 resize-none focus:outline-none text-white/90 text-sm font-mono" placeholder="graph TD\n  A[Start] --> B[End]" />
              ) : (
                <pre className="w-full h-full bg-[#1a1a1a] p-4 rounded overflow-auto"><code className="text-sm text-white/80 font-mono">{node.mermaidCode}</code></pre>
              )}
            </div>
          </div>
        )}

        {/* Poll Node */}
        {node.type === 'poll' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
              <Vote size={16} className="text-purple-400" />
              <input type="text" value={node.pollQuestion} onChange={(e) => setNodes(nodes.map(n => n.id === node.id ? { ...n, pollQuestion: e.target.value } : n))} className="flex-1 bg-transparent text-sm font-medium text-white/80 focus:outline-none" placeholder="Poll question" />
            </div>
            <div className="space-y-2">
              {node.pollOptions && node.pollOptions.map((option, idx) => (
                <div key={option.id} className="flex items-center gap-2 p-2 bg-white/5 rounded hover:bg-white/10 transition-colors cursor-pointer" onClick={() => {
                  const newOptions = [...(node.pollOptions || [])];
                  newOptions[idx].votes += 1;
                  setNodes(nodes.map(n => n.id === node.id ? { ...n, pollOptions: newOptions } : n));
                }}>
                  <div className="flex-1 text-sm text-white/90">{option.text}</div>
                  <div className="text-xs text-white/60 px-2 py-1 bg-purple-500/20 rounded">{option.votes}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timer/Countdown Node */}
        {node.type === 'timer' && (
          <div className="w-full h-full p-4 rounded-lg bg-gradient-to-br from-red-500/10 to-orange-500/10 shadow-2xl border border-red-500/20 backdrop-blur-md flex flex-col items-center justify-center" style={{ boxShadow: '0 10px 40px rgba(239, 68, 68, 0.3)' }}>
            <Timer size={32} className="text-red-400 mb-3" />
            <div className="text-3xl font-bold text-white mb-2">
              {node.timerTarget ? Math.max(0, Math.floor((node.timerTarget.getTime() - Date.now()) / 1000 / 60 / 60 / 24)) : 0} days
            </div>
            <div className="text-sm text-white/60">{node.timerLabel}</div>
          </div>
        )}

        {/* Calendar Node */}
        {node.type === 'calendar' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
              <Calendar size={16} className="text-cyan-400" />
              <span className="text-sm font-medium text-white/80">Calendar</span>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-white mb-1">{node.calendarDate?.getDate() || new Date().getDate()}</div>
              <div className="text-white/60 text-sm">{node.calendarDate?.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
            </div>
          </div>
        )}

        {/* Form Node */}
        {node.type === 'form' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
              <ClipboardList size={16} className="text-green-400" />
              <span className="text-sm font-medium text-white/80">Form</span>
            </div>
            <div className="space-y-3">
              {node.formFields && node.formFields.map((field, idx) => (
                <div key={field.id}>
                  <label className="text-xs text-white/60 mb-1 block">{field.label}</label>
                  {field.type === 'textarea' ? (
                    <textarea value={field.value} onChange={(e) => {
                      const newFields = [...(node.formFields || [])];
                      newFields[idx].value = e.target.value;
                      setNodes(nodes.map(n => n.id === node.id ? { ...n, formFields: newFields } : n));
                    }} className="w-full bg-white/5 border border-white/10 rounded p-2 text-sm text-white/90 focus:outline-none focus:border-green-500/50" rows={3} />
                  ) : (
                    <input type={field.type} value={field.value} onChange={(e) => {
                      const newFields = [...(node.formFields || [])];
                      newFields[idx].value = e.target.value;
                      setNodes(nodes.map(n => n.id === node.id ? { ...n, formFields: newFields } : n));
                    }} className="w-full bg-white/5 border border-white/10 rounded p-2 text-sm text-white/90 focus:outline-none focus:border-green-500/50" />
                  )}
                </div>
              ))}
              <button className="w-full py-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded text-sm transition-colors">Submit</button>
            </div>
          </div>
        )}

        {/* Button Node */}
        {node.type === 'button' && (
          <div className="w-full h-full p-4 rounded-lg bg-gradient-to-br from-blue-500/10 to-purple-500/10 shadow-2xl border border-blue-500/20 backdrop-blur-md flex items-center justify-center" style={{ boxShadow: '0 10px 40px rgba(59, 130, 246, 0.3)' }}>
            <button className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white font-medium rounded-lg transition-all transform hover:scale-105 shadow-lg flex items-center gap-2">
              <MousePointerClick size={18} />
              {node.buttonLabel || 'Click Me'}
            </button>
          </div>
        )}

        {/* Link Preview Node */}
        {node.type === 'link' && (
          <div className="w-full h-full rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md overflow-hidden hover:border-blue-500/50 transition-colors cursor-pointer" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-500/10 rounded">
                  <ExternalLink size={20} className="text-blue-400" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <div className="text-sm font-medium text-white/90 truncate">{node.linkTitle}</div>
                  <div className="text-xs text-white/60 truncate mt-1">{node.linkDescription}</div>
                  <div className="text-xs text-blue-400 truncate mt-2">{node.linkUrl}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bookmarks Node */}
        {node.type === 'bookmarks' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
              <Bookmark size={16} className="text-yellow-400" />
              <span className="text-sm font-medium text-white/80">Bookmarks</span>
            </div>
            <div className="space-y-2">
              {node.bookmarksList && node.bookmarksList.map((bookmark) => (
                <a key={bookmark.id} href={bookmark.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2 bg-white/5 rounded hover:bg-white/10 transition-colors group">
                  <ExternalLink size={14} className="text-white/40 group-hover:text-blue-400 transition-colors" />
                  <span className="text-sm text-white/90 flex-1 truncate">{bookmark.title}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Tags Node */}
        {node.type === 'tags' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
              <Tag size={16} className="text-pink-400" />
              <span className="text-sm font-medium text-white/80">Tags</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {node.tagsList && node.tagsList.map((tag, idx) => (
                <div key={idx} className="px-3 py-1 bg-gradient-to-r from-pink-500/20 to-purple-500/20 border border-pink-500/30 rounded-full text-xs text-white/90">{tag}</div>
              ))}
            </div>
          </div>
        )}

        {/* Citation Node */}
        {node.type === 'citation' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-l-4 border-purple-500 backdrop-blur-md" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={16} className="text-purple-400" />
              <span className="text-xs font-medium text-white/60">Citation</span>
            </div>
            <div className="space-y-2 text-sm text-white/90">
              <div><span className="text-white/60">Author:</span> {node.citationAuthor}</div>
              <div className="font-medium italic">{node.citationTitle}</div>
              <div className="text-white/60">{node.citationSource}, {node.citationYear}</div>
            </div>
          </div>
        )}

        {/* Changelog Node */}
        {node.type === 'changelog' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md overflow-auto" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
              <GitBranch size={16} className="text-green-400" />
              <span className="text-sm font-medium text-white/80">Changelog</span>
            </div>
            <div className="space-y-3">
              {node.changelogEntries && node.changelogEntries.map((entry) => (
                <div key={entry.id} className="border-l-2 border-green-500/30 pl-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-green-400">{entry.version}</span>
                    <span className="text-xs text-white/40">{entry.date}</span>
                  </div>
                  <div className="text-sm text-white/80">{entry.changes}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Profile Card Node */}
        {node.type === 'profile' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-2xl font-bold mb-3">{node.profileName?.charAt(0) || 'U'}</div>
              <div className="text-white/90 font-medium">{node.profileName}</div>
              <div className="text-sm text-white/60 mb-2">{node.profileRole}</div>
              <div className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${node.profileStatus === 'online' ? 'bg-green-400' : 'bg-gray-400'}`}></div>
                <span className="text-xs text-white/60 capitalize">{node.profileStatus}</span>
              </div>
            </div>
          </div>
        )}

        {/* Meeting Notes Node */}
        {node.type === 'meeting' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md overflow-auto" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
              <UsersIcon size={16} className="text-purple-400" />
              <input type="text" value={node.meetingTitle} onChange={(e) => setNodes(nodes.map(n => n.id === node.id ? { ...n, meetingTitle: e.target.value } : n))} className="flex-1 bg-transparent text-sm font-medium text-white/80 focus:outline-none" />
            </div>
            <div className="text-xs text-white/60 mb-3">{node.meetingDate?.toLocaleString()}</div>
            <div className="mb-3">
              <div className="text-xs text-white/60 mb-1">Attendees:</div>
              <div className="flex flex-wrap gap-1">
                {node.meetingAttendees && node.meetingAttendees.map((attendee, idx) => (
                  <span key={idx} className="px-2 py-1 bg-purple-500/20 rounded text-xs text-white/80">{attendee}</span>
                ))}
              </div>
            </div>
            <textarea value={node.meetingNotes} onChange={(e) => setNodes(nodes.map(n => n.id === node.id ? { ...n, meetingNotes: e.target.value } : n))} className="w-full h-32 bg-white/5 border border-white/10 rounded p-2 text-sm text-white/90 focus:outline-none resize-none" placeholder="Meeting notes..." />
          </div>
        )}

        {/* Decision Record Node */}
        {node.type === 'decision' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md overflow-auto" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
              <FileCheck size={16} className="text-green-400" />
              <input type="text" value={node.decisionTitle} onChange={(e) => setNodes(nodes.map(n => n.id === node.id ? { ...n, decisionTitle: e.target.value } : n))} className="flex-1 bg-transparent text-sm font-medium text-white/80 focus:outline-none" placeholder="Decision title" />
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-white/60 mb-1">Context:</div>
                <textarea value={node.decisionContext} onChange={(e) => setNodes(nodes.map(n => n.id === node.id ? { ...n, decisionContext: e.target.value } : n))} className="w-full bg-white/5 border border-white/10 rounded p-2 text-white/90 focus:outline-none resize-none" rows={2} />
              </div>
              <div>
                <div className="text-xs text-white/60 mb-1">Decision:</div>
                <textarea value={node.decisionDecision} onChange={(e) => setNodes(nodes.map(n => n.id === node.id ? { ...n, decisionDecision: e.target.value } : n))} className="w-full bg-white/5 border border-white/10 rounded p-2 text-white/90 focus:outline-none resize-none" rows={2} />
              </div>
              <div>
                <div className="text-xs text-white/60 mb-1">Consequences:</div>
                <textarea value={node.decisionConsequences} onChange={(e) => setNodes(nodes.map(n => n.id === node.id ? { ...n, decisionConsequences: e.target.value } : n))} className="w-full bg-white/5 border border-white/10 rounded p-2 text-white/90 focus:outline-none resize-none" rows={2} />
              </div>
              <div className="px-3 py-1 bg-green-500/20 border border-green-500/30 rounded-full text-xs text-green-400 inline-block">{node.decisionStatus}</div>
            </div>
          </div>
        )}

        {/* Status Badge Node */}
        {node.type === 'status' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md flex items-center justify-center" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
              node.statusType === 'done' ? 'bg-green-500/20 border border-green-500/50 text-green-400' :
              node.statusType === 'in-progress' ? 'bg-blue-500/20 border border-blue-500/50 text-blue-400' :
              node.statusType === 'blocked' ? 'bg-red-500/20 border border-red-500/50 text-red-400' :
              'bg-gray-500/20 border border-gray-500/50 text-gray-400'
            }`}>
              <AlertCircle size={18} />
              <span className="font-medium">{node.statusLabel}</span>
            </div>
          </div>
        )}

        {/* Reactions Node */}
        {node.type === 'reactions' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
              <Heart size={16} className="text-pink-400" />
              <span className="text-sm font-medium text-white/80">Reactions</span>
            </div>
            <div className="flex items-center justify-around">
              <button onClick={() => setNodes(nodes.map(n => n.id === node.id ? { ...n, reactionsLikes: (n.reactionsLikes || 0) + 1 } : n))} className="flex flex-col items-center gap-1 p-3 hover:bg-white/10 rounded transition-colors">
                <div className="text-2xl">👍</div>
                <div className="text-sm text-white/60">{node.reactionsThumbsUp || 0}</div>
              </button>
              <button onClick={() => setNodes(nodes.map(n => n.id === node.id ? { ...n, reactionsHearts: (n.reactionsHearts || 0) + 1 } : n))} className="flex flex-col items-center gap-1 p-3 hover:bg-white/10 rounded transition-colors">
                <div className="text-2xl">❤️</div>
                <div className="text-sm text-white/60">{node.reactionsHearts || 0}</div>
              </button>
              <button onClick={() => setNodes(nodes.map(n => n.id === node.id ? { ...n, reactionsLikes: (n.reactionsLikes || 0) + 1 } : n))} className="flex flex-col items-center gap-1 p-3 hover:bg-white/10 rounded transition-colors">
                <div className="text-2xl">🎉</div>
                <div className="text-sm text-white/60">{node.reactionsLikes || 0}</div>
              </button>
            </div>
          </div>
        )}

        {/* AI Assistant Node */}
        {node.type === 'ai' && (
          <div className="w-full h-full rounded-lg bg-gradient-to-br from-purple-500/10 to-pink-500/10 shadow-2xl border border-purple-500/20 backdrop-blur-md overflow-hidden" style={{ boxShadow: '0 10px 40px rgba(168, 85, 247, 0.3)' }}>
            <div className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] border-b border-purple-500/20">
              <Sparkles size={14} className="text-purple-400" />
              <span className="text-xs font-medium text-purple-400">AI Assistant</span>
            </div>
            <div className="p-4 space-y-3">
              <textarea value={node.aiPrompt} onChange={(e) => setNodes(nodes.map(n => n.id === node.id ? { ...n, aiPrompt: e.target.value } : n))} className="w-full bg-white/5 border border-purple-500/20 rounded p-3 text-sm text-white/90 focus:outline-none focus:border-purple-500/50 resize-none" rows={3} placeholder="Ask AI anything..." />
              {node.aiResponse && (
                <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded text-sm text-white/90">{node.aiResponse}</div>
              )}
              <button className="w-full py-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded text-sm transition-colors">Generate Response</button>
            </div>
          </div>
        )}

        {/* Calculator Node */}
        {node.type === 'calc' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
              <Calculator size={16} className="text-blue-400" />
              <span className="text-sm font-medium text-white/80">Calculator</span>
            </div>
            <input type="text" value={node.calcExpression} onChange={(e) => setNodes(nodes.map(n => n.id === node.id ? { ...n, calcExpression: e.target.value, calcResult: String(eval(e.target.value)) } : n))} className="w-full bg-white/5 border border-white/10 rounded p-3 text-white/90 font-mono text-lg focus:outline-none focus:border-blue-500/50 mb-3" placeholder="2 + 2" />
            <div className="text-3xl font-bold text-blue-400 text-center">{node.calcResult}</div>
          </div>
        )}

        {/* Weather Node */}
        {node.type === 'weather' && (
          <div className="w-full h-full p-4 rounded-lg bg-gradient-to-br from-cyan-500/10 to-blue-500/10 shadow-2xl border border-cyan-500/20 backdrop-blur-md" style={{ boxShadow: '0 10px 40px rgba(6, 182, 212, 0.3)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Cloud size={20} className="text-cyan-400" />
              <span className="text-sm font-medium text-white/80">{node.weatherLocation}</span>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-white mb-2">{node.weatherTemp}</div>
              <div className="text-white/60">{node.weatherCondition}</div>
            </div>
          </div>
        )}

        {/* World Clock Node */}
        {node.type === 'clock' && (
          <div className="w-full h-full p-4 rounded-lg bg-[#0a0a0a] shadow-2xl border border-white/20 backdrop-blur-md flex flex-col items-center justify-center" style={{ boxShadow: '0 10px 40px rgba(0, 0, 0, 0.7)' }}>
            <Clock size={32} className="text-orange-400 mb-3" />
            <div className="text-3xl font-bold text-white mb-1">{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
            <div className="text-sm text-white/60">{node.clockCity}</div>
            <div className="text-xs text-white/40 mt-1">{node.clockTimezone}</div>
          </div>
        )}

        {/* Search Node */}
        {node.type === 'search' && (
          <div className="w-full h-full rounded-lg bg-gradient-to-br from-blue-500/10 to-purple-500/10 shadow-2xl border-2 border-blue-500/50 backdrop-blur-md overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-[#1a1a1a] border-b border-blue-500/30">
              <Search size={16} className="text-blue-400" />
              <input
                type="text"
                value={searchNodeQuery?.nodeId === node.id ? searchNodeQuery.query : ''}
                onChange={(e) => {
                  setSearchNodeQuery({ nodeId: node.id, query: e.target.value });
                }}
                placeholder="Search for node type..."
                className="flex-1 bg-transparent text-white/90 text-sm focus:outline-none placeholder:text-white/40"
                autoFocus={searchNodeQuery?.nodeId === node.id}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className="h-[calc(100%-48px)] overflow-y-auto">
              {(() => {
                const query = searchNodeQuery?.nodeId === node.id ? searchNodeQuery.query.toLowerCase().trim() : '';

                // Smart search: match against name, type, category, and keywords
                const filteredNodes = NODE_REGISTRY.filter(nodeMeta => {
                  if (!query) return true; // Show all if no query

                  return (
                    nodeMeta.name.toLowerCase().includes(query) ||
                    nodeMeta.type.toLowerCase().includes(query) ||
                    nodeMeta.category.toLowerCase().includes(query) ||
                    nodeMeta.keywords.some(keyword => keyword.includes(query))
                  );
                });

                // Group by category
                const groupedNodes = filteredNodes.reduce((acc, nodeMeta) => {
                  if (!acc[nodeMeta.category]) {
                    acc[nodeMeta.category] = [];
                  }
                  acc[nodeMeta.category].push(nodeMeta);
                  return acc;
                }, {} as Record<string, NodeMetadata[]>);

                const categories = ['Basic', 'Content & Media', 'Interactive', 'Organization', 'Collaboration', 'Smart'] as const;

                return filteredNodes.length > 0 ? (
                  categories.map(category => {
                    const nodesInCategory = groupedNodes[category];
                    if (!nodesInCategory || nodesInCategory.length === 0) return null;

                    return (
                      <div key={category}>
                        {query && (
                          <div className="px-4 py-2 bg-white/5 text-xs font-semibold text-white/40 uppercase tracking-wide sticky top-0">
                            {category}
                          </div>
                        )}
                        {nodesInCategory.map(nodeMeta => {
                          const Icon = nodeMeta.icon;
                          return (
                            <button
                              key={nodeMeta.type}
                              onClick={(e) => {
                                e.stopPropagation();
                                // Replace the search node with the selected type
                                const newNode = {
                                  ...node,
                                  type: nodeMeta.type,
                                };
                                setNodes(nodes.map(n => n.id === node.id ? newNode : n));
                                setSearchNodeQuery(null);
                              }}
                              className="w-full px-4 py-3 hover:bg-blue-500/20 transition-colors text-left border-b border-white/5 flex items-center gap-3"
                            >
                              <Icon size={16} className={nodeMeta.color} />
                              <div>
                                <div className="text-sm font-medium text-white/90">{nodeMeta.name}</div>
                                {query && (
                                  <div className="text-xs text-white/40">{nodeMeta.category}</div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-white/40">
                    {query ? `No nodes matching "${query}"` : 'Type to search for nodes...'}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col relative bg-black border border-white/10 rounded-lg overflow-hidden">
      {/* Top Toolbar */}
      <div className="w-full border-b border-white/10 bg-black/90 backdrop-blur-md z-50">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <input
              type="text"
              defaultValue="Untitled Canvas"
              className="bg-transparent text-white text-lg font-medium focus:outline-none border-b border-transparent hover:border-white/20 focus:border-blue-500 transition-colors px-2 py-1"
            />
          </div>

          <div className="flex items-center gap-2">
            {/* Tools */}
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
              <button
                onClick={() => setTool('select')}
                className={`p-2 rounded transition-colors ${
                  tool === 'select'
                    ? 'bg-white/20 text-white'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                }`}
                title="Select (V)"
              >
                <MousePointer size={18} />
              </button>
              <button
                onClick={() => setTool('pan')}
                className={`p-2 rounded transition-colors ${
                  tool === 'pan'
                    ? 'bg-white/20 text-white'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                }`}
                title="Pan (H)"
              >
                <Move size={18} />
              </button>
            </div>

            <div className="w-px h-6 bg-white/10"></div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
              <button
                onClick={handleZoomOut}
                className="p-2 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors"
                title="Zoom Out"
              >
                <ZoomOut size={18} />
              </button>
              <button
                onClick={handleResetZoom}
                className="px-2 py-1 hover:bg-white/10 rounded text-sm font-medium min-w-[60px] text-white/80 hover:text-white transition-colors"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                onClick={handleZoomIn}
                className="p-2 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors"
                title="Zoom In"
              >
                <ZoomIn size={18} />
              </button>
            </div>

            <div className="w-px h-6 bg-white/10"></div>

            {/* Action Buttons */}
            <button className="p-2 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors" title="Undo">
              <Undo size={18} />
            </button>
            <button className="p-2 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors" title="Redo">
              <Redo size={18} />
            </button>

            <div className="w-px h-6 bg-white/10"></div>

            <button className="p-2 hover:bg-white/10 rounded text-white/60 hover:text-white transition-colors" title="Share">
              <Users size={18} />
            </button>
            <button className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded text-white text-sm transition-colors">
              <Save size={16} className="inline mr-1" />
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Left Toolbar */}
      <div className="absolute left-4 top-20 z-40 bg-black/90 backdrop-blur-md rounded-lg shadow-2xl border border-white/10 p-2 space-y-2">
        <button
          onClick={() => setShowNodeMenu(!showNodeMenu)}
          className="p-3 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-colors w-full"
          title="Add Element"
        >
          <Plus size={20} />
        </button>

        {showNodeMenu && (
          <div className="absolute left-full ml-2 top-0 bg-black/90 backdrop-blur-md rounded-lg shadow-2xl border border-white/10 p-3 w-64 max-h-[80vh] overflow-y-auto">
            {/* Basic */}
            <div className="mb-3">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-2 px-2">Basic</div>
              <button onClick={() => addNode('sticky')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <StickyNote size={16} className="text-yellow-400" />
                <span className="text-sm text-white/90">Sticky Note</span>
              </button>
              <button onClick={() => addNode('text')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Type size={16} className="text-white/60" />
                <span className="text-sm text-white/90">Text Box</span>
              </button>
              <button onClick={() => addNode('shape')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Square size={16} className="text-white/60" />
                <span className="text-sm text-white/90">Shape</span>
              </button>
              <button onClick={() => addNode('image')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <ImageIcon size={16} className="text-purple-400" />
                <span className="text-sm text-white/90">Image</span>
              </button>
            </div>

            <div className="w-full h-px bg-white/5 my-2"></div>

            {/* Content & Media */}
            <div className="mb-3">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-2 px-2">Content & Media</div>
              <button onClick={() => addNode('document')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <FileText size={16} className="text-blue-400" />
                <span className="text-sm text-white/90">Document</span>
              </button>
              <button onClick={() => addNode('video')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Video size={16} className="text-red-400" />
                <span className="text-sm text-white/90">Video Embed</span>
              </button>
              <button onClick={() => addNode('table')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Table size={16} className="text-green-400" />
                <span className="text-sm text-white/90">Table</span>
              </button>
              <button onClick={() => addNode('chart')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <BarChart3 size={16} className="text-cyan-400" />
                <span className="text-sm text-white/90">Chart</span>
              </button>
              <button onClick={() => addNode('drawing')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Pencil size={16} className="text-orange-400" />
                <span className="text-sm text-white/90">Drawing</span>
              </button>
              <button onClick={() => addNode('mermaid')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Network size={16} className="text-pink-400" />
                <span className="text-sm text-white/90">Diagram</span>
              </button>
              <button onClick={() => addNode('code')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Code2 size={16} className="text-green-400" />
                <span className="text-sm text-white/90">Code Block</span>
              </button>
              <button onClick={() => addNode('quote')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Quote size={16} className="text-blue-400" />
                <span className="text-sm text-white/90">Quote</span>
              </button>
            </div>

            <div className="w-full h-px bg-white/5 my-2"></div>

            {/* Interactive */}
            <div className="mb-3">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-2 px-2">Interactive</div>
              <button onClick={() => addNode('todo')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <CheckSquare size={16} className="text-blue-400" />
                <span className="text-sm text-white/90">To-Do List</span>
              </button>
              <button onClick={() => addNode('poll')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Vote size={16} className="text-purple-400" />
                <span className="text-sm text-white/90">Poll</span>
              </button>
              <button onClick={() => addNode('timer')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Timer size={16} className="text-red-400" />
                <span className="text-sm text-white/90">Countdown</span>
              </button>
              <button onClick={() => addNode('calendar')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Calendar size={16} className="text-cyan-400" />
                <span className="text-sm text-white/90">Calendar</span>
              </button>
              <button onClick={() => addNode('form')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <ClipboardList size={16} className="text-green-400" />
                <span className="text-sm text-white/90">Form</span>
              </button>
              <button onClick={() => addNode('button')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <MousePointerClick size={16} className="text-yellow-400" />
                <span className="text-sm text-white/90">Button</span>
              </button>
            </div>

            <div className="w-full h-px bg-white/5 my-2"></div>

            {/* Organization */}
            <div className="mb-3">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-2 px-2">Organization</div>
              <button onClick={() => addNode('file')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Paperclip size={16} className="text-white/60" />
                <span className="text-sm text-white/90">File Attachment</span>
              </button>
              <button onClick={() => addNode('link')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <ExternalLink size={16} className="text-blue-400" />
                <span className="text-sm text-white/90">Link Preview</span>
              </button>
              <button onClick={() => addNode('bookmarks')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Bookmark size={16} className="text-yellow-400" />
                <span className="text-sm text-white/90">Bookmarks</span>
              </button>
              <button onClick={() => addNode('tags')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Tag size={16} className="text-pink-400" />
                <span className="text-sm text-white/90">Tags</span>
              </button>
              <button onClick={() => addNode('citation')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <BookOpen size={16} className="text-purple-400" />
                <span className="text-sm text-white/90">Citation</span>
              </button>
              <button onClick={() => addNode('changelog')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <GitBranch size={16} className="text-green-400" />
                <span className="text-sm text-white/90">Changelog</span>
              </button>
            </div>

            <div className="w-full h-px bg-white/5 my-2"></div>

            {/* Collaboration */}
            <div className="mb-3">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-2 px-2">Collaboration</div>
              <button onClick={() => addNode('comment')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <MessageCircle size={16} className="text-blue-400" />
                <span className="text-sm text-white/90">Comment</span>
              </button>
              <button onClick={() => addNode('profile')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <User size={16} className="text-cyan-400" />
                <span className="text-sm text-white/90">Profile Card</span>
              </button>
              <button onClick={() => addNode('meeting')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <UsersIcon size={16} className="text-purple-400" />
                <span className="text-sm text-white/90">Meeting Notes</span>
              </button>
              <button onClick={() => addNode('decision')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <FileCheck size={16} className="text-green-400" />
                <span className="text-sm text-white/90">Decision Record</span>
              </button>
              <button onClick={() => addNode('status')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <AlertCircle size={16} className="text-yellow-400" />
                <span className="text-sm text-white/90">Status Badge</span>
              </button>
              <button onClick={() => addNode('reactions')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Heart size={16} className="text-pink-400" />
                <span className="text-sm text-white/90">Reactions</span>
              </button>
            </div>

            <div className="w-full h-px bg-white/5 my-2"></div>

            {/* Smart */}
            <div className="mb-1">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-2 px-2">Smart</div>
              <button onClick={() => addNode('ai')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Sparkles size={16} className="text-purple-400" />
                <span className="text-sm text-white/90">AI Assistant</span>
              </button>
              <button onClick={() => addNode('calc')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Calculator size={16} className="text-blue-400" />
                <span className="text-sm text-white/90">Calculator</span>
              </button>
              <button onClick={() => addNode('weather')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Cloud size={16} className="text-cyan-400" />
                <span className="text-sm text-white/90">Weather</span>
              </button>
              <button onClick={() => addNode('clock')} className="w-full flex items-center gap-3 p-2 hover:bg-white/10 rounded text-left transition-colors">
                <Clock size={16} className="text-orange-400" />
                <span className="text-sm text-white/90">World Clock</span>
              </button>
            </div>
          </div>
        )}

        <div className="w-full h-px bg-white/10"></div>

        {selectedNodeId && (
          <>
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="p-3 hover:bg-white/10 rounded-lg transition-colors w-full flex items-center justify-center gap-2"
              title="Change Color"
            >
              <Palette size={20} className="text-white/60" />
              <span className="text-sm text-white/90">Color</span>
            </button>

            {showColorPicker && (
              <div className="absolute left-full ml-2 bg-black/90 backdrop-blur-md rounded-lg shadow-2xl border border-white/10 p-3">
                <div className="grid grid-cols-3 gap-2">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => selectedNodeId && updateNodeColor(selectedNodeId, color)}
                      className="w-8 h-8 rounded hover:scale-110 transition-transform border-2 border-white/10 hover:border-white/30"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => selectedNodeId && duplicateNode(selectedNodeId)}
              className="p-3 hover:bg-white/10 rounded-lg transition-colors w-full flex items-center justify-center gap-2"
              title="Duplicate"
            >
              <Copy size={20} className="text-white/60" />
              <span className="text-sm text-white/90">Copy</span>
            </button>

            <button
              onClick={() => selectedNodeId && deleteNode(selectedNodeId)}
              className="p-3 hover:bg-white/10 rounded-lg transition-colors w-full flex items-center justify-center gap-2"
              title="Delete"
            >
              <Trash2 size={20} className="text-white/60" />
              <span className="text-sm text-white/90">Delete</span>
            </button>
          </>
        )}
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="flex-1 overflow-hidden relative"
        style={{ cursor: tool === 'pan' || isPanning || isSpacePressed ? 'grab' : 'default' }}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => {
          e.preventDefault();
          setCanvasContextMenu({ x: e.clientX, y: e.clientY });
          setContextMenu(null); // Close node context menu if open
        }}
        onClick={() => {
          // Close canvas context menu on click
          setCanvasContextMenu(null);

          // Handle clicks outside the node when settings are open
          if (showSettingsModal && settingsNodeId) {
            // Clear any existing timer
            if (outsideClickTimerRef.current) {
              clearTimeout(outsideClickTimerRef.current);
            }

            const newCount = outsideClickCount + 1;
            setOutsideClickCount(newCount);

            if (newCount >= 2) {
              // Double click detected - revert changes but preserve position/size
              if (originalNodeState) {
                const currentNode = nodes.find(n => n.id === settingsNodeId);
                setNodes(nodes.map(n =>
                  n.id === settingsNodeId ? {
                    ...originalNodeState,
                    // Preserve position and size from current state
                    x: currentNode?.x ?? originalNodeState.x,
                    y: currentNode?.y ?? originalNodeState.y,
                    width: currentNode?.width ?? originalNodeState.width,
                    height: currentNode?.height ?? originalNodeState.height,
                  } : n
                ));
              }
              setShowSettingsModal(false);
              setSettingsNodeId(null);
              setOriginalNodeState(null);
              setOutsideClickCount(0);
            } else {
              // Reset count after 500ms if no second click
              outsideClickTimerRef.current = setTimeout(() => {
                setOutsideClickCount(0);
              }, 500);
            }
          }
        }}
      >
        {/* Grid Background */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(255, 255, 255, 0.05) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255, 255, 255, 0.05) 1px, transparent 1px)
            `,
            backgroundSize: `${40 * zoom}px ${40 * zoom}px`,
            backgroundPosition: `${panOffset.x}px ${panOffset.y}px`
          }}
        />

        {/* Nodes Container */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            transformOrigin: '0 0'
          }}
        >
          {nodes.map(renderNode)}
        </div>
      </div>

      {/* Instructions */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/90 backdrop-blur-md border border-white/10 text-white px-4 py-2 rounded-full text-sm shadow-2xl">
        Double-click to edit • Right-click for settings • Space+Click to pan • Ctrl+Scroll to zoom • Del: Delete
      </div>

      {/* Canvas Context Menu */}
      {canvasContextMenu && (
        <div
          className="fixed bg-[#1a1a1a] border border-white/20 rounded-lg shadow-2xl py-2 z-[100]"
          style={{ top: canvasContextMenu.y, left: canvasContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              // Create a search node at the click position
              const canvasRect = canvasRef.current?.getBoundingClientRect();
              if (canvasRect) {
                const x = (canvasContextMenu.x - canvasRect.left - panOffset.x) / zoom;
                const y = (canvasContextMenu.y - canvasRect.top - panOffset.y) / zoom;

                const baseNode = {
                  id: Date.now().toString(),
                  type: 'search' as NodeType,
                  x,
                  y,
                  width: 400,
                  height: 400,
                };

                setNodes([...nodes, baseNode]);
                setSearchNodeQuery({ nodeId: baseNode.id, query: '' });
              }
              setCanvasContextMenu(null);
            }}
            className="w-full px-4 py-2 hover:bg-white/10 transition-colors text-left flex items-center gap-2 text-white/90"
          >
            <Search size={16} className="text-blue-400" />
            <span className="text-sm">Search node</span>
          </button>
          <button
            onClick={() => {
              // Select all nodes
              setNodes(nodes.map(n => ({ ...n, selected: true })));
              setCanvasContextMenu(null);
            }}
            className="w-full px-4 py-2 hover:bg-white/10 transition-colors text-left flex items-center gap-2 text-white/90"
          >
            <CheckCheck size={16} className="text-green-400" />
            <span className="text-sm">Select all</span>
          </button>
        </div>
      )}

      {/* Node Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-black/95 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl py-2 z-[9999]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => openSettings(contextMenu.nodeId)}
            className="w-full px-4 py-2 hover:bg-white/10 transition-colors text-left flex items-center gap-2 text-white/90"
          >
            <Sliders size={16} className="text-blue-400" />
            <span className="text-sm">Settings</span>
          </button>
          <button
            onClick={() => { handleNodeDoubleClick(contextMenu.nodeId); setContextMenu(null); }}
            className="w-full px-4 py-2 hover:bg-white/10 transition-colors text-left flex items-center gap-2 text-white/90"
          >
            <Edit3 size={16} className="text-green-400" />
            <span className="text-sm">Edit</span>
          </button>
          <button
            onClick={() => { duplicateNode(contextMenu.nodeId); setContextMenu(null); }}
            className="w-full px-4 py-2 hover:bg-white/10 transition-colors text-left flex items-center gap-2 text-white/90"
          >
            <Copy size={16} className="text-purple-400" />
            <span className="text-sm">Duplicate</span>
          </button>
          <div className="w-full h-px bg-white/10 my-1"></div>
          <button
            onClick={() => { deleteNode(contextMenu.nodeId); setContextMenu(null); }}
            className="w-full px-4 py-2 hover:bg-red-500/10 transition-colors text-left flex items-center gap-2 text-red-400"
          >
            <Trash2 size={16} />
            <span className="text-sm">Delete</span>
          </button>
        </div>
      )}

    </div>
  );
};

export default CanvasPlanningVisual;
