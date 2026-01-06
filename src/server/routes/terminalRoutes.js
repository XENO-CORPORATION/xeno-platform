/**
 * XenoOS Terminal API Routes
 * REST API endpoints for terminal and container management
 */

const express = require('express');
const router = express.Router();
const ContainerIntegration = require('../terminal/containerIntegration');

// Initialize container integration
const containerIntegration = new ContainerIntegration();

/**
 * Create a new terminal container
 * POST /api/terminal/container
 */
router.post('/container', async (req, res) => {
  try {
    const { userId, config } = req.body;

    if (!userId || !config) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: userId, config'
      });
    }

    // Validate configuration
    if (!config.storage || !config.memory || !config.cpu || !config.languages) {
      return res.status(400).json({
        success: false,
        error: 'Invalid configuration: missing storage, memory, cpu, or languages'
      });
    }

    const result = await containerIntegration.createTerminalContainer(userId, config);

    res.json({
      success: true,
      data: result,
      message: 'Terminal container created successfully'
    });

  } catch (error) {
    console.error('Error creating terminal container:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to create terminal container'
    });
  }
});

/**
 * Get container information
 * GET /api/terminal/container/:containerId
 */
router.get('/container/:containerId', async (req, res) => {
  try {
    const { containerId } = req.params;
    const result = await containerIntegration.getContainerInfo(containerId);

    if (result.success) {
      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.status(404).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Error getting container info:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Update container configuration
 * PUT /api/terminal/container/:containerId
 */
router.put('/container/:containerId', async (req, res) => {
  try {
    const { containerId } = req.params;
    const { config } = req.body;

    if (!config) {
      return res.status(400).json({
        success: false,
        error: 'Missing configuration data'
      });
    }

    const result = await containerIntegration.updateContainerConfig(containerId, config);

    res.json({
      success: true,
      data: result,
      message: 'Container configuration updated successfully'
    });

  } catch (error) {
    console.error('Error updating container config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Delete container
 * DELETE /api/terminal/container/:containerId
 */
router.delete('/container/:containerId', async (req, res) => {
  try {
    const { containerId } = req.params;
    const result = await containerIntegration.removeContainer(containerId);

    res.json({
      success: true,
      data: result,
      message: 'Container removed successfully'
    });

  } catch (error) {
    console.error('Error removing container:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * List user containers
 * GET /api/terminal/user/:userId/containers
 */
router.get('/user/:userId/containers', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await containerIntegration.listUserContainers(userId);

    res.json({
      success: result.success,
      data: {
        containers: result.containers || [],
        totalCount: result.containers?.length || 0
      },
      error: result.error
    });

  } catch (error) {
    console.error('Error listing user containers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get container status
 * GET /api/terminal/container/:containerId/status
 */
router.get('/container/:containerId/status', async (req, res) => {
  try {
    const { containerId } = req.params;
    const isRunning = await containerIntegration.isContainerRunning(containerId);

    res.json({
      success: true,
      data: {
        containerId,
        status: isRunning ? 'running' : 'stopped',
        isRunning,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error checking container status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Execute command in container
 * POST /api/terminal/container/:containerId/exec
 */
router.post('/container/:containerId/exec', async (req, res) => {
  try {
    const { containerId } = req.params;
    const { command, workingDir } = req.body;

    if (!command) {
      return res.status(400).json({
        success: false,
        error: 'Command is required'
      });
    }

    const result = await containerIntegration.executeCommand(containerId, command, workingDir);

    res.json({
      success: result.success,
      data: {
        output: result.output,
        command,
        workingDir: workingDir || '/home/xenolabs-user',
        timestamp: new Date().toISOString()
      },
      error: result.error
    });

  } catch (error) {
    console.error('Error executing command:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get container resource statistics
 * GET /api/terminal/container/:containerId/stats
 */
router.get('/container/:containerId/stats', async (req, res) => {
  try {
    const { containerId } = req.params;
    const container = containerIntegration.docker.getContainer(containerId);
    const stats = await containerIntegration.getContainerStats(container);

    if (stats) {
      res.json({
        success: true,
        data: stats
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Container not found or stats unavailable'
      });
    }

  } catch (error) {
    console.error('Error getting container stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Stream container logs
 * GET /api/terminal/container/:containerId/logs
 */
router.get('/container/:containerId/logs', async (req, res) => {
  try {
    const { containerId } = req.params;
    const { tail = 100, follow = false } = req.query;

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    const container = containerIntegration.docker.getContainer(containerId);
    
    const logStream = await container.logs({
      stdout: true,
      stderr: true,
      tail: parseInt(tail),
      follow: follow === 'true',
      timestamps: true
    });

    logStream.on('data', (chunk) => {
      const log = chunk.toString('utf8');
      res.write(`data: ${JSON.stringify({ message: log, timestamp: new Date().toISOString() })}\n\n`);
    });

    logStream.on('end', () => {
      res.write(`data: ${JSON.stringify({ type: 'end', message: 'Log stream ended' })}\n\n`);
      res.end();
    });

    logStream.on('error', (error) => {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    });

    // Clean up on client disconnect
    req.on('close', () => {
      logStream.destroy();
    });

  } catch (error) {
    console.error('Error streaming container logs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get available container templates
 * GET /api/terminal/templates
 */
router.get('/templates', async (req, res) => {
  try {
    const templates = [
      {
        id: 'minimal',
        name: 'Minimal Development',
        description: 'Basic Ubuntu with essential tools',
        config: {
          storage: 20,
          cpu: 1,
          memory: 2,
          maxUsers: 1,
          languages: {
            nodejs: false,
            python: false,
            go: false,
            rust: false,
            java: false
          },
          backups: false,
          encryption: false,
          prioritySupport: false
        },
        estimatedPrice: 8.5
      },
      {
        id: 'web-dev',
        name: 'Web Development',
        description: 'Node.js and Python for full-stack web development',
        config: {
          storage: 100,
          cpu: 2,
          memory: 4,
          maxUsers: 2,
          languages: {
            nodejs: true,
            python: true,
            go: false,
            rust: false,
            java: false
          },
          backups: true,
          encryption: false,
          prioritySupport: false
        },
        estimatedPrice: 25.5
      },
      {
        id: 'full-stack',
        name: 'Full Stack Development',
        description: 'All languages and tools for comprehensive development',
        config: {
          storage: 250,
          cpu: 4,
          memory: 8,
          maxUsers: 5,
          languages: {
            nodejs: true,
            python: true,
            go: true,
            rust: true,
            java: true
          },
          backups: true,
          encryption: true,
          prioritySupport: false
        },
        estimatedPrice: 72.5
      },
      {
        id: 'enterprise',
        name: 'Enterprise Development',
        description: 'High-performance setup with all features for teams',
        config: {
          storage: 500,
          cpu: 8,
          memory: 16,
          maxUsers: 10,
          languages: {
            nodejs: true,
            python: true,
            go: true,
            rust: true,
            java: true
          },
          backups: true,
          encryption: true,
          prioritySupport: true
        },
        estimatedPrice: 143.5
      }
    ];

    res.json({
      success: true,
      data: {
        templates,
        totalTemplates: templates.length
      }
    });

  } catch (error) {
    console.error('Error getting container templates:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Health check for terminal service
 * GET /api/terminal/health
 */
router.get('/health', async (req, res) => {
  try {
    // Check Docker connection
    const info = await containerIntegration.docker.info();
    
    res.json({
      success: true,
      status: 'healthy',
      data: {
        docker: {
          connected: true,
          version: info.ServerVersion,
          containers: info.Containers,
          images: info.Images
        },
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;