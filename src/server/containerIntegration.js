/**
 * XenoOS Container Integration
 * Adds container provisioning routes to the existing server
 */

import containerRoutes from './routes/containerRoutes.js';
import { databaseMiddleware } from './middleware/database.js';

/**
 * Integrate container provisioning into existing Express app
 */
export function integrateContainerProvisioning(app) {
  console.log('🐳 Integrating container provisioning system...');
  
  // Add database middleware for container routes
  app.use('/api/containers', databaseMiddleware);
  
  // Mount container routes
  app.use('/api/containers', containerRoutes);
  
  // Add container health check endpoint
  app.get('/api/containers/health', (req, res) => {
    res.json({
      success: true,
      status: 'Container service is running',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  });

  console.log('✅ Container provisioning system integrated successfully');
  console.log('🔗 Available endpoints:');
  console.log('  - GET  /api/containers/check-limit - Check container limits');
  console.log('  - GET  /api/containers/pricing - Calculate pricing');
  console.log('  - POST /api/containers/create - Create container');
  console.log('  - GET  /api/containers - List containers');
  console.log('  - PUT  /api/containers/:id/config - Update container');
  console.log('  - POST /api/containers/:id/start - Start container');
  console.log('  - POST /api/containers/:id/stop - Stop container');
  console.log('  - DEL  /api/containers/:id - Delete container');
  console.log('  - GET  /api/containers/:id/stats - Container stats');
  console.log('  - GET  /api/containers/health - Health check');
}

export default integrateContainerProvisioning;