// Simple logger utility to control development vs production logging

const isDev = import.meta.env.NODE_ENV === 'development' || import.meta.env.DEV;

export const logger = {
  debug: (...args: any[]) => {
    if (isDev) {
      console.log('[DEBUG]', ...args);
    }
  },
  
  info: (...args: any[]) => {
    if (isDev) {
      console.info('[INFO]', ...args);
    }
  },
  
  warn: (...args: any[]) => {
    console.warn('[WARN]', ...args);
  },
  
  error: (...args: any[]) => {
    console.error('[ERROR]', ...args);
  },
  
  // For service initialization - show only in dev
  service: (serviceName: string, message: string, data?: any) => {
    if (isDev) {
      if (data) {
        console.log(`🔧 ${serviceName}:`, message, data);
      } else {
        console.log(`🔧 ${serviceName}:`, message);
      }
    }
  }
};