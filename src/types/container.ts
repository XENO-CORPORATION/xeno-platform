/**
 * XenoOS Dynamic Container Provisioning System
 * TypeScript interfaces for container configuration and pricing
 */

// Language pricing and configuration
export interface LanguageConfig {
  nodejs: boolean;    // $3/month
  python: boolean;    // $3/month
  go: boolean;        // $2/month
  rust: boolean;      // $2/month
  java: boolean;      // $4/month
}

// Container resource configuration
export interface ContainerConfig {
  // Basic resources (pay-per-use pricing)
  storage: number;      // GB ($0.10/GB/month)
  cpu: number;          // cores ($3/core/month)
  memory: number;       // GB ($2.50/GB/month)

  // Language runtime features
  languages: LanguageConfig;

  // Collaboration features
  maxUsers: number;     // $2/user/month
  realTimeSync: boolean; // included in base price

  // Advanced features (optional add-ons)
  backups: boolean;     // $5/month
  encryption: boolean;  // $3/month
  prioritySupport: boolean; // $10/month

  // Container metadata
  name?: string;
  description?: string;
  isPublic?: boolean;
}

// Container pricing constants
export const CONTAINER_PRICING = {
  // Base resource costs (per month)
  STORAGE_PER_GB: 0.10,
  CPU_PER_CORE: 3.00,
  MEMORY_PER_GB: 2.50,
  USER_SLOT: 2.00,

  // Language runtime costs
  LANGUAGES: {
    nodejs: 3.00,
    python: 3.00,
    go: 2.00,
    rust: 2.00,
    java: 4.00,
  },

  // Advanced feature costs
  FEATURES: {
    backups: 5.00,
    encryption: 3.00,
    prioritySupport: 10.00,
    realTimeSync: 0.00, // included
  },

  // Resource limits
  LIMITS: {
    MIN_STORAGE: 10,     // GB
    MAX_STORAGE: 2000,   // GB
    MIN_CPU: 1,          // cores
    MAX_CPU: 16,         // cores
    MIN_MEMORY: 2,       // GB
    MAX_MEMORY: 32,      // GB
    MIN_USERS: 1,
    MAX_USERS: 25,
  },
} as const;

// Container status types
export type ContainerStatus = 
  | 'creating' 
  | 'starting' 
  | 'running' 
  | 'stopping' 
  | 'stopped' 
  | 'error' 
  | 'hibernating';

// Container resource usage metrics
export interface ContainerResourceUsage {
  containerId: string;
  cpu: number;          // percentage
  memory: number;       // percentage
  storage: number;      // GB used
  networkIn: number;    // MB
  networkOut: number;   // MB
  uptime: number;       // seconds
  lastUpdated: Date;
}

// Container instance data
export interface ContainerInstance {
  id: string;
  userId: string;
  name: string;
  status: ContainerStatus;
  config: ContainerConfig;
  dockerContainerId?: string;
  ipAddress?: string;
  ports?: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
  lastStartedAt?: Date;
  totalRuntime: number; // seconds
  currentUsage?: ContainerResourceUsage;
}

// Container operation result
export interface ContainerOperationResult {
  success: boolean;
  containerId?: string;
  message: string;
  error?: string;
  data?: any;
}

// Billing subscription for containers
export interface ContainerSubscription {
  id: string;
  userId: string;
  containerId: string;
  config: ContainerConfig;
  monthlyPrice: number;
  status: 'active' | 'cancelled' | 'suspended';
  createdAt: Date;
  nextBillingDate: Date;
  paymentMethodId?: string;
}

// Usage metrics for billing
export interface UsageMetric {
  id: string;
  userId: string;
  containerId: string;
  metricType: 'cpu_usage' | 'memory_usage' | 'storage_usage' | 'network_usage' | 'uptime';
  value: number;
  unit: string;
  recordedAt: Date;
}

// Configuration wizard step data
export interface ConfigurationWizardStep {
  name: string;
  title: string;
  description: string;
  fields: ConfigurationField[];
}

export interface ConfigurationField {
  name: keyof ContainerConfig;
  type: 'slider' | 'select' | 'checkbox' | 'toggle' | 'input';
  label: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: any; label: string; price?: number }>;
  price: number;
  unit?: string;
  required?: boolean;
  defaultValue?: any;
}

// Pre-defined container configurations
export interface ContainerTemplate {
  id: string;
  name: string;
  description: string;
  category: 'development' | 'education' | 'enterprise' | 'custom';
  config: ContainerConfig;
  estimatedPrice: number;
  popularity: number;
  tags: string[];
}

// Docker image selection based on languages
export interface DockerImageConfig {
  baseImage: string;
  languages: (keyof LanguageConfig)[];
  size: number; // MB
  buildTime: number; // seconds
  securityScore: number; // 1-10
}

// Container creation request
export interface CreateContainerRequest {
  config: ContainerConfig;
  templateId?: string;
  autoStart?: boolean;
}

// Container update request
export interface UpdateContainerRequest {
  containerId: string;
  config: Partial<ContainerConfig>;
  applyImmediately?: boolean;
}

// Pricing calculation result
export interface PricingBreakdown {
  baseResources: number;
  languages: number;
  features: number;
  collaboration: number;
  total: number;
  breakdown: {
    storage: number;
    cpu: number;
    memory: number;
    users: number;
    languageFeatures: Record<keyof LanguageConfig, number>;
    advancedFeatures: {
      backups: number;
      encryption: number;
      prioritySupport: number;
    };
  };
}

// API response types
export interface ContainerApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ContainerListResponse {
  containers: ContainerInstance[];
  total: number;
  page: number;
  limit: number;
}

export interface ContainerCreationResponse {
  container: ContainerInstance;
  subscription: ContainerSubscription;
  estimatedStartTime: number; // seconds
}