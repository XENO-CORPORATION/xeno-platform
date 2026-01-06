/**
 * XenoOS Container Pricing Calculator
 * Implements the exact pricing model from XENOOS_HYBRID_PLAN.md
 */

import { 
  ContainerConfig, 
  LanguageConfig, 
  PricingBreakdown, 
  CONTAINER_PRICING 
} from '../types/container';

/**
 * Calculate the total monthly price for a container configuration
 * Based on the pricing model: $0.10/GB storage, $3/core CPU, $2.50/GB memory
 */
export function calculateMonthlyPrice(config: ContainerConfig): number {
  const breakdown = calculatePricingBreakdown(config);
  return Math.round(breakdown.total * 100) / 100; // Round to 2 decimal places
}

/**
 * Get detailed pricing breakdown for a container configuration
 */
export function calculatePricingBreakdown(config: ContainerConfig): PricingBreakdown {
  // Base resources calculation
  const storagePrice = config.storage * CONTAINER_PRICING.STORAGE_PER_GB;
  const cpuPrice = config.cpu * CONTAINER_PRICING.CPU_PER_CORE;
  const memoryPrice = config.memory * CONTAINER_PRICING.MEMORY_PER_GB;
  const userPrice = config.maxUsers * CONTAINER_PRICING.USER_SLOT;

  const baseResources = storagePrice + cpuPrice + memoryPrice + userPrice;

  // Language features calculation
  const languageFeatures: Record<keyof LanguageConfig, number> = {
    nodejs: config.languages.nodejs ? CONTAINER_PRICING.LANGUAGES.nodejs : 0,
    python: config.languages.python ? CONTAINER_PRICING.LANGUAGES.python : 0,
    go: config.languages.go ? CONTAINER_PRICING.LANGUAGES.go : 0,
    rust: config.languages.rust ? CONTAINER_PRICING.LANGUAGES.rust : 0,
    java: config.languages.java ? CONTAINER_PRICING.LANGUAGES.java : 0,
  };

  const languagesTotal = Object.values(languageFeatures).reduce((sum, price) => sum + price, 0);

  // Advanced features calculation
  const advancedFeatures = {
    backups: config.backups ? CONTAINER_PRICING.FEATURES.backups : 0,
    encryption: config.encryption ? CONTAINER_PRICING.FEATURES.encryption : 0,
    prioritySupport: config.prioritySupport ? CONTAINER_PRICING.FEATURES.prioritySupport : 0,
  };

  const featuresTotal = Object.values(advancedFeatures).reduce((sum, price) => sum + price, 0);

  // Collaboration is included in user pricing
  const collaborationTotal = 0; // Real-time sync is included

  const total = baseResources + languagesTotal + featuresTotal + collaborationTotal;

  return {
    baseResources,
    languages: languagesTotal,
    features: featuresTotal,
    collaboration: collaborationTotal,
    total,
    breakdown: {
      storage: storagePrice,
      cpu: cpuPrice,
      memory: memoryPrice,
      users: userPrice,
      languageFeatures,
      advancedFeatures,
    },
  };
}

/**
 * Validate container configuration against limits
 */
export function validateContainerConfig(config: ContainerConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const limits = CONTAINER_PRICING.LIMITS;

  // Storage validation
  if (config.storage < limits.MIN_STORAGE) {
    errors.push(`Storage must be at least ${limits.MIN_STORAGE}GB`);
  }
  if (config.storage > limits.MAX_STORAGE) {
    errors.push(`Storage cannot exceed ${limits.MAX_STORAGE}GB`);
  }

  // CPU validation
  if (config.cpu < limits.MIN_CPU) {
    errors.push(`CPU cores must be at least ${limits.MIN_CPU}`);
  }
  if (config.cpu > limits.MAX_CPU) {
    errors.push(`CPU cores cannot exceed ${limits.MAX_CPU}`);
  }

  // Memory validation
  if (config.memory < limits.MIN_MEMORY) {
    errors.push(`Memory must be at least ${limits.MIN_MEMORY}GB`);
  }
  if (config.memory > limits.MAX_MEMORY) {
    errors.push(`Memory cannot exceed ${limits.MAX_MEMORY}GB`);
  }

  // Users validation
  if (config.maxUsers < limits.MIN_USERS) {
    errors.push(`Must allow at least ${limits.MIN_USERS} user`);
  }
  if (config.maxUsers > limits.MAX_USERS) {
    errors.push(`Cannot exceed ${limits.MAX_USERS} users`);
  }

  // At least one language must be selected
  const hasLanguage = Object.values(config.languages).some(Boolean);
  if (!hasLanguage) {
    errors.push('At least one programming language must be selected');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get optimized configuration suggestions based on use case
 */
export function getConfigurationSuggestions(useCase: 'student' | 'developer' | 'team' | 'enterprise'): ContainerConfig {
  const suggestions: Record<typeof useCase, ContainerConfig> = {
    student: {
      storage: 10,
      cpu: 1,
      memory: 2,
      languages: {
        nodejs: true,
        python: true,
        go: false,
        rust: false,
        java: false,
      },
      maxUsers: 1,
      realTimeSync: true,
      backups: false,
      encryption: false,
      prioritySupport: false,
      name: 'Student Development',
      description: 'Perfect for learning and small projects',
    },
    developer: {
      storage: 100,
      cpu: 4,
      memory: 8,
      languages: {
        nodejs: true,
        python: true,
        go: true,
        rust: false,
        java: false,
      },
      maxUsers: 3,
      realTimeSync: true,
      backups: true,
      encryption: false,
      prioritySupport: false,
      name: 'Professional Development',
      description: 'Ideal for professional development work',
    },
    team: {
      storage: 500,
      cpu: 8,
      memory: 16,
      languages: {
        nodejs: true,
        python: true,
        go: true,
        rust: true,
        java: true,
      },
      maxUsers: 10,
      realTimeSync: true,
      backups: true,
      encryption: true,
      prioritySupport: false,
      name: 'Team Collaboration',
      description: 'Built for collaborative team development',
    },
    enterprise: {
      storage: 2000,
      cpu: 16,
      memory: 32,
      languages: {
        nodejs: true,
        python: true,
        go: true,
        rust: true,
        java: true,
      },
      maxUsers: 25,
      realTimeSync: true,
      backups: true,
      encryption: true,
      prioritySupport: true,
      name: 'Enterprise Solution',
      description: 'Full-featured enterprise development environment',
    },
  };

  return suggestions[useCase];
}

/**
 * Calculate price difference between two configurations
 */
export function calculatePriceDifference(
  currentConfig: ContainerConfig,
  newConfig: ContainerConfig
): {
  difference: number;
  isIncrease: boolean;
  percentChange: number;
} {
  const currentPrice = calculateMonthlyPrice(currentConfig);
  const newPrice = calculateMonthlyPrice(newConfig);
  const difference = newPrice - currentPrice;
  const percentChange = currentPrice > 0 ? (difference / currentPrice) * 100 : 0;

  return {
    difference: Math.abs(difference),
    isIncrease: difference > 0,
    percentChange: Math.abs(percentChange),
  };
}

/**
 * Get cost-optimized configuration within a budget
 */
export function optimizeConfigurationForBudget(
  targetBudget: number,
  priorityOrder: ('storage' | 'cpu' | 'memory' | 'users' | 'languages')[] = ['cpu', 'memory', 'storage', 'users', 'languages']
): ContainerConfig {
  // Start with minimum viable configuration
  const config: ContainerConfig = {
    storage: CONTAINER_PRICING.LIMITS.MIN_STORAGE,
    cpu: CONTAINER_PRICING.LIMITS.MIN_CPU,
    memory: CONTAINER_PRICING.LIMITS.MIN_MEMORY,
    languages: {
      nodejs: true, // Always include Node.js
      python: false,
      go: false,
      rust: false,
      java: false,
    },
    maxUsers: CONTAINER_PRICING.LIMITS.MIN_USERS,
    realTimeSync: true,
    backups: false,
    encryption: false,
    prioritySupport: false,
  };

  let currentPrice = calculateMonthlyPrice(config);
  
  // Incrementally add features based on priority and budget
  for (const priority of priorityOrder) {
    if (currentPrice >= targetBudget) break;

    switch (priority) {
      case 'cpu':
        while (config.cpu < CONTAINER_PRICING.LIMITS.MAX_CPU && currentPrice < targetBudget) {
          config.cpu += 1;
          const newPrice = calculateMonthlyPrice(config);
          if (newPrice > targetBudget) {
            config.cpu -= 1;
            break;
          }
          currentPrice = newPrice;
        }
        break;

      case 'memory':
        while (config.memory < CONTAINER_PRICING.LIMITS.MAX_MEMORY && currentPrice < targetBudget) {
          config.memory += 2; // Increment by 2GB
          const newPrice = calculateMonthlyPrice(config);
          if (newPrice > targetBudget) {
            config.memory -= 2;
            break;
          }
          currentPrice = newPrice;
        }
        break;

      case 'storage':
        while (config.storage < CONTAINER_PRICING.LIMITS.MAX_STORAGE && currentPrice < targetBudget) {
          config.storage += 50; // Increment by 50GB
          const newPrice = calculateMonthlyPrice(config);
          if (newPrice > targetBudget) {
            config.storage -= 50;
            break;
          }
          currentPrice = newPrice;
        }
        break;

      case 'users':
        while (config.maxUsers < CONTAINER_PRICING.LIMITS.MAX_USERS && currentPrice < targetBudget) {
          config.maxUsers += 1;
          const newPrice = calculateMonthlyPrice(config);
          if (newPrice > targetBudget) {
            config.maxUsers -= 1;
            break;
          }
          currentPrice = newPrice;
        }
        break;

      case 'languages':
        const languageOrder: (keyof LanguageConfig)[] = ['python', 'go', 'rust', 'java'];
        for (const lang of languageOrder) {
          if (!config.languages[lang] && currentPrice < targetBudget) {
            config.languages[lang] = true;
            const newPrice = calculateMonthlyPrice(config);
            if (newPrice > targetBudget) {
              config.languages[lang] = false;
              break;
            }
            currentPrice = newPrice;
          }
        }
        break;
    }
  }

  // Add premium features if budget allows
  if (currentPrice < targetBudget) {
    const remainingBudget = targetBudget - currentPrice;
    if (remainingBudget >= CONTAINER_PRICING.FEATURES.backups) {
      config.backups = true;
      currentPrice += CONTAINER_PRICING.FEATURES.backups;
    }
    if (remainingBudget >= CONTAINER_PRICING.FEATURES.encryption) {
      config.encryption = true;
      currentPrice += CONTAINER_PRICING.FEATURES.encryption;
    }
    if (remainingBudget >= CONTAINER_PRICING.FEATURES.prioritySupport) {
      config.prioritySupport = true;
    }
  }

  return config;
}

/**
 * Format price for display
 */
export function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

/**
 * Format price breakdown for user display
 */
export function formatPricingBreakdown(breakdown: PricingBreakdown): {
  summary: string;
  details: Array<{ label: string; value: string; included?: boolean }>;
} {
  const details = [
    { label: 'Storage', value: formatPrice(breakdown.breakdown.storage) },
    { label: 'CPU', value: formatPrice(breakdown.breakdown.cpu) },
    { label: 'Memory', value: formatPrice(breakdown.breakdown.memory) },
    { label: 'User Slots', value: formatPrice(breakdown.breakdown.users) },
  ];

  // Add language features
  Object.entries(breakdown.breakdown.languageFeatures).forEach(([lang, price]) => {
    if (price > 0) {
      details.push({ 
        label: `${lang.charAt(0).toUpperCase() + lang.slice(1)} Runtime`, 
        value: formatPrice(price) 
      });
    }
  });

  // Add advanced features
  Object.entries(breakdown.breakdown.advancedFeatures).forEach(([feature, price]) => {
    if (price > 0) {
      const label = feature === 'prioritySupport' ? 'Priority Support' : 
                    feature.charAt(0).toUpperCase() + feature.slice(1);
      details.push({ label, value: formatPrice(price) });
    }
  });

  // Add included features
  details.push({ label: 'Real-time Sync', value: 'Included', included: true });

  return {
    summary: `${formatPrice(breakdown.total)}/month`,
    details,
  };
}