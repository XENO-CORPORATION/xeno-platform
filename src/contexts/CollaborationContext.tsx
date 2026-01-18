/**
 * CollaborationContext
 * Manages real-time Figma-style collaboration for XenoOS
 * Handles WebSocket connection, cursor positions, presence, and synchronized operations
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';

// Types
export interface Participant {
  id: string;
  odea: string;
  displayName: string;
  avatarUrl?: string;
  color: string;
  cursorX: number;
  cursorY: number;
  cursorWindowId?: string;
  selection: string[];
  isOwner?: boolean;
}

export interface CollabSession {
  id: string;
  containerId: string;
  name: string;
  shareToken: string;
  shareUrl: string;
  ownerId: string;
  maxParticipants: number;
  permissions: {
    canEdit: boolean;
    canDelete: boolean;
    canCreateFiles: boolean;
  };
  isActive: boolean;
  createdAt: string;
  expiresAt?: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  color: string;
  message: string;
  timestamp: string;
}

export interface FileOperation {
  odea: string;
  displayName: string;
  operation: 'create' | 'delete' | 'rename' | 'move';
  path: string;
  newPath?: string;
  itemType: 'file' | 'folder';
  timestamp: string;
}

export interface WindowOperation {
  userId: string;
  displayName: string;
  operation: 'open' | 'close' | 'minimize' | 'maximize' | 'move' | 'resize' | 'focus';
  windowId: string;
  windowType?: string;
  windowTitle?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  timestamp: string;
}

export interface IconPositionUpdate {
  userId: string;
  iconId: string;
  position: { x: number; y: number };
  isDragging: boolean;
  timestamp: string;
}

interface CollaborationContextType {
  // Session state
  session: CollabSession | null;
  participants: Participant[];
  isConnected: boolean;
  isHost: boolean;
  myParticipant: Participant | null;

  // Chat
  chatMessages: ChatMessage[];

  // File operations from others
  lastFileOperation: FileOperation | null;

  // Window operations from others
  lastWindowOperation: WindowOperation | null;

  // Icon position updates from others
  lastIconPositionUpdate: IconPositionUpdate | null;

  // Actions
  createSession: (containerId: string, name?: string) => Promise<CollabSession | null>;
  joinSession: (shareToken: string) => Promise<boolean>;
  leaveSession: () => void;
  endSession: () => Promise<void>;

  // Invitations
  inviteUser: (email: string, message?: string) => Promise<{ inviteUrl: string } | null>;

  // Real-time operations
  broadcastCursor: (x: number, y: number, windowId?: string) => void;
  broadcastSelection: (selectedItems: string[]) => void;
  broadcastFileOperation: (operation: FileOperation) => void;
  broadcastWindowOperation: (operation: any) => void;
  broadcastIconPosition: (iconId: string, position: { x: number; y: number }, isDragging: boolean) => void;
  sendChatMessage: (message: string) => void;

  // Utilities
  getParticipantColor: (userId: string) => string;
  clearChat: () => void;
}

const CollaborationContext = createContext<CollaborationContextType | undefined>(undefined);

// WebSocket URL - uses nginx proxy for proper SSL handling
const getWebSocketUrl = () => {
  if (typeof window === 'undefined') return 'ws://localhost:8080/ws';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
};
const WS_URL = process.env.REACT_APP_COLLAB_WS_URL || getWebSocketUrl();
const API_BASE = process.env.REACT_APP_API_URL || '';

// Message types
const MessageTypes = {
  AUTH: 'auth',
  AUTH_SUCCESS: 'auth_success',
  AUTH_ERROR: 'auth_error',
  JOIN_SESSION: 'join_session',
  LEAVE_SESSION: 'leave_session',
  SESSION_JOINED: 'session_joined',
  SESSION_LEFT: 'session_left',
  USER_JOINED: 'user_joined',
  USER_LEFT: 'user_left',
  USERS_LIST: 'users_list',
  CURSOR_MOVE: 'cursor_move',
  CURSOR_UPDATE: 'cursor_update',
  SELECTION_CHANGE: 'selection_change',
  SELECTION_UPDATE: 'selection_update',
  FILE_OPERATION: 'file_operation',
  FILE_SYNC: 'file_sync',
  WINDOW_OPERATION: 'window_operation',
  WINDOW_SYNC: 'window_sync',
  ICON_POSITION: 'icon_position',
  ICON_POSITION_UPDATE: 'icon_position_update',
  CHAT_MESSAGE: 'chat_message',
  PING: 'ping',
  PONG: 'pong',
  ERROR: 'error'
};

export const CollaborationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();

  // State
  const [session, setSession] = useState<CollabSession | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [lastFileOperation, setLastFileOperation] = useState<FileOperation | null>(null);
  const [lastWindowOperation, setLastWindowOperation] = useState<WindowOperation | null>(null);
  const [lastIconPositionUpdate, setLastIconPositionUpdate] = useState<IconPositionUpdate | null>(null);
  const [myColor, setMyColor] = useState('#3B82F6');

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const cursorThrottleRef = useRef<NodeJS.Timeout | null>(null);
  const joinedSessionRef = useRef<string | null>(null); // Track which session we've joined
  const sessionRef = useRef<CollabSession | null>(null); // Keep session in ref for stable access

  // Keep sessionRef in sync with session state
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Computed
  const isHost = session?.ownerId === user?.id;
  const myParticipant = participants.find(p => p.odea === user?.id) || null;

  // Get auth token
  const getToken = useCallback(() => {
    return localStorage.getItem('xenoos_auth_token');
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const token = getToken();
    if (!token) {
      console.warn('No auth token available for collaboration');
      return;
    }

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Collaboration WebSocket connected');
        setIsConnected(true);

        // Authenticate after a small delay to ensure connection is stable
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: MessageTypes.AUTH,
              token
            }));
          }
        }, 50);

        // Start ping interval
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: MessageTypes.PING }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('Collaboration WebSocket disconnected:', event.code);
        setIsConnected(false);

        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }

        // Attempt reconnect if was connected to a session
        if (session && event.code !== 1000) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('Collaboration WebSocket error:', error);
      };
    } catch (error) {
      console.error('Error connecting to collaboration server:', error);
    }
  }, [getToken, session]);

  // Handle incoming messages - uses refs to avoid stale closures
  const handleMessage = useCallback((message: any) => {
    const currentSession = sessionRef.current;

    switch (message.type) {
      case MessageTypes.AUTH_SUCCESS:
        console.log('🔐 Authenticated with collaboration server');
        // If we have a session and haven't joined it yet, join now
        if (currentSession && joinedSessionRef.current !== currentSession.id) {
          console.log('🔗 Auto-joining session from AUTH_SUCCESS:', currentSession.id);
          joinedSessionRef.current = currentSession.id;
          wsRef.current?.send(JSON.stringify({
            type: MessageTypes.JOIN_SESSION,
            sessionId: currentSession.id
          }));
        }
        break;

      case MessageTypes.AUTH_ERROR:
        console.error('❌ Collaboration auth error:', message.error);
        break;

      case MessageTypes.SESSION_JOINED:
        console.log('✅ Joined session:', message.sessionId, 'Users:', message.users?.length || 0);
        console.log('👥 Existing users:', JSON.stringify(message.users, null, 2));
        setMyColor(message.color || '#3B82F6');
        if (message.users) {
          setParticipants(message.users);
        }
        break;

      case MessageTypes.SESSION_LEFT:
        console.log('👋 Left session:', message.sessionId);
        setParticipants([]);
        break;

      case MessageTypes.USER_JOINED:
        console.log('👤 USER_JOINED received:', JSON.stringify(message.user, null, 2));
        setParticipants(prev => {
          // Get the user ID from either field
          const odea = message.user.odea || message.user.userId || message.user.id;
          console.log('👤 Checking for duplicate with odea:', odea, 'Current participants:', prev.map(p => p.odea));
          // Avoid duplicates - check all possible ID fields
          if (prev.find(p => p.odea === odea || p.id === message.user.id)) {
            console.log('⚠️ User already in participants list, skipping');
            return prev;
          }
          const newParticipant = {
            id: message.user.id || odea,
            odea: odea,
            displayName: message.user.displayName,
            avatarUrl: message.user.avatarUrl,
            color: message.user.color,
            cursorX: 0,
            cursorY: 0,
            selection: []
          };
          console.log('✅ Adding new participant:', newParticipant);
          return [...prev, newParticipant];
        });
        break;

      case MessageTypes.USER_LEFT: {
        // Server sends "odea" field, not "userId" - handle both for compatibility
        const leftUserId = message.odea || message.userId;
        console.log('👋 User left:', leftUserId);
        // Guard against undefined userId which could corrupt state
        if (!leftUserId) {
          console.warn('⚠️ Ignoring USER_LEFT with undefined userId/odea');
          break;
        }
        setParticipants(prev => prev.filter(p => p.odea !== leftUserId));
        break;
      }

      case MessageTypes.CURSOR_UPDATE: {
        // Server sends "odea" field, not "userId" - handle both for compatibility
        const cursorUserId = message.odea || message.userId;
        // Guard against undefined userId
        if (!cursorUserId) {
          console.warn('⚠️ Ignoring CURSOR_UPDATE with undefined userId/odea');
          break;
        }
        // Only log occasionally to avoid console spam (every 60th update ~1/sec at 60fps)
        if (Math.random() < 0.016) {
          console.log('🖱️ CURSOR_UPDATE - odea:', cursorUserId, 'pos:', message.x, message.y);
        }
        setParticipants(prev => {
          const found = prev.find(p => p.odea === cursorUserId);
          if (!found) {
            console.warn('⚠️ CURSOR_UPDATE: No participant found with odea:', cursorUserId, 'Available:', prev.map(p => ({ id: p.id, odea: p.odea })));
            return prev; // Return unchanged to avoid unnecessary re-render
          }
          // Create new array only if position actually changed
          return prev.map(p =>
            p.odea === cursorUserId
              ? { ...p, cursorX: message.x, cursorY: message.y, cursorWindowId: message.windowId }
              : p
          );
        });
        break;
      }

      case MessageTypes.SELECTION_UPDATE: {
        // Server sends "odea" field, not "userId" - handle both
        const selectionUserId = message.odea || message.userId;
        if (!selectionUserId) break;
        setParticipants(prev => prev.map(p =>
          p.odea === selectionUserId
            ? { ...p, selection: message.selection }
            : p
        ));
        break;
      }

      case MessageTypes.FILE_SYNC:
        console.log('📁 FILE_SYNC received:', message.operation, message.path);
        setLastFileOperation({
          odea: message.odea || message.userId,
          displayName: message.displayName,
          operation: message.operation,
          path: message.path,
          newPath: message.newPath,
          itemType: message.itemType,
          timestamp: message.timestamp
        });
        break;

      case MessageTypes.WINDOW_SYNC:
        console.log('🪟 WINDOW_SYNC received:', message.operation, message.windowId, message.windowTitle);
        setLastWindowOperation({
          userId: message.odea || message.userId,
          displayName: message.displayName,
          operation: message.operation,
          windowId: message.windowId,
          windowType: message.windowType,
          windowTitle: message.windowTitle,
          position: message.position,
          size: message.size,
          timestamp: message.timestamp
        });
        break;

      case MessageTypes.ICON_POSITION_UPDATE:
        console.log('📍 ICON_POSITION_UPDATE received:', message.iconId, message.position);
        setLastIconPositionUpdate({
          userId: message.odea || message.userId,
          iconId: message.iconId,
          position: message.position,
          isDragging: message.isDragging,
          timestamp: message.timestamp
        });
        break;

      case MessageTypes.CHAT_MESSAGE: {
        const chatUserId = message.odea || message.userId;
        setChatMessages(prev => [...prev, {
          id: `${chatUserId}-${message.timestamp}`,
          userId: chatUserId,
          displayName: message.displayName,
          avatarUrl: message.avatarUrl,
          color: message.color,
          message: message.message,
          timestamp: message.timestamp
        }]);
        break;
      }

      case MessageTypes.ERROR:
        console.error('❌ Collaboration error:', message.error);
        break;

      default:
        // Handle other message types
        console.log('📨 Unhandled message type:', message.type);
        break;
    }
  }, []); // No dependencies - uses refs for stable access

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // Create a new collaborative session
  const createSession = useCallback(async (containerId: string, name?: string): Promise<CollabSession | null> => {
    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/api/collaboration/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ containerId, name })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Failed to create session:', data.error);
        return null;
      }

      const newSession: CollabSession = {
        id: data.session.id,
        containerId: data.session.containerId,
        name: data.session.name,
        shareToken: data.session.shareToken,
        shareUrl: data.session.shareUrl,
        ownerId: user?.id || '',
        maxParticipants: data.session.maxParticipants,
        permissions: data.session.permissions,
        isActive: true,
        createdAt: data.session.createdAt,
        expiresAt: data.session.expiresAt
      };

      setSession(newSession);

      // Connect to WebSocket if not connected
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connect();
      }

      // Join session via WebSocket (only if not already joined)
      setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN && joinedSessionRef.current !== newSession.id) {
          joinedSessionRef.current = newSession.id;
          wsRef.current.send(JSON.stringify({
            type: MessageTypes.JOIN_SESSION,
            sessionId: newSession.id
          }));
        }
      }, 500);

      return newSession;
    } catch (error) {
      console.error('Error creating session:', error);
      return null;
    }
  }, [getToken, user, connect]);

  // Join an existing session
  const joinSession = useCallback(async (shareToken: string): Promise<boolean> => {
    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/api/collaboration/sessions/${shareToken}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Failed to join session:', data.error);
        return false;
      }

      const joinedSession: CollabSession = {
        id: data.session.id,
        containerId: data.session.containerId || data.session.container_id,
        name: data.session.name,
        shareToken: data.session.shareToken || data.session.share_token,
        shareUrl: `${window.location.origin}/os/join/${data.session.shareToken || data.session.share_token}`,
        ownerId: data.session.ownerId || data.session.owner_id,
        maxParticipants: data.session.maxParticipants || data.session.max_participants,
        permissions: data.session.permissions,
        isActive: data.session.isActive ?? data.session.is_active ?? true,
        createdAt: data.session.createdAt || data.session.created_at,
        expiresAt: data.session.expiresAt || data.session.expires_at
      };

      // Store the shared container ID so ContainerContext can use it
      localStorage.setItem('sharedContainerId', joinedSession.containerId);

      setSession(joinedSession);
      setParticipants(data.session.participants || []);
      setMyColor(data.participant?.color || '#3B82F6');

      // Connect to WebSocket
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connect();
      }

      // Join session via WebSocket (only if not already joined)
      setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN && joinedSessionRef.current !== joinedSession.id) {
          joinedSessionRef.current = joinedSession.id;
          wsRef.current.send(JSON.stringify({
            type: MessageTypes.JOIN_SESSION,
            sessionId: joinedSession.id
          }));
        }
      }, 500);

      return true;
    } catch (error) {
      console.error('Error joining session:', error);
      return false;
    }
  }, [getToken, connect]);

  // Leave current session
  const leaveSession = useCallback(() => {
    if (session && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: MessageTypes.LEAVE_SESSION
      }));
    }

    // Clear shared container access
    localStorage.removeItem('sharedContainerId');

    // Reset joined session tracking
    joinedSessionRef.current = null;

    setSession(null);
    setParticipants([]);
    setChatMessages([]);
    setLastFileOperation(null);
  }, [session]);

  // End session (owner only)
  const endSession = useCallback(async () => {
    if (!session || !isHost) return;

    try {
      const token = getToken();
      await fetch(`${API_BASE}/api/collaboration/sessions/${session.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      leaveSession();
    } catch (error) {
      console.error('Error ending session:', error);
    }
  }, [session, isHost, getToken, leaveSession]);

  // Invite user by email
  const inviteUser = useCallback(async (email: string, message?: string): Promise<{ inviteUrl: string } | null> => {
    if (!session) return null;

    try {
      const token = getToken();
      const response = await fetch(`${API_BASE}/api/collaboration/sessions/${session.id}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ email, message })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Failed to invite user:', data.error);
        return null;
      }

      return { inviteUrl: data.invitation.inviteUrl };
    } catch (error) {
      console.error('Error inviting user:', error);
      return null;
    }
  }, [session, getToken]);

  // Broadcast cursor position (throttled)
  const broadcastCursor = useCallback((x: number, y: number, windowId?: string) => {
    if (!session || wsRef.current?.readyState !== WebSocket.OPEN) return;

    // Throttle cursor updates to ~60fps
    if (cursorThrottleRef.current) return;

    cursorThrottleRef.current = setTimeout(() => {
      cursorThrottleRef.current = null;
    }, 16); // ~60fps

    wsRef.current.send(JSON.stringify({
      type: MessageTypes.CURSOR_MOVE,
      x,
      y,
      windowId
    }));
  }, [session]);

  // Broadcast selection change
  const broadcastSelection = useCallback((selectedItems: string[]) => {
    if (!session || wsRef.current?.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: MessageTypes.SELECTION_CHANGE,
      selection: selectedItems
    }));
  }, [session]);

  // Broadcast file operation
  const broadcastFileOperation = useCallback((operation: FileOperation) => {
    if (!session || wsRef.current?.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: MessageTypes.FILE_OPERATION,
      ...operation
    }));
  }, [session]);

  // Broadcast window operation
  const broadcastWindowOperation = useCallback((operation: any) => {
    if (!session || wsRef.current?.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: MessageTypes.WINDOW_OPERATION,
      ...operation
    }));
  }, [session]);

  // Broadcast icon position (for drag synchronization)
  const iconPositionThrottleRef = useRef<NodeJS.Timeout | null>(null);
  const broadcastIconPosition = useCallback((iconId: string, position: { x: number; y: number }, isDragging: boolean) => {
    if (!session || wsRef.current?.readyState !== WebSocket.OPEN) return;

    // Throttle position updates during drag (~30fps)
    if (isDragging && iconPositionThrottleRef.current) return;

    if (isDragging) {
      iconPositionThrottleRef.current = setTimeout(() => {
        iconPositionThrottleRef.current = null;
      }, 33); // ~30fps
    }

    wsRef.current.send(JSON.stringify({
      type: MessageTypes.ICON_POSITION,
      iconId,
      position,
      isDragging,
      timestamp: new Date().toISOString()
    }));
  }, [session]);

  // Send chat message
  const sendChatMessage = useCallback((message: string) => {
    if (!session || wsRef.current?.readyState !== WebSocket.OPEN || !message.trim()) return;

    wsRef.current.send(JSON.stringify({
      type: MessageTypes.CHAT_MESSAGE,
      message: message.trim()
    }));
  }, [session]);

  // Get participant color
  const getParticipantColor = useCallback((userId: string): string => {
    const participant = participants.find(p => p.odea === userId);
    return participant?.color || '#3B82F6';
  }, [participants]);

  // Clear chat messages
  const clearChat = useCallback(() => {
    setChatMessages([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // Connect when authenticated (but don't re-join if already joined)
  useEffect(() => {
    if (isAuthenticated && session && !wsRef.current) {
      connect();
    }
  }, [isAuthenticated, session, connect]);

  const value: CollaborationContextType = {
    session,
    participants,
    isConnected,
    isHost,
    myParticipant,
    chatMessages,
    lastFileOperation,
    lastWindowOperation,
    lastIconPositionUpdate,
    createSession,
    joinSession,
    leaveSession,
    endSession,
    inviteUser,
    broadcastCursor,
    broadcastSelection,
    broadcastFileOperation,
    broadcastWindowOperation,
    broadcastIconPosition,
    sendChatMessage,
    getParticipantColor,
    clearChat
  };

  return (
    <CollaborationContext.Provider value={value}>
      {children}
    </CollaborationContext.Provider>
  );
};

export const useCollaboration = (): CollaborationContextType => {
  const context = useContext(CollaborationContext);
  if (!context) {
    throw new Error('useCollaboration must be used within a CollaborationProvider');
  }
  return context;
};

export default CollaborationContext;
