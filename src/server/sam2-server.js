import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import FormData from 'form-data';

// ES Module setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const PORT = process.env.SAM2_PORT || 4002;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Create uploads directory for temporary files
const uploadsDir = path.join(__dirname, 'sam2-uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniquePrefix = Date.now();
    cb(null, `${uniquePrefix}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'SAM2 Server', timestamp: new Date().toISOString() });
});

// SAM 2 Point-based Segmentation
app.post('/api/sam2/segment-points', async (req, res) => {
  console.log('🎯 SAM2 Point-based segmentation request received');
  
  try {
    const { imageData, points, outputFormat = 'mask' } = req.body;
    
    if (!imageData || !points) {
      return res.status(400).json({ 
        error: 'Missing required parameters: imageData and points are required' 
      });
    }

    // Validate points structure
    if (!points.positive || !Array.isArray(points.positive)) {
      return res.status(400).json({ 
        error: 'Invalid points structure: positive points array is required' 
      });
    }

    console.log(`🎯 Processing ${points.positive.length} positive points, ${points.negative?.length || 0} negative points`);

    // Convert base64 image to buffer
    let imageBuffer;
    if (imageData.startsWith('data:')) {
      const base64Data = imageData.split(',')[1];
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      imageBuffer = Buffer.from(imageData, 'base64');
    }

    // Create temporary file
    const tempImagePath = path.join(uploadsDir, `temp-${Date.now()}.png`);
    fs.writeFileSync(tempImagePath, imageBuffer);

    // Prepare form data for SAM 2 API
    const formData = new FormData();
    formData.append('image', fs.createReadStream(tempImagePath));
    formData.append('points', JSON.stringify(points));
    formData.append('output_format', outputFormat);

    // Call SAM 2 API (replace with actual SAM 2 endpoint)
    const sam2ApiUrl = process.env.SAM2_API_URL || 'https://api.segment-anything.com/v2/segment';
    const sam2ApiKey = process.env.SAM2_API_KEY;

    const headers = {
      ...formData.getHeaders()
    };

    if (sam2ApiKey) {
      headers['Authorization'] = `Bearer ${sam2ApiKey}`;
    }

    console.log('🎯 Calling SAM 2 API for point-based segmentation...');
    const response = await fetch(sam2ApiUrl, {
      method: 'POST',
      headers: headers,
      body: formData
    });

    // Clean up temporary file
    fs.unlinkSync(tempImagePath);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('🚨 SAM 2 API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'SAM 2 API error',
        details: errorText
      });
    }

    const result = await response.json();
    console.log('✅ SAM 2 point-based segmentation successful');

    res.json({
      success: true,
      masks: result.masks || [],
      processingTime: result.processing_time || 0,
      model: 'sam2'
    });

  } catch (error) {
    console.error('🚨 Error in SAM 2 point-based segmentation:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// SAM 2 Box-based Segmentation
app.post('/api/sam2/segment-box', async (req, res) => {
  console.log('📦 SAM2 Box-based segmentation request received');
  
  try {
    const { imageData, box, outputFormat = 'mask' } = req.body;
    
    if (!imageData || !box) {
      return res.status(400).json({ 
        error: 'Missing required parameters: imageData and box are required' 
      });
    }

    // Validate box structure [x1, y1, x2, y2]
    if (!Array.isArray(box) || box.length !== 4) {
      return res.status(400).json({ 
        error: 'Invalid box format: expected [x1, y1, x2, y2]' 
      });
    }

    console.log(`📦 Processing box: [${box.join(', ')}]`);

    // Convert base64 image to buffer
    let imageBuffer;
    if (imageData.startsWith('data:')) {
      const base64Data = imageData.split(',')[1];
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      imageBuffer = Buffer.from(imageData, 'base64');
    }

    // Create temporary file
    const tempImagePath = path.join(uploadsDir, `temp-${Date.now()}.png`);
    fs.writeFileSync(tempImagePath, imageBuffer);

    // Prepare form data for SAM 2 API
    const formData = new FormData();
    formData.append('image', fs.createReadStream(tempImagePath));
    formData.append('box', JSON.stringify(box));
    formData.append('output_format', outputFormat);

    // Call SAM 2 API
    const sam2ApiUrl = process.env.SAM2_BOX_API_URL || 'https://api.segment-anything.com/v2/segment-box';
    const sam2ApiKey = process.env.SAM2_API_KEY;

    const headers = {
      ...formData.getHeaders()
    };

    if (sam2ApiKey) {
      headers['Authorization'] = `Bearer ${sam2ApiKey}`;
    }

    console.log('📦 Calling SAM 2 API for box-based segmentation...');
    const response = await fetch(sam2ApiUrl, {
      method: 'POST',
      headers: headers,
      body: formData
    });

    // Clean up temporary file
    fs.unlinkSync(tempImagePath);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('🚨 SAM 2 API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'SAM 2 API error',
        details: errorText
      });
    }

    const result = await response.json();
    console.log('✅ SAM 2 box-based segmentation successful');

    res.json({
      success: true,
      masks: result.masks || [],
      processingTime: result.processing_time || 0,
      model: 'sam2'
    });

  } catch (error) {
    console.error('🚨 Error in SAM 2 box-based segmentation:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// SAM 2 Auto Segmentation (Segment Everything)
app.post('/api/sam2/auto-segment', async (req, res) => {
  console.log('🤖 SAM2 Auto segmentation request received');
  
  try {
    const { imageData, outputFormat = 'masks' } = req.body;
    
    if (!imageData) {
      return res.status(400).json({ 
        error: 'Missing required parameter: imageData is required' 
      });
    }

    console.log('🤖 Processing auto segmentation (segment everything)');

    // Convert base64 image to buffer
    let imageBuffer;
    if (imageData.startsWith('data:')) {
      const base64Data = imageData.split(',')[1];
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      imageBuffer = Buffer.from(imageData, 'base64');
    }

    // Create temporary file
    const tempImagePath = path.join(uploadsDir, `temp-${Date.now()}.png`);
    fs.writeFileSync(tempImagePath, imageBuffer);

    // Prepare form data for SAM 2 API
    const formData = new FormData();
    formData.append('image', fs.createReadStream(tempImagePath));
    formData.append('output_format', outputFormat);

    // Call SAM 2 API
    const sam2ApiUrl = process.env.SAM2_AUTO_API_URL || 'https://api.segment-anything.com/v2/auto-segment';
    const sam2ApiKey = process.env.SAM2_API_KEY;

    const headers = {
      ...formData.getHeaders()
    };

    if (sam2ApiKey) {
      headers['Authorization'] = `Bearer ${sam2ApiKey}`;
    }

    console.log('🤖 Calling SAM 2 API for auto segmentation...');
    const response = await fetch(sam2ApiUrl, {
      method: 'POST',
      headers: headers,
      body: formData
    });

    // Clean up temporary file
    fs.unlinkSync(tempImagePath);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('🚨 SAM 2 API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'SAM 2 API error',
        details: errorText
      });
    }

    const result = await response.json();
    console.log(`✅ SAM 2 auto segmentation successful - found ${result.masks?.length || 0} segments`);

    res.json({
      success: true,
      masks: result.masks || [],
      processingTime: result.processing_time || 0,
      model: 'sam2'
    });

  } catch (error) {
    console.error('🚨 Error in SAM 2 auto segmentation:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// SAM 2 Batch Processing (multiple images)
app.post('/api/sam2/batch-segment', upload.array('images', 10), async (req, res) => {
  console.log('📚 SAM2 Batch segmentation request received');
  
  try {
    const { mode = 'auto', points, boxes } = req.body;
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        error: 'No images provided for batch processing' 
      });
    }

    console.log(`📚 Processing ${req.files.length} images in batch mode: ${mode}`);

    const results = [];
    
    for (const file of req.files) {
      try {
        // Prepare form data for each image
        const formData = new FormData();
        formData.append('image', fs.createReadStream(file.path));
        formData.append('mode', mode);
        
        if (mode === 'points' && points) {
          formData.append('points', points);
        }
        
        if (mode === 'box' && boxes) {
          formData.append('box', boxes);
        }

        // Call SAM 2 API for each image
        const sam2ApiUrl = process.env.SAM2_BATCH_API_URL || 'https://api.segment-anything.com/v2/batch-segment';
        const sam2ApiKey = process.env.SAM2_API_KEY;

        const headers = {
          ...formData.getHeaders()
        };

        if (sam2ApiKey) {
          headers['Authorization'] = `Bearer ${sam2ApiKey}`;
        }

        const response = await fetch(sam2ApiUrl, {
          method: 'POST',
          headers: headers,
          body: formData
        });

        if (response.ok) {
          const result = await response.json();
          results.push({
            filename: file.originalname,
            success: true,
            masks: result.masks || [],
            processingTime: result.processing_time || 0
          });
        } else {
          const errorText = await response.text();
          results.push({
            filename: file.originalname,
            success: false,
            error: errorText
          });
        }

        // Clean up temporary file
        fs.unlinkSync(file.path);

      } catch (error) {
        results.push({
          filename: file.originalname,
          success: false,
          error: error.message
        });
        
        // Clean up on error
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }

    console.log(`✅ SAM 2 batch processing completed - ${results.filter(r => r.success).length}/${results.length} successful`);

    res.json({
      success: true,
      results: results,
      totalProcessed: results.length,
      successCount: results.filter(r => r.success).length,
      model: 'sam2'
    });

  } catch (error) {
    console.error('🚨 Error in SAM 2 batch processing:', error);
    
    // Clean up any remaining files
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('🚨 SAM2 Server Error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /health',
      'POST /api/sam2/segment-points',
      'POST /api/sam2/segment-box', 
      'POST /api/sam2/auto-segment',
      'POST /api/sam2/batch-segment'
    ]
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🎯 SAM 2 Server running on port ${PORT}`);
  console.log(`🎯 Health check: http://localhost:${PORT}/health`);
  console.log(`🎯 Uploads directory: ${uploadsDir}`);
  
  // Log environment configuration
  console.log('🎯 SAM 2 Configuration:');
  console.log(`   - API URL: ${process.env.SAM2_API_URL || 'Not configured'}`);
  console.log(`   - API Key: ${process.env.SAM2_API_KEY ? 'Configured' : 'Not configured'}`);
  console.log(`   - Port: ${PORT}`);
});

export default app; 