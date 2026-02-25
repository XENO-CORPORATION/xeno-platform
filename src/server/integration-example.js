/**
 * Example: How to integrate container provisioning into existing XenoStudio server
 * Add this to your main index.js file
 */

import express from 'express';
import { integrateContainerProvisioning } from './containerIntegration.js';

// Assuming you have an existing Express app
const app = express();

// ... existing middleware and routes ...

// Add container provisioning system
integrateContainerProvisioning(app);

// ... rest of your server setup ...

/*

To integrate into your existing src/server/index.js, add this after line ~70 where you have your existing routes:

```javascript
// Import the container integration
import { integrateContainerProvisioning } from './containerIntegration.js';

// Add this after your existing route definitions
integrateContainerProvisioning(app);
```

This will add all the container provisioning endpoints to your existing server.

The endpoints will be available at:
- GET  /api/containers/pricing
- POST /api/containers/create  
- GET  /api/containers
- PUT  /api/containers/:id/config
- POST /api/containers/:id/start
- POST /api/containers/:id/stop
- DELETE /api/containers/:id
- GET  /api/containers/:id/stats
- GET  /api/containers/health

Make sure to:
1. Install dockerode: npm install dockerode
2. Update your database with the new schema
3. Ensure Docker is running and accessible

*/

console.log('Container provisioning integration example ready!');

export default app;