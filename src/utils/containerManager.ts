/**
 * XenoOS Container Management Utilities
 * Docker SDK integration for dynamic container creation and management
 */

import { ContainerConfig, LanguageConfig, DockerImageConfig, ContainerInstance, ContainerStatus } from '../types/container';

/**
 * Select the appropriate base Docker image based on language requirements
 */
export function selectBaseImage(languages: LanguageConfig): DockerImageConfig {
  const selectedLanguages = Object.entries(languages)
    .filter(([_, enabled]) => enabled)
    .map(([lang]) => lang as keyof LanguageConfig);

  // Define available base images with their characteristics
  const imageConfigs: Record<string, DockerImageConfig> = {
    'ubuntu-minimal': {
      baseImage: 'xenoos/ubuntu-minimal:latest',
      languages: [],
      size: 150, // MB
      buildTime: 30,
      securityScore: 9,
    },
    'nodejs-base': {
      baseImage: 'xenoos/nodejs-base:latest',
      languages: ['nodejs'],
      size: 280, // MB
      buildTime: 45,
      securityScore: 8,
    },
    'python-base': {
      baseImage: 'xenoos/python-base:latest',
      languages: ['python'],
      size: 320, // MB
      buildTime: 60,
      securityScore: 8,
    },
    'multi-lang-light': {
      baseImage: 'xenoos/multi-lang-light:latest',
      languages: ['nodejs', 'python'],
      size: 450, // MB
      buildTime: 90,
      securityScore: 7,
    },
    'go-rust-base': {
      baseImage: 'xenoos/go-rust-base:latest',
      languages: ['go', 'rust'],
      size: 380, // MB
      buildTime: 120,
      securityScore: 8,
    },
    'java-base': {
      baseImage: 'xenoos/java-base:latest',
      languages: ['java'],
      size: 420, // MB
      buildTime: 100,
      securityScore: 7,
    },
    'full-stack': {
      baseImage: 'xenoos/full-stack:latest',
      languages: ['nodejs', 'python', 'go', 'rust', 'java'],
      size: 850, // MB
      buildTime: 180,
      securityScore: 6,
    },
  };

  // Logic to select the best image based on language requirements
  if (selectedLanguages.length === 0) {
    return imageConfigs['ubuntu-minimal'];
  }

  if (selectedLanguages.length === 1) {
    const singleLang = selectedLanguages[0];
    switch (singleLang) {
      case 'nodejs':
        return imageConfigs['nodejs-base'];
      case 'python':
        return imageConfigs['python-base'];
      case 'go':
      case 'rust':
        return imageConfigs['go-rust-base'];
      case 'java':
        return imageConfigs['java-base'];
      default:
        return imageConfigs['ubuntu-minimal'];
    }
  }

  // For multiple languages, find the best fit
  if (selectedLanguages.length === 2 && 
      selectedLanguages.includes('nodejs') && 
      selectedLanguages.includes('python')) {
    return imageConfigs['multi-lang-light'];
  }

  if ((selectedLanguages.includes('go') || selectedLanguages.includes('rust')) &&
      !selectedLanguages.includes('nodejs') &&
      !selectedLanguages.includes('python') &&
      !selectedLanguages.includes('java')) {
    return imageConfigs['go-rust-base'];
  }

  // For complex requirements, use full-stack image
  if (selectedLanguages.length >= 3 || selectedLanguages.includes('java')) {
    return imageConfigs['full-stack'];
  }

  // Default to multi-language light for any other combination
  return imageConfigs['multi-lang-light'];
}

/**
 * Generate Docker container configuration object
 */
export function generateDockerConfig(
  userId: string,
  config: ContainerConfig,
  imageConfig: DockerImageConfig
): any {
  const containerName = `xenoos-${userId}-${Date.now()}`;
  const userStoragePath = `/xenoos/users/${userId}`;
  const sharedStoragePath = `/xenoos/shared`;

  return {
    Image: imageConfig.baseImage,
    name: containerName,
    Hostname: config.name ? config.name.replace(/[^a-zA-Z0-9-]/g, '-') : containerName,
    
    // Resource limits
    HostConfig: {
      Memory: config.memory * 1024 * 1024 * 1024, // GB to bytes
      CpuQuota: config.cpu * 100000, // CPU quota in microseconds
      CpuPeriod: 100000, // 100ms period
      
      // Storage binds
      Binds: [
        `${userStoragePath}:/home/xenostudio-user:rw`,
        `${sharedStoragePath}:/shared:rw`,
        // Add temporary directory
        `/tmp/xenoos-${userId}:/tmp:rw`,
      ],
      
      // Network configuration
      NetworkMode: 'xenostudio-network',
      
      // Security options
      SecurityOpt: [
        'no-new-privileges:true',
        'seccomp:unconfined', // Allow system calls for development
      ],
      
      // Resource constraints
      PidsLimit: 1000, // Limit number of processes
      
      // Auto-remove on stop for development containers
      AutoRemove: false,
      
      // Restart policy
      RestartPolicy: {
        Name: 'unless-stopped',
      },
    },
    
    // Environment variables
    Env: [
      `USER_ID=${userId}`,
      `CONTAINER_ID=${containerName}`,
      `STORAGE_LIMIT=${config.storage}`,
      `MAX_USERS=${config.maxUsers}`,
      `FEATURES=${JSON.stringify(config.languages)}`,
      `REAL_TIME_SYNC=${config.realTimeSync}`,
      `BACKUP_ENABLED=${config.backups}`,
      `ENCRYPTION_ENABLED=${config.encryption}`,
      `PRIORITY_SUPPORT=${config.prioritySupport}`,
      // Development environment variables
      'TERM=xterm-256color',
      'SHELL=/bin/bash',
      'HOME=/home/xenostudio-user',
      'USER=xenostudio-user',
    ],
    
    // Exposed ports for web development
    ExposedPorts: {
      '3000/tcp': {}, // React dev server
      '4000/tcp': {}, // Express server
      '5000/tcp': {}, // Python Flask
      '8000/tcp': {}, // Python Django
      '8080/tcp': {}, // Java Spring Boot
      '9000/tcp': {}, // Go server
      '22/tcp': {},   // SSH (if needed)
    },
    
    // Working directory
    WorkingDir: '/home/xenostudio-user',
    
    // User configuration
    User: 'xenostudio-user',
    
    // Labels for management
    Labels: {
      'xenoos.user.id': userId,
      'xenoos.container.type': 'development',
      'xenoos.container.config': JSON.stringify(config),
      'xenoos.container.created': new Date().toISOString(),
      'xenoos.container.version': '1.0.0',
    },
    
    // Attach stdin/stdout for interactive use
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    OpenStdin: true,
    StdinOnce: false,
  };
}

/**
 * Update container resources dynamically (zero-downtime scaling)
 */
export async function updateContainerResources(
  containerId: string,
  newConfig: ContainerConfig
): Promise<{ success: boolean; message: string }> {
  try {
    // This would integrate with Docker SDK in a real implementation
    // For now, return a mock response
    
    // Calculate new resource limits
    const newLimits = {
      Memory: newConfig.memory * 1024 * 1024 * 1024,
      CpuQuota: newConfig.cpu * 100000,
    };

    // In a real implementation, this would:
    // 1. Get the current container
    // 2. Update resource limits
    // 3. Update environment variables
    // 4. Restart services if necessary

    console.log(`Updating container ${containerId} with new limits:`, newLimits);
    
    return {
      success: true,
      message: 'Container resources updated successfully',
    };
  } catch (error) {
    console.error('Failed to update container resources:', error);
    return {
      success: false,
      message: `Failed to update resources: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Generate port mappings for container services
 */
export function generatePortMappings(userId: string): Record<string, number> {
  // Generate deterministic port ranges based on user ID hash
  const userHash = userId.split('').reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  const basePort = 10000 + Math.abs(userHash % 10000);
  
  return {
    '3000': basePort,     // React dev server
    '4000': basePort + 1, // Express server
    '5000': basePort + 2, // Python Flask
    '8000': basePort + 3, // Python Django
    '8080': basePort + 4, // Java Spring Boot
    '9000': basePort + 5, // Go server
    '22': basePort + 6,   // SSH
  };
}

/**
 * Install language-specific tools and packages
 */
export function generateInstallScript(languages: LanguageConfig): string {
  const scripts: string[] = [
    '#!/bin/bash',
    'set -e',
    '',
    '# Update package manager',
    'apt-get update -y',
    '',
  ];

  // Base development tools
  scripts.push(
    '# Install base development tools',
    'apt-get install -y curl wget git vim nano build-essential',
    ''
  );

  // Language-specific installations
  if (languages.nodejs) {
    scripts.push(
      '# Install Node.js and npm',
      'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -',
      'apt-get install -y nodejs',
      'npm install -g yarn pnpm',
      ''
    );
  }

  if (languages.python) {
    scripts.push(
      '# Install Python and pip',
      'apt-get install -y python3 python3-pip python3-venv',
      'pip3 install --upgrade pip setuptools wheel',
      'pip3 install virtualenv pipenv poetry',
      ''
    );
  }

  if (languages.go) {
    scripts.push(
      '# Install Go',
      'wget https://go.dev/dl/go1.21.5.linux-amd64.tar.gz',
      'tar -C /usr/local -xzf go1.21.5.linux-amd64.tar.gz',
      'echo "export PATH=$PATH:/usr/local/go/bin" >> /etc/profile',
      'rm go1.21.5.linux-amd64.tar.gz',
      ''
    );
  }

  if (languages.rust) {
    scripts.push(
      '# Install Rust',
      'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
      'echo "source /root/.cargo/env" >> /etc/profile',
      ''
    );
  }

  if (languages.java) {
    scripts.push(
      '# Install Java JDK',
      'apt-get install -y openjdk-17-jdk maven gradle',
      'echo "export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64" >> /etc/profile',
      ''
    );
  }

  // Additional development tools
  scripts.push(
    '# Install additional development tools',
    'apt-get install -y htop tree jq sqlite3 postgresql-client',
    '',
    '# Clean up',
    'apt-get clean',
    'rm -rf /var/lib/apt/lists/*',
    '',
    '# Create xenostudio user',
    'useradd -m -s /bin/bash xenostudio-user',
    'usermod -aG sudo xenostudio-user',
    'echo "xenostudio-user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers',
    '',
    'echo "Container setup completed successfully!"'
  );

  return scripts.join('\n');
}

/**
 * Monitor container resource usage
 */
export interface ContainerStats {
  cpu: number;        // CPU usage percentage
  memory: number;     // Memory usage percentage
  memoryUsage: number; // Memory usage in bytes
  memoryLimit: number; // Memory limit in bytes
  networkRx: number;  // Network bytes received
  networkTx: number;  // Network bytes transmitted
  blockRead: number;  // Block I/O read bytes
  blockWrite: number; // Block I/O write bytes
  pids: number;       // Number of processes
}

export async function getContainerStats(containerId: string): Promise<ContainerStats | null> {
  try {
    // This would integrate with Docker SDK in a real implementation
    // Mock stats for now
    return {
      cpu: Math.random() * 100,
      memory: Math.random() * 100,
      memoryUsage: Math.random() * 8 * 1024 * 1024 * 1024, // Random up to 8GB
      memoryLimit: 8 * 1024 * 1024 * 1024, // 8GB limit
      networkRx: Math.random() * 1024 * 1024 * 1024, // Random up to 1GB
      networkTx: Math.random() * 1024 * 1024 * 1024, // Random up to 1GB
      blockRead: Math.random() * 1024 * 1024 * 1024, // Random up to 1GB
      blockWrite: Math.random() * 1024 * 1024 * 1024, // Random up to 1GB
      pids: Math.floor(Math.random() * 100) + 10,
    };
  } catch (error) {
    console.error('Failed to get container stats:', error);
    return null;
  }
}

/**
 * Check container health status
 */
export async function checkContainerHealth(containerId: string): Promise<{
  status: ContainerStatus;
  healthy: boolean;
  message: string;
}> {
  try {
    // This would integrate with Docker SDK in a real implementation
    // Mock health check for now
    const isHealthy = Math.random() > 0.1; // 90% chance of being healthy
    
    return {
      status: isHealthy ? 'running' : 'error',
      healthy: isHealthy,
      message: isHealthy 
        ? 'Container is running normally' 
        : 'Container health check failed',
    };
  } catch (error) {
    console.error('Failed to check container health:', error);
    return {
      status: 'error',
      healthy: false,
      message: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Cleanup unused containers and resources
 */
export async function cleanupUnusedContainers(
  maxIdleTime: number = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
): Promise<{
  cleaned: number;
  saved: number; // Storage saved in GB
}> {
  try {
    // This would integrate with Docker SDK in a real implementation
    // Mock cleanup results
    const cleanedContainers = Math.floor(Math.random() * 5);
    const savedStorage = cleanedContainers * (Math.random() * 10 + 1); // 1-11 GB per container
    
    console.log(`Cleaned up ${cleanedContainers} unused containers, saved ${savedStorage.toFixed(1)}GB`);
    
    return {
      cleaned: cleanedContainers,
      saved: Math.round(savedStorage * 10) / 10,
    };
  } catch (error) {
    console.error('Failed to cleanup containers:', error);
    return {
      cleaned: 0,
      saved: 0,
    };
  }
}