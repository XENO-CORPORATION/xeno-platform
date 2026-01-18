/**
 * XenoOS Container Provisioning API Routes
 * Implements dynamic container provisioning with exact pricing model
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import Docker from 'dockerode';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Initialize Docker SDK - use TCP on Windows, socket on Linux
let docker;
if (process.env.DOCKER_HOST) {
  // When DOCKER_HOST is set, use TCP connection
  console.log('Connecting to Docker via TCP at host.docker.internal:2375');
  docker = new Docker({ host: 'host.docker.internal', port: 2375, version: 'v1.41' });
} else {
  // Use default socket connection
  console.log('Connecting to Docker via socket');
  docker = new Docker();
}

// Import utility functions (these would be compiled from TypeScript)
// For now, implementing them directly in JavaScript

// Pricing constants
const CONTAINER_PRICING = {
  STORAGE_PER_GB: 0.10,
  CPU_PER_CORE: 3.00,
  MEMORY_PER_GB: 2.50,
  USER_SLOT: 2.00,
  LANGUAGES: {
    nodejs: 3.00,
    python: 3.00,
    go: 2.00,
    rust: 2.00,
    java: 4.00,
  },
  FEATURES: {
    backups: 5.00,
    encryption: 3.00,
    prioritySupport: 10.00,
    realTimeSync: 0.00,
  },
  LIMITS: {
    MIN_STORAGE: 10,
    MAX_STORAGE: 2000,
    MIN_CPU: 1,
    MAX_CPU: 16,
    MIN_MEMORY: 2,
    MAX_MEMORY: 32,
    MIN_USERS: 1,
    MAX_USERS: 25,
  },
};

// Calculate monthly price for container configuration
function calculateMonthlyPrice(config) {
  const baseResources = 
    (config.storage * CONTAINER_PRICING.STORAGE_PER_GB) +
    (config.cpu * CONTAINER_PRICING.CPU_PER_CORE) +
    (config.memory * CONTAINER_PRICING.MEMORY_PER_GB) +
    (config.maxUsers * CONTAINER_PRICING.USER_SLOT);

  const languageFeatures = Object.entries(config.languages)
    .filter(([_, enabled]) => enabled)
    .reduce((sum, [lang]) => sum + (CONTAINER_PRICING.LANGUAGES[lang] || 0), 0);

  const advancedFeatures =
    (config.backups ? CONTAINER_PRICING.FEATURES.backups : 0) +
    (config.encryption ? CONTAINER_PRICING.FEATURES.encryption : 0) +
    (config.prioritySupport ? CONTAINER_PRICING.FEATURES.prioritySupport : 0);

  return Math.round((baseResources + languageFeatures + advancedFeatures) * 100) / 100;
}

// Select base Docker image based on language requirements
function selectBaseImage(languages) {
  const selectedLanguages = Object.entries(languages)
    .filter(([_, enabled]) => enabled)
    .map(([lang]) => lang);

  const imageConfigs = {
    'ubuntu-minimal': {
      baseImage: 'ubuntu:20.04',
      languages: [],
      size: 150,
      buildTime: 30,
    },
    'nodejs-base': {
      baseImage: 'node:20-alpine',
      languages: ['nodejs'],
      size: 280,
      buildTime: 45,
    },
    'python-base': {
      baseImage: 'python:3.11-slim',
      languages: ['python'],
      size: 320,
      buildTime: 60,
    },
    'multi-lang-light': {
      baseImage: 'node:20-alpine',
      languages: ['nodejs', 'python'],
      size: 450,
      buildTime: 90,
    },
    'full-stack': {
      baseImage: 'ubuntu:20.04',
      languages: ['nodejs', 'python', 'go', 'rust', 'java'],
      size: 850,
      buildTime: 180,
    },
  };

  if (selectedLanguages.length === 0) {
    return imageConfigs['ubuntu-minimal'];
  }
  if (selectedLanguages.length === 1) {
    const singleLang = selectedLanguages[0];
    return imageConfigs[`${singleLang}-base`] || imageConfigs['ubuntu-minimal'];
  }
  if (selectedLanguages.length >= 3 || selectedLanguages.includes('java')) {
    return imageConfigs['full-stack'];
  }
  return imageConfigs['multi-lang-light'];
}

// Validate container configuration
function validateContainerConfig(config) {
  const errors = [];
  const limits = CONTAINER_PRICING.LIMITS;

  if (config.storage < limits.MIN_STORAGE) {
    errors.push(`Storage must be at least ${limits.MIN_STORAGE}GB`);
  }
  if (config.storage > limits.MAX_STORAGE) {
    errors.push(`Storage cannot exceed ${limits.MAX_STORAGE}GB`);
  }
  if (config.cpu < limits.MIN_CPU) {
    errors.push(`CPU cores must be at least ${limits.MIN_CPU}`);
  }
  if (config.cpu > limits.MAX_CPU) {
    errors.push(`CPU cores cannot exceed ${limits.MAX_CPU}`);
  }
  if (config.memory < limits.MIN_MEMORY) {
    errors.push(`Memory must be at least ${limits.MIN_MEMORY}GB`);
  }
  if (config.memory > limits.MAX_MEMORY) {
    errors.push(`Memory cannot exceed ${limits.MAX_MEMORY}GB`);
  }
  if (config.maxUsers < limits.MIN_USERS) {
    errors.push(`Must allow at least ${limits.MIN_USERS} user`);
  }
  if (config.maxUsers > limits.MAX_USERS) {
    errors.push(`Cannot exceed ${limits.MAX_USERS} users`);
  }

  const hasLanguage = Object.values(config.languages).some(Boolean);
  if (!hasLanguage) {
    errors.push('At least one programming language must be selected');
  }

  return { valid: errors.length === 0, errors };
}

// Generate port mappings for container
function generatePortMappings(userId) {
  const userHash = userId.split('').reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  const basePort = 10000 + Math.abs(userHash % 10000);
  
  return {
    '3000': basePort,
    '4000': basePort + 1,
    '5000': basePort + 2,
    '8000': basePort + 3,
    '8080': basePort + 4,
    '9000': basePort + 5,
    '22': basePort + 6,
  };
}

// GET /api/containers/check-limit - Check if user has reached container limit
router.get('/check-limit', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id; // Get user ID from authenticated user

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    // Check if user already has a container
    const existingContainerQuery = `
      SELECT c.*, bs.monthly_price, bs.status as subscription_status
      FROM containers c
      LEFT JOIN billing_subscriptions bs ON c.user_id = bs.user_id
      WHERE c.user_id = $1 AND c.status != $2
      ORDER BY c.created_at DESC
      LIMIT 1
    `;
    
    const existingContainerResult = await req.db.query(existingContainerQuery, [userId, 'deleted']);
    const hasExistingContainer = existingContainerResult.rows.length > 0;

    res.json({
      success: true,
      data: {
        hasExistingContainer,
        canCreateNewContainer: !hasExistingContainer,
        existingContainer: hasExistingContainer ? existingContainerResult.rows[0] : null,
        limit: {
          maxContainers: 1,
          currentContainers: hasExistingContainer ? 1 : 0,
        },
      },
    });

  } catch (error) {
    console.error('Container limit check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check container limit',
      message: error.message,
    });
  }
});

// GET /api/containers/pricing - Calculate pricing for configuration
router.get('/pricing', (req, res) => {
  try {
    const config = {
      storage: parseInt(req.query.storage) || 10,
      cpu: parseInt(req.query.cpu) || 1,
      memory: parseInt(req.query.memory) || 2,
      maxUsers: parseInt(req.query.maxUsers) || 1,
      languages: {
        nodejs: req.query.nodejs === 'true',
        python: req.query.python === 'true',
        go: req.query.go === 'true',
        rust: req.query.rust === 'true',
        java: req.query.java === 'true',
      },
      backups: req.query.backups === 'true',
      encryption: req.query.encryption === 'true',
      prioritySupport: req.query.prioritySupport === 'true',
      realTimeSync: true,
    };

    const validation = validateContainerConfig(config);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid configuration',
        errors: validation.errors,
      });
    }

    const monthlyPrice = calculateMonthlyPrice(config);
    const imageConfig = selectBaseImage(config.languages);

    res.json({
      success: true,
      data: {
        config,
        monthlyPrice,
        imageConfig,
        estimatedStartTime: imageConfig.buildTime,
      },
    });
  } catch (error) {
    console.error('Pricing calculation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate pricing',
      message: error.message,
    });
  }
});

// POST /api/containers/create - Create new container
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { config, autoStart = true, containerName = 'My Container' } = req.body;
    const userId = req.user.id; // Get user ID from authenticated user

    // Validate that we have an authenticated user
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    // Check if user already has a container (one container per user limit)
    const existingContainerQuery = 'SELECT COUNT(*) FROM containers WHERE user_id = $1 AND status != $2';
    const existingContainerResult = await req.db.query(existingContainerQuery, [userId, 'deleted']);
    const existingContainerCount = parseInt(existingContainerResult.rows[0].count);

    if (existingContainerCount > 0) {
      return res.status(400).json({
        success: false,
        error: 'User already has a container. Only one container per account is allowed.',
        code: 'CONTAINER_LIMIT_EXCEEDED',
      });
    }

    // Validate configuration
    const validation = validateContainerConfig(config);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid configuration',
        errors: validation.errors,
      });
    }

    // Calculate pricing
    const monthlyPrice = calculateMonthlyPrice(config);
    const imageConfig = selectBaseImage(config.languages);

    // Generate container configuration
    const containerId = uuidv4();
    // Use provided hostname or generate one
    const hostname = containerName ? containerName.toLowerCase().replace(/[^a-z0-9-]/g, '-') : `xenoos-${userId}-${Date.now()}`;
    const dockerContainerName = `xenoos-${userId}-${Date.now()}`;
    const userStoragePath = `/xenoos/users/${userId}`;
    const sharedStoragePath = `/xenoos/shared`;
    const portMappings = generatePortMappings(userId);

    const dockerConfig = {
      Image: imageConfig.baseImage,
      name: dockerContainerName,
      Hostname: hostname,

      // Volume definitions for X:/Z: separation
      Volumes: {
        '/xenoos/system': {},      // System Volume (X:) - read-only system files
        '/xenoos/userdata': {},    // Cloud Volume (Z:) - user's purchased storage
      },

      HostConfig: {
        // Memory constraint (in bytes)
        Memory: config.memory * 1024 * 1024 * 1024,

        // CPU constraints
        CpuQuota: config.cpu * 100000,
        CpuPeriod: 100000,

        // Storage constraint for user data volume only
        StorageOpt: {
          'size': `${config.storage}G`  // This applies to user data volume
        },

        // Enhanced volume binds with proper X:/Z: separation
        Binds: [
          // Cloud Volume (Z:) - User's purchased storage space
          `${userStoragePath}:/xenoos/userdata:rw`,
          `${userStoragePath}:/home/user:rw`,  // Symlink to userdata for compatibility

          // System Volume (X:) - Container system files (read-only for safety)
          `/xenoos/system-${userId}:/xenoos/system:ro`,

          // Shared storage and temp
          `${sharedStoragePath}:/shared:rw`,
          `/tmp/xenoos-${userId}:/tmp:rw`,
        ],
        
        NetworkMode: 'xeno-platform_xenolabs-network',
        
        PortBindings: Object.fromEntries(
          Object.entries(portMappings).map(([internal, external]) => [
            `${internal}/tcp`,
            [{ HostPort: external.toString() }]
          ])
        ),
        
        RestartPolicy: { Name: 'unless-stopped' },
        
        SecurityOpt: [
          'no-new-privileges:true',
          'seccomp:unconfined',
        ],
        
        // Process limit to prevent fork bombs
        PidsLimit: Math.min(config.maxUsers * 500, 2000),
        
        // Additional resource constraints
        ShmSize: 64 * 1024 * 1024, // 64MB shared memory
        Ulimits: [
          {
            Name: 'nofile',
            Soft: 1024,
            Hard: 2048
          },
          {
            Name: 'nproc',
            Soft: config.maxUsers * 100,
            Hard: config.maxUsers * 200
          }
        ],
      },
      
      Env: [
        `USER_ID=${userId}`,
        `CONTAINER_ID=${containerId}`,
        `STORAGE_LIMIT=${config.storage}`,
        `MAX_USERS=${config.maxUsers}`,
        `FEATURES=${JSON.stringify(config.languages)}`,
        `REAL_TIME_SYNC=${config.realTimeSync}`,
        `BACKUP_ENABLED=${config.backups}`,
        `ENCRYPTION_ENABLED=${config.encryption}`,
        `PRIORITY_SUPPORT=${config.prioritySupport}`,
        'TERM=xterm-256color',
        'SHELL=/bin/bash',
        'HOME=/root',
        'USER=root',
      ],
      
      ExposedPorts: Object.fromEntries(
        Object.keys(portMappings).map(port => [`${port}/tcp`, {}])
      ),
      
      WorkingDir: '/root',
      User: 'root',
      
      Labels: {
        'xenoos.user.id': userId,
        'xenoos.container.type': 'development',
        'xenoos.container.config': JSON.stringify(config),
        'xenoos.container.created': new Date().toISOString(),
        'xenoos.container.version': '1.0.0',
      },
      
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      OpenStdin: true,
    };

    // Save container to database
    const insertContainerQuery = `
      INSERT INTO containers (id, user_id, container_name, display_name, status, config, resource_limits, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `;
    
    const containerResult = await req.db.query(insertContainerQuery, [
      containerId,
      userId,
      dockerContainerName,
      containerName, // This is the user-provided display name
      'creating',
      config,
      {
        storage_gb: config.storage,
        cpu_cores: config.cpu,
        memory_gb: config.memory,
        max_users: config.maxUsers,
      },
    ]);

    // Create billing subscription
    const insertSubscriptionQuery = `
      INSERT INTO billing_subscriptions (id, user_id, plan_name, status, config, monthly_price, next_billing_date, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `;

    const subscriptionResult = await req.db.query(insertSubscriptionQuery, [
      uuidv4(),
      userId,
      config.name || 'Custom Container',
      'active',
      config,
      monthlyPrice,
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    ]);

    // Create Docker container
    try {
      const container = await docker.createContainer(dockerConfig);
      const dockerContainerId = container.id;

      // Update container record with Docker ID
      await req.db.query(
        'UPDATE containers SET status = $1, docker_container_id = $2, updated_at = NOW() WHERE id = $3',
        ['created', dockerContainerId, containerId]
      );

      // Start container if requested
      if (autoStart) {
        await container.start();
        await req.db.query(
          'UPDATE containers SET status = $1, last_started_at = NOW(), updated_at = NOW() WHERE id = $2',
          ['running', containerId]
        );
      }

      res.status(201).json({
        success: true,
        data: {
          container: {
            id: containerId,
            name: containerName, // User-provided display name
            dockerName: dockerContainerName, // Docker container name
            dockerId: dockerContainerId,
            status: autoStart ? 'running' : 'created',
            config,
            portMappings,
            monthlyPrice,
            createdAt: new Date().toISOString(),
          },
          subscription: subscriptionResult.rows[0],
          estimatedStartTime: imageConfig.buildTime,
        },
        message: `Container ${autoStart ? 'created and started' : 'created'} successfully`,
      });

    } catch (dockerError) {
      console.error('Docker container creation failed:', dockerError);
      
      // Update database status
      await req.db.query(
        'UPDATE containers SET status = $1, updated_at = NOW() WHERE id = $2',
        ['error', containerId]
      );

      res.status(500).json({
        success: false,
        error: 'Failed to create Docker container',
        message: dockerError.message,
        containerId,
      });
    }

  } catch (error) {
    console.error('Container creation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create container',
      message: error.message,
    });
  }
});

// GET /api/containers - List user containers
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id; // Get user ID from authenticated user
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const query = `
      SELECT c.*, bs.monthly_price, bs.status as subscription_status
      FROM containers c
      LEFT JOIN billing_subscriptions bs ON c.user_id = bs.user_id
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const countQuery = 'SELECT COUNT(*) FROM containers WHERE user_id = $1';

    const [containerResult, countResult] = await Promise.all([
      req.db.query(query, [userId, limit, offset]),
      req.db.query(countQuery, [userId]),
    ]);

    const containers = containerResult.rows;
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: {
        containers,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });

  } catch (error) {
    console.error('Container list error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch containers',
      message: error.message,
    });
  }
});

// PUT /api/containers/:id/config - Update container configuration
router.put('/:id/config', async (req, res) => {
  try {
    const { id: containerId } = req.params;
    const { newConfig, applyImmediately = false } = req.body;

    // Get current container
    const containerQuery = 'SELECT * FROM containers WHERE id = $1';
    const containerResult = await req.db.query(containerQuery, [containerId]);
    
    if (containerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Container not found',
      });
    }

    const currentContainer = containerResult.rows[0];
    const currentConfig = currentContainer.config;
    const mergedConfig = { ...currentConfig, ...newConfig };

    // Validate new configuration
    const validation = validateContainerConfig(mergedConfig);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid configuration',
        errors: validation.errors,
      });
    }

    // Calculate price difference
    const currentPrice = calculateMonthlyPrice(currentConfig);
    const newPrice = calculateMonthlyPrice(mergedConfig);
    const priceDifference = newPrice - currentPrice;

    // Update container configuration
    const updateQuery = `
      UPDATE containers 
      SET config = $1, resource_limits = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `;

    const updatedContainer = await req.db.query(updateQuery, [
      mergedConfig,
      {
        storage_gb: mergedConfig.storage,
        cpu_cores: mergedConfig.cpu,
        memory_gb: mergedConfig.memory,
        max_users: mergedConfig.maxUsers,
      },
      containerId,
    ]);

    // Update subscription pricing
    await req.db.query(
      'UPDATE billing_subscriptions SET monthly_price = $1, config = $2, updated_at = NOW() WHERE user_id = $3',
      [newPrice, mergedConfig, currentContainer.user_id]
    );

    // Apply changes to running container if requested
    if (applyImmediately && currentContainer.docker_container_id) {
      try {
        const dockerContainer = docker.getContainer(currentContainer.docker_container_id);
        
        // Update container resources with full constraint support
        const updateData = {
          Memory: mergedConfig.memory * 1024 * 1024 * 1024,
          CpuQuota: mergedConfig.cpu * 100000,
          CpuPeriod: 100000,
          PidsLimit: Math.min(mergedConfig.maxUsers * 500, 2000),
          // Note: Storage limits cannot be changed on running containers
          // They require container recreation
        };

        await dockerContainer.update(updateData);

        // Update status
        await req.db.query(
          'UPDATE containers SET status = $1, updated_at = NOW() WHERE id = $2',
          ['running', containerId]
        );

      } catch (dockerError) {
        console.error('Failed to update running container:', dockerError);
        // Continue anyway - the database is updated
      }
    }

    res.json({
      success: true,
      data: {
        container: updatedContainer.rows[0],
        pricing: {
          previousPrice: currentPrice,
          newPrice,
          difference: Math.abs(priceDifference),
          isIncrease: priceDifference > 0,
        },
      },
      message: 'Container configuration updated successfully',
    });

  } catch (error) {
    console.error('Container update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update container',
      message: error.message,
    });
  }
});

// POST /api/containers/:id/start - Start container
router.post('/:id/start', async (req, res) => {
  try {
    const { id: containerId } = req.params;

    // Get container info
    const containerQuery = 'SELECT * FROM containers WHERE id = $1';
    const containerResult = await req.db.query(containerQuery, [containerId]);
    
    if (containerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Container not found',
      });
    }

    const containerData = containerResult.rows[0];

    if (!containerData.docker_container_id) {
      return res.status(400).json({
        success: false,
        error: 'Container has no Docker ID',
      });
    }

    // Start Docker container
    const dockerContainer = docker.getContainer(containerData.docker_container_id);
    await dockerContainer.start();

    // Update database
    await req.db.query(
      'UPDATE containers SET status = $1, last_started_at = NOW(), updated_at = NOW() WHERE id = $2',
      ['running', containerId]
    );

    res.json({
      success: true,
      data: {
        containerId,
        status: 'running',
        startedAt: new Date().toISOString(),
      },
      message: 'Container started successfully',
    });

  } catch (error) {
    console.error('Container start error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start container',
      message: error.message,
    });
  }
});

// POST /api/containers/:id/stop - Stop container
router.post('/:id/stop', async (req, res) => {
  try {
    const { id: containerId } = req.params;

    // Get container info
    const containerQuery = 'SELECT * FROM containers WHERE id = $1';
    const containerResult = await req.db.query(containerQuery, [containerId]);
    
    if (containerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Container not found',
      });
    }

    const containerData = containerResult.rows[0];

    if (!containerData.docker_container_id) {
      return res.status(400).json({
        success: false,
        error: 'Container has no Docker ID',
      });
    }

    // Stop Docker container
    const dockerContainer = docker.getContainer(containerData.docker_container_id);
    await dockerContainer.stop();

    // Update database
    await req.db.query(
      'UPDATE containers SET status = $1, updated_at = NOW() WHERE id = $2',
      ['stopped', containerId]
    );

    res.json({
      success: true,
      data: {
        containerId,
        status: 'stopped',
        stoppedAt: new Date().toISOString(),
      },
      message: 'Container stopped successfully',
    });

  } catch (error) {
    console.error('Container stop error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop container',
      message: error.message,
    });
  }
});

// DELETE /api/containers/:id - Delete container
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id: containerId } = req.params;
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    // Get container info and verify ownership
    const containerQuery = 'SELECT * FROM containers WHERE id = $1 AND user_id = $2';
    const containerResult = await req.db.query(containerQuery, [containerId, userId]);
    
    if (containerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Container not found',
      });
    }

    const containerData = containerResult.rows[0];

    // Remove Docker container if it exists
    if (containerData.docker_container_id) {
      try {
        const dockerContainer = docker.getContainer(containerData.docker_container_id);
        await dockerContainer.remove({ force: true });
      } catch (dockerError) {
        console.warn('Failed to remove Docker container:', dockerError.message);
        // Continue with database cleanup
      }
    }

    // Delete from database
    await req.db.query('DELETE FROM containers WHERE id = $1', [containerId]);

    // Cancel subscription
    await req.db.query(
      'UPDATE billing_subscriptions SET status = $1, updated_at = NOW() WHERE user_id = $2',
      ['cancelled', containerData.user_id]
    );

    res.json({
      success: true,
      message: 'Container deleted successfully',
    });

  } catch (error) {
    console.error('Container delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete container',
      message: error.message,
    });
  }
});

// POST /api/containers/:id/exec - Execute commands in container
router.post('/:id/exec', authMiddleware, async (req, res) => {
  try {
    const { id: containerId } = req.params;
    const { commands } = req.body;
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!commands || !Array.isArray(commands) || commands.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Commands array is required',
      });
    }

    // Get container info
    const containerQuery = 'SELECT * FROM containers WHERE id = $1';
    const containerResult = await req.db.query(containerQuery, [containerId]);

    if (containerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Container not found',
      });
    }

    const containerData = containerResult.rows[0];

    // Check if user owns container OR has collaboration access
    const isOwner = containerData.user_id === userId;
    if (!isOwner) {
      const collabAccess = await req.db.query(
        `SELECT p.* FROM os_session_participants p
         JOIN os_collaborative_sessions s ON p.session_id = s.id
         WHERE s.container_id = $1 AND p.user_id = $2 AND p.is_active = true AND s.is_active = true`,
        [containerId, userId]
      );

      if (collabAccess.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Container not found or access denied',
        });
      }
    }

    if (!containerData.docker_container_id || containerData.status !== 'running') {
      return res.status(400).json({
        success: false,
        error: 'Container is not running',
      });
    }

    // Execute commands in Docker container
    const dockerContainer = docker.getContainer(containerData.docker_container_id);
    const results = [];

    for (const command of commands) {
      try {
        console.log(`Executing command in container ${containerId}: ${command}`);
        
        const exec = await dockerContainer.exec({
          Cmd: ['sh', '-c', command],
          AttachStdout: true,
          AttachStderr: true,
        });

        const stream = await exec.start({ Detach: false, Tty: false });
        
        // Collect output
        let output = '';
        stream.on('data', (chunk) => {
          // Docker streams have 8-byte headers: 4 bytes for stream type, 4 bytes for length
          // Stream type: 0=stdin, 1=stdout, 2=stderr
          if (chunk.length >= 8) {
            const streamType = chunk[0];
            const payloadLength = chunk.readUInt32BE(4);
            console.log(`📊 Docker stream - Type: ${streamType}, Length: ${payloadLength}, Chunk size: ${chunk.length}`);

            // Extract the actual payload
            const payload = chunk.slice(8, Math.min(8 + payloadLength, chunk.length));
            output += payload.toString('utf8');
          } else {
            // If chunk is smaller than header, it might be incomplete
            console.log(`⚠️ Small chunk received: ${chunk.length} bytes`);
            output += chunk.toString('utf8');
          }
        });

        // Wait for command to complete
        await new Promise((resolve) => {
          stream.on('end', resolve);
        });

        results.push(output.trim());
        
      } catch (cmdError) {
        console.error(`Command execution failed: ${command}`, cmdError);
        results.push(`ERROR: ${cmdError.message}`);
      }
    }

    res.json({
      success: true,
      data: {
        containerId,
        commands,
        results,
        timestamp: new Date().toISOString(),
      },
    });

  } catch (error) {
    console.error('Container exec error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute commands in container',
      message: error.message,
    });
  }
});

// GET /api/containers/:id - Get container by ID (for collaboration access)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id: containerId } = req.params;
    const userId = req.user.id;

    // Get container info
    const containerQuery = 'SELECT * FROM containers WHERE id = $1';
    const containerResult = await req.db.query(containerQuery, [containerId]);

    if (containerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Container not found',
      });
    }

    const containerData = containerResult.rows[0];

    // Check if user owns this container OR has collaboration access
    const isOwner = containerData.user_id === userId;

    if (!isOwner) {
      // Check if user has collaboration access to this container
      const collabAccess = await req.db.query(
        `SELECT p.* FROM os_session_participants p
         JOIN os_collaborative_sessions s ON p.session_id = s.id
         WHERE s.container_id = $1 AND p.user_id = $2 AND p.is_active = true AND s.is_active = true`,
        [containerId, userId]
      );

      if (collabAccess.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this container',
        });
      }
    }

    res.json({
      success: true,
      container: {
        id: containerData.id,
        name: containerData.name,
        display_name: containerData.display_name,
        status: containerData.status,
        resource_limits: containerData.resource_limits,
        isShared: !isOwner
      }
    });
  } catch (error) {
    console.error('Error getting container:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get container',
      message: error.message,
    });
  }
});

// GET /api/containers/:id/stats - Get container statistics
router.get('/:id/stats', async (req, res) => {
  try {
    const { id: containerId } = req.params;

    // Get container info
    const containerQuery = 'SELECT * FROM containers WHERE id = $1';
    const containerResult = await req.db.query(containerQuery, [containerId]);
    
    if (containerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Container not found',
      });
    }

    const containerData = containerResult.rows[0];

    if (!containerData.docker_container_id || containerData.status !== 'running') {
      return res.status(400).json({
        success: false,
        error: 'Container is not running',
      });
    }

    // Get Docker container stats
    const dockerContainer = docker.getContainer(containerData.docker_container_id);
    const stats = await dockerContainer.stats({ stream: false });

    // Calculate usage percentages
    const cpuPercent = calculateCPUPercent(stats);
    const memoryPercent = (stats.memory_stats.usage / stats.memory_stats.limit) * 100;

    const usage = {
      cpu: Math.round(cpuPercent * 100) / 100,
      memory: Math.round(memoryPercent * 100) / 100,
      memoryUsage: stats.memory_stats.usage,
      memoryLimit: stats.memory_stats.limit,
      networkRx: stats.networks?.eth0?.rx_bytes || 0,
      networkTx: stats.networks?.eth0?.tx_bytes || 0,
      blockRead: stats.blkio_stats.io_service_bytes_recursive?.[0]?.value || 0,
      blockWrite: stats.blkio_stats.io_service_bytes_recursive?.[1]?.value || 0,
      pids: stats.pids_stats?.current || 0,
    };

    res.json({
      success: true,
      data: {
        containerId,
        usage,
        timestamp: new Date().toISOString(),
      },
    });

  } catch (error) {
    console.error('Container stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get container statistics',
      message: error.message,
    });
  }
});

// Helper function to calculate CPU percentage
function calculateCPUPercent(stats) {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage -
                  (stats.precpu_stats.cpu_usage?.total_usage || 0);
  const systemDelta = stats.cpu_stats.system_cpu_usage -
                     (stats.precpu_stats.system_cpu_usage || 0);

  if (systemDelta > 0 && cpuDelta > 0) {
    return (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;
  }
  return 0;
}

// GET /api/containers/:containerId/storage - Get storage usage for X:/Z: volumes
router.get('/:containerId/storage', authMiddleware, async (req, res) => {
  try {
    const { containerId } = req.params;
    const userId = req.user.id;

    console.log(`📊 Getting storage usage for container ${containerId}`);

    // Get container info
    const containerResult = await req.db.query(
      'SELECT * FROM containers WHERE id = $1',
      [containerId]
    );

    if (containerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Container not found',
      });
    }

    const container = containerResult.rows[0];

    // Check if user owns container OR has collaboration access
    const isOwner = container.user_id === userId;
    if (!isOwner) {
      const collabAccess = await req.db.query(
        `SELECT p.* FROM os_session_participants p
         JOIN os_collaborative_sessions s ON p.session_id = s.id
         WHERE s.container_id = $1 AND p.user_id = $2 AND p.is_active = true AND s.is_active = true`,
        [containerId, userId]
      );

      if (collabAccess.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Container not found or access denied',
        });
      }
    }

    if (!container.docker_container_id) {
      return res.status(400).json({
        success: false,
        error: 'Container has no Docker ID',
      });
    }

    // Get Docker container instance
    const dockerContainer = docker.getContainer(container.docker_container_id);

    try {
      // Execute commands to get storage usage for both volumes
      const commands = [
        // Get Cloud Volume (Z:) usage - user data
        'du -sb /xenoos/userdata 2>/dev/null || echo "0 /xenoos/userdata"',
        // Get System Volume (X:) usage - system files
        'du -sb /xenoos/system 2>/dev/null || echo "0 /xenoos/system"',
        // Get total container disk usage
        'df -B1 / | tail -1 | awk \'{print $2 " " $3 " " $4}\'',
        // Get user directory breakdown
        'find /xenoos/userdata -maxdepth 2 -type d -exec du -sb {} + 2>/dev/null | head -20'
      ];

      const execResults = [];
      for (const command of commands) {
        const exec = await dockerContainer.exec({
          Cmd: ['sh', '-c', command],
          AttachStdout: true,
          AttachStderr: true,
        });

        const stream = await exec.start({ Detach: false });
        const output = await new Promise((resolve) => {
          let data = '';
          stream.on('data', (chunk) => {
            data += chunk.toString();
          });
          stream.on('end', () => {
            resolve(data.trim());
          });
        });

        execResults.push(output);
      }

      // Parse results
      const [cloudVolumeRaw, systemVolumeRaw, diskStatsRaw, userDirsRaw] = execResults;

      // Parse Cloud Volume (Z:) usage
      const cloudUsageMatch = cloudVolumeRaw.match(/^(\d+)/);
      const cloudVolumeUsedBytes = cloudUsageMatch ? parseInt(cloudUsageMatch[1]) : 0;
      const cloudVolumeUsedGB = (cloudVolumeUsedBytes / (1024 * 1024 * 1024)).toFixed(2);

      // Parse System Volume (X:) usage
      const systemUsageMatch = systemVolumeRaw.match(/^(\d+)/);
      const systemVolumeUsedBytes = systemUsageMatch ? parseInt(systemUsageMatch[1]) : 0;
      const systemVolumeUsedGB = (systemVolumeUsedBytes / (1024 * 1024 * 1024)).toFixed(2);

      // Parse disk stats
      const diskParts = diskStatsRaw.split(' ');
      const totalDiskBytes = parseInt(diskParts[0]) || 0;
      const usedDiskBytes = parseInt(diskParts[1]) || 0;
      const availableDiskBytes = parseInt(diskParts[2]) || 0;

      // Parse user directories
      const userDirectories = [];
      if (userDirsRaw) {
        const dirLines = userDirsRaw.split('\n');
        for (const line of dirLines) {
          const match = line.match(/^(\d+)\s+(.+)$/);
          if (match) {
            const sizeBytes = parseInt(match[1]);
            const path = match[2];
            const sizeGB = (sizeBytes / (1024 * 1024 * 1024)).toFixed(3);
            const dirName = path.split('/').pop() || path;

            userDirectories.push({
              name: dirName,
              path: path,
              sizeBytes: sizeBytes,
              sizeGB: parseFloat(sizeGB)
            });
          }
        }
      }

      // Calculate storage metrics
      const purchasedStorageGB = container.resources?.storage_gb || 0;
      const cloudVolumeUsagePercent = purchasedStorageGB > 0
        ? ((cloudVolumeUsedGB / purchasedStorageGB) * 100).toFixed(1)
        : 0;

      const storageData = {
        // Cloud Volume (Z:) - User's purchased storage
        cloudVolume: {
          name: 'Cloud Volume (Z:)',
          description: 'Your personal storage space',
          purchasedGB: purchasedStorageGB,
          usedBytes: cloudVolumeUsedBytes,
          usedGB: parseFloat(cloudVolumeUsedGB),
          availableGB: Math.max(0, purchasedStorageGB - parseFloat(cloudVolumeUsedGB)),
          usagePercent: parseFloat(cloudVolumeUsagePercent),
          userDirectories: userDirectories
        },
        // System Volume (X:) - Container system files
        systemVolume: {
          name: 'System Volume (X:)',
          description: 'Container system files and OS',
          usedBytes: systemVolumeUsedBytes,
          usedGB: parseFloat(systemVolumeUsedGB),
          isSystemVolume: true
        },
        // Overall container stats
        containerStats: {
          totalDiskBytes: totalDiskBytes,
          usedDiskBytes: usedDiskBytes,
          availableDiskBytes: availableDiskBytes,
          totalDiskGB: (totalDiskBytes / (1024 * 1024 * 1024)).toFixed(2),
          usedDiskGB: (usedDiskBytes / (1024 * 1024 * 1024)).toFixed(2),
          availableDiskGB: (availableDiskBytes / (1024 * 1024 * 1024)).toFixed(2)
        }
      };

      console.log('📊 Storage usage calculated:', storageData);

      res.json({
        success: true,
        data: storageData
      });

    } catch (execError) {
      console.error('❌ Error executing storage commands:', execError);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve storage usage from container'
      });
    }

  } catch (error) {
    console.error('❌ Error getting storage usage:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get storage usage'
    });
  }
});

export default router;