/**
 * XenoOS Container Integration for Terminal Server
 * Integrates terminal server with Docker container provisioning system
 */

const Docker = require('dockerode');
const fs = require('fs').promises;
const path = require('path');

class ContainerIntegration {
  constructor() {
    this.docker = new Docker();
    this.containerConfigs = new Map();
    this.terminalContainerImage = process.env.TERMINAL_CONTAINER_IMAGE || 'xenoos/ubuntu-dev:latest';
  }

  /**
   * Create a new container optimized for terminal access
   */
  async createTerminalContainer(userId, config) {
    try {
      console.log('Creating terminal container for user:', userId);

      // Generate container name
      const containerName = `xenoos-terminal-${userId}-${Date.now()}`;
      
      // Prepare environment variables
      const env = [
        `USER_ID=${userId}`,
        `STORAGE_LIMIT=${config.storage}GB`,
        `MAX_USERS=${config.maxUsers}`,
        `FEATURES=${JSON.stringify(config.languages)}`,
        'TERM=xterm-256color',
        'SHELL=/bin/bash',
        'HOME=/home/xenostudio-user'
      ];

      // Prepare port bindings for development servers
      const portBindings = {};
      const exposedPorts = {};
      
      // Common development ports
      const devPorts = [3000, 3001, 4000, 5000, 8000, 8080, 9000];
      devPorts.forEach(port => {
        exposedPorts[`${port}/tcp`] = {};
        portBindings[`${port}/tcp`] = [{ HostPort: '0' }]; // Dynamic port allocation
      });

      // Prepare volume mounts
      const binds = [
        `xenoos-user-${userId}:/home/xenostudio-user:rw`,
        `xenoos-shared-${userId}:/shared:rw`
      ];

      // Container configuration
      const containerConfig = {
        Image: this.terminalContainerImage,
        name: containerName,
        Env: env,
        WorkingDir: '/home/xenostudio-user',
        User: 'xenostudio-user',
        Cmd: ['/bin/bash', '-l'],
        ExposedPorts: exposedPorts,
        HostConfig: {
          Memory: config.memory * 1024 * 1024 * 1024, // GB to bytes
          MemorySwap: config.memory * 1024 * 1024 * 1024 * 2, // 2x memory for swap
          CpuQuota: config.cpu * 100000, // CPU cores to quota
          CpuPeriod: 100000,
          PortBindings: portBindings,
          Binds: binds,
          RestartPolicy: {
            Name: 'unless-stopped'
          },
          SecurityOpt: [
            'no-new-privileges:true',
            'seccomp=unconfined' // Allow terminal features
          ],
          CapAdd: ['SYS_PTRACE'], // Required for debugging
          Ulimits: [
            {
              Name: 'nofile',
              Soft: 65536,
              Hard: 65536
            }
          ]
        },
        NetworkingConfig: {
          EndpointsConfig: {
            bridge: {
              Aliases: [containerName]
            }
          }
        },
        Labels: {
          'xenoos.user': userId,
          'xenoos.type': 'terminal',
          'xenoos.config': JSON.stringify(config),
          'xenoos.created': new Date().toISOString()
        }
      };

      // Create the container
      const container = await this.docker.createContainer(containerConfig);
      console.log('Container created:', container.id);

      // Store configuration
      this.containerConfigs.set(container.id, {
        userId,
        config,
        containerName,
        createdAt: new Date()
      });

      // Start the container
      await container.start();
      console.log('Container started:', container.id);

      // Setup development environment based on selected languages
      await this.setupDevelopmentEnvironment(container, config.languages);

      // Get container info for port mappings
      const containerInfo = await container.inspect();
      const portMappings = this.extractPortMappings(containerInfo);

      return {
        success: true,
        containerId: container.id,
        containerName,
        portMappings,
        config,
        status: 'running'
      };

    } catch (error) {
      console.error('Error creating terminal container:', error);
      throw error;
    }
  }

  /**
   * Setup development environment in container
   */
  async setupDevelopmentEnvironment(container, languages) {
    try {
      console.log('Setting up development environment...');

      const setupCommands = [];

      // Update package manager
      setupCommands.push('apt-get update');

      // Install selected languages and tools
      if (languages.nodejs) {
        setupCommands.push(
          'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -',
          'apt-get install -y nodejs',
          'npm install -g npm@latest yarn pnpm'
        );
      }

      if (languages.python) {
        setupCommands.push(
          'apt-get install -y python3 python3-pip python3-venv python3-dev',
          'pip3 install --upgrade pip setuptools wheel',
          'pip3 install virtualenv pipenv poetry'
        );
      }

      if (languages.go) {
        setupCommands.push(
          'wget -q https://go.dev/dl/go1.21.0.linux-amd64.tar.gz',
          'tar -C /usr/local -xzf go1.21.0.linux-amd64.tar.gz',
          'echo "export PATH=$PATH:/usr/local/go/bin" >> /home/xenostudio-user/.bashrc',
          'rm go1.21.0.linux-amd64.tar.gz'
        );
      }

      if (languages.rust) {
        setupCommands.push(
          'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
          'echo "source ~/.cargo/env" >> /home/xenostudio-user/.bashrc'
        );
      }

      if (languages.java) {
        setupCommands.push(
          'apt-get install -y openjdk-17-jdk maven gradle',
          'echo "export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64" >> /home/xenostudio-user/.bashrc'
        );
      }

      // Install common development tools
      setupCommands.push(
        'apt-get install -y git curl wget vim nano htop tree jq unzip zip',
        'apt-get install -y build-essential gcc g++ make cmake',
        'apt-get clean',
        'chown -R xenostudio-user:xenostudio-user /home/xenostudio-user'
      );

      // Execute setup commands
      for (const command of setupCommands) {
        const exec = await container.exec({
          Cmd: ['bash', '-c', command],
          AttachStdout: true,
          AttachStderr: true
        });

        const stream = await exec.start({ Detach: false });
        
        await new Promise((resolve, reject) => {
          stream.on('end', resolve);
          stream.on('error', reject);
        });
      }

      console.log('Development environment setup completed');

    } catch (error) {
      console.error('Error setting up development environment:', error);
      // Don't throw error, as container can still work without full setup
    }
  }

  /**
   * Extract port mappings from container info
   */
  extractPortMappings(containerInfo) {
    const portMappings = {};
    
    if (containerInfo.NetworkSettings && containerInfo.NetworkSettings.Ports) {
      Object.entries(containerInfo.NetworkSettings.Ports).forEach(([containerPort, hostBindings]) => {
        if (hostBindings && hostBindings.length > 0) {
          const port = containerPort.replace('/tcp', '');
          portMappings[port] = parseInt(hostBindings[0].HostPort);
        }
      });
    }

    return portMappings;
  }

  /**
   * Get container status and information
   */
  async getContainerInfo(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      const containerInfo = await container.inspect();
      const config = this.containerConfigs.get(containerId);

      return {
        success: true,
        data: {
          id: containerId,
          name: containerInfo.Name.replace('/', ''),
          status: containerInfo.State.Status,
          created: containerInfo.Created,
          started: containerInfo.State.StartedAt,
          config: config?.config,
          portMappings: this.extractPortMappings(containerInfo),
          stats: await this.getContainerStats(container)
        }
      };
    } catch (error) {
      console.error('Error getting container info:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get container resource usage statistics
   */
  async getContainerStats(container) {
    try {
      const stats = await container.stats({ stream: false });
      
      // Calculate CPU percentage
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage?.total_usage || 0);
      const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage || 0);
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;

      // Calculate memory usage
      const memoryUsage = stats.memory_stats.usage || 0;
      const memoryLimit = stats.memory_stats.limit || 0;
      const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

      // Network statistics
      const networks = stats.networks || {};
      let networkRx = 0, networkTx = 0;
      Object.values(networks).forEach(network => {
        networkRx += network.rx_bytes || 0;
        networkTx += network.tx_bytes || 0;
      });

      return {
        cpu: {
          usage: Math.round(cpuPercent * 100) / 100,
          percent: Math.round(cpuPercent * 100) / 100
        },
        memory: {
          usage: memoryUsage,
          limit: memoryLimit,
          percent: Math.round(memoryPercent * 100) / 100,
          usageMB: Math.round((memoryUsage / 1024 / 1024) * 100) / 100,
          limitMB: Math.round((memoryLimit / 1024 / 1024) * 100) / 100
        },
        network: {
          rx: networkRx,
          tx: networkTx,
          rxMB: Math.round((networkRx / 1024 / 1024) * 100) / 100,
          txMB: Math.round((networkTx / 1024 / 1024) * 100) / 100
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting container stats:', error);
      return null;
    }
  }

  /**
   * Update container configuration (upgrade/downgrade)
   */
  async updateContainerConfig(containerId, newConfig) {
    try {
      const container = this.docker.getContainer(containerId);
      const currentConfig = this.containerConfigs.get(containerId);

      if (!currentConfig) {
        throw new Error('Container configuration not found');
      }

      console.log('Updating container configuration:', containerId);

      // Update memory and CPU limits
      await container.update({
        Memory: newConfig.memory * 1024 * 1024 * 1024,
        MemorySwap: newConfig.memory * 1024 * 1024 * 1024 * 2,
        CpuQuota: newConfig.cpu * 100000,
        CpuPeriod: 100000
      });

      // Update stored configuration
      this.containerConfigs.set(containerId, {
        ...currentConfig,
        config: newConfig,
        updatedAt: new Date()
      });

      // If languages changed, update development environment
      const currentLangs = currentConfig.config.languages;
      const newLangs = newConfig.languages;
      
      if (JSON.stringify(currentLangs) !== JSON.stringify(newLangs)) {
        await this.setupDevelopmentEnvironment(container, newLangs);
      }

      return {
        success: true,
        message: 'Container configuration updated successfully'
      };

    } catch (error) {
      console.error('Error updating container config:', error);
      throw error;
    }
  }

  /**
   * Stop and remove container
   */
  async removeContainer(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      
      console.log('Stopping container:', containerId);
      await container.stop({ t: 10 }); // 10 second timeout

      console.log('Removing container:', containerId);
      await container.remove({ force: true });

      // Clean up configuration
      this.containerConfigs.delete(containerId);

      return {
        success: true,
        message: 'Container removed successfully'
      };

    } catch (error) {
      console.error('Error removing container:', error);
      throw error;
    }
  }

  /**
   * List all terminal containers for a user
   */
  async listUserContainers(userId) {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: [`xenoos.user=${userId}`, 'xenoos.type=terminal']
        }
      });

      const containerInfos = await Promise.all(
        containers.map(async (containerData) => {
          const info = await this.getContainerInfo(containerData.Id);
          return info.success ? info.data : null;
        })
      );

      return {
        success: true,
        containers: containerInfos.filter(info => info !== null)
      };

    } catch (error) {
      console.error('Error listing user containers:', error);
      return {
        success: false,
        error: error.message,
        containers: []
      };
    }
  }

  /**
   * Check if container exists and is running
   */
  async isContainerRunning(containerId) {
    try {
      const container = this.docker.getContainer(containerId);
      const containerInfo = await container.inspect();
      return containerInfo.State.Status === 'running';
    } catch (error) {
      return false;
    }
  }

  /**
   * Execute command in container
   */
  async executeCommand(containerId, command, workingDir = '/home/xenostudio-user') {
    try {
      const container = this.docker.getContainer(containerId);
      
      const exec = await container.exec({
        Cmd: ['bash', '-c', command],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: workingDir
      });

      const stream = await exec.start({ Detach: false });
      
      return new Promise((resolve, reject) => {
        let output = '';
        
        stream.on('data', (data) => {
          output += data.toString();
        });

        stream.on('end', () => {
          resolve({
            success: true,
            output: output.trim()
          });
        });

        stream.on('error', (error) => {
          reject({
            success: false,
            error: error.message
          });
        });
      });

    } catch (error) {
      console.error('Error executing command:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = ContainerIntegration;