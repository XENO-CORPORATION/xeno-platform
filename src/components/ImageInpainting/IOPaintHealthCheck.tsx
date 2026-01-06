import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { CheckCircle, XCircle, AlertCircle, Loader2, Server, Cpu, HardDrive } from 'lucide-react';
import { iopaintService, IOPaintServerInfo } from '../../services/iopaintService';

interface TestResult {
  name: string;
  status: 'pending' | 'success' | 'error' | 'warning';
  message: string;
  details?: string;
}

const IOPaintHealthCheck: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [serverInfo, setServerInfo] = useState<IOPaintServerInfo | null>(null);
  const [tests, setTests] = useState<TestResult[]>([
    { name: 'Server Connection', status: 'pending', message: 'Not tested' },
    { name: 'API Health Check', status: 'pending', message: 'Not tested' },
    { name: 'Models Available', status: 'pending', message: 'Not tested' },
    { name: 'Device Detection', status: 'pending', message: 'Not tested' },
    { name: 'Processing Test', status: 'pending', message: 'Not tested' }
  ]);

  const runHealthCheck = async () => {
    setIsRunning(true);
    const newTests: TestResult[] = [...tests];

    try {
      // Test 1: Server Connection
      updateTest(newTests, 0, 'pending', 'Testing connection...');
      setTests([...newTests]);

      const serverInfo = await iopaintService.getServerInfo();
      
      if (serverInfo.isOnline) {
        updateTest(newTests, 0, 'success', 'Server is online');
        setServerInfo(serverInfo);
      } else {
        updateTest(newTests, 0, 'error', 'Server is offline', 'Make sure IOPaint server is running on port 8080');
        setTests([...newTests]);
        setIsRunning(false);
        return;
      }

      // Test 2: API Health Check
      updateTest(newTests, 1, 'pending', 'Checking API health...');
      setTests([...newTests]);

      const healthOk = await iopaintService.healthCheck();
      if (healthOk) {
        updateTest(newTests, 1, 'success', 'API is responding');
      } else {
        updateTest(newTests, 1, 'error', 'API health check failed');
      }

      // Test 3: Models Available
      updateTest(newTests, 2, 'pending', 'Checking available models...');
      setTests([...newTests]);

      try {
        const models = await iopaintService.getModels();
        if (models.length > 0) {
          updateTest(newTests, 2, 'success', `${models.length} models available`, 
            models.map(m => m.displayName).join(', '));
        } else {
          updateTest(newTests, 2, 'warning', 'No models found', 'Server may still be downloading models');
        }
      } catch (error) {
        updateTest(newTests, 2, 'warning', 'Could not fetch models list', 'Using default models');
      }

      // Test 4: Device Detection
      updateTest(newTests, 3, 'pending', 'Detecting compute device...');
      setTests([...newTests]);

      if (serverInfo.deviceInfo) {
        const device = serverInfo.deviceInfo;
        const deviceMessage = device.gpuAvailable ? 
          `GPU: ${device.gpuName || 'CUDA device'}` : 
          'CPU only';
        
        updateTest(newTests, 3, device.gpuAvailable ? 'success' : 'warning', 
          deviceMessage, 
          device.gpuAvailable ? 'GPU acceleration available' : 'Consider using GPU for better performance');
      } else {
        updateTest(newTests, 3, 'warning', 'Device info not available');
      }

      // Test 5: Processing Test (create a small test image)
      updateTest(newTests, 4, 'pending', 'Testing image processing...');
      setTests([...newTests]);

      try {
        // Create a small test image
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ff0000';
          ctx.fillRect(0, 0, 100, 100);
          
          canvas.toBlob(async (blob) => {
            if (blob) {
              const testFile = new File([blob], 'test.png', { type: 'image/png' });
              
              try {
                const result = await iopaintService.inpaint({
                  image: testFile,
                  model: 'lama'
                });
                
                if (result.processedImage) {
                  updateTest(newTests, 4, 'success', 
                    `Processing successful (${result.metadata.processingTime}ms)`,
                    `Model: ${result.metadata.model}`);
                } else {
                  updateTest(newTests, 4, 'error', 'Processing failed - no result');
                }
              } catch (error) {
                updateTest(newTests, 4, 'error', 'Processing test failed', 
                  error instanceof Error ? error.message : 'Unknown error');
              }
              setTests([...newTests]);
            }
          }, 'image/png');
        }
      } catch (error) {
        updateTest(newTests, 4, 'error', 'Could not create test image');
        setTests([...newTests]);
      }

    } catch (error) {
      updateTest(newTests, 0, 'error', 'Connection failed', 
        error instanceof Error ? error.message : 'Unknown error');
      setTests([...newTests]);
    }

    setIsRunning(false);
  };

  const updateTest = (tests: TestResult[], index: number, status: TestResult['status'], message: string, details?: string) => {
    tests[index] = { ...tests[index], status, message, details };
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />;
      case 'pending':
        return <div className="w-5 h-5 rounded-full border-2 border-gray-300" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: TestResult['status']) => {
    switch (status) {
      case 'success':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      case 'warning':
        return 'text-yellow-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-6 h-6" />
            IOPaint Health Check
          </CardTitle>
          <p className="text-sm text-gray-600">
            Verify that IOPaint server is running and properly configured
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          
          {/* Run Test Button */}
          <div className="flex items-center gap-4">
            <Button
              onClick={runHealthCheck}
              disabled={isRunning}
              className="flex items-center gap-2"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Running Tests...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Run Health Check
                </>
              )}
            </Button>
            
            {serverInfo && (
              <div className="text-sm text-gray-600">
                Server URL: {process.env.REACT_APP_IOPAINT_SERVER_URL || 'http://localhost:8080'}
              </div>
            )}
          </div>

          {/* Server Info */}
          {serverInfo && serverInfo.isOnline && (
            <div className="grid md:grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-blue-500" />
                <div>
                  <div className="font-medium">Server Status</div>
                  <div className="text-sm text-green-600">Online</div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-purple-500" />
                <div>
                  <div className="font-medium">Compute Device</div>
                  <div className="text-sm text-gray-600">
                    {serverInfo.deviceInfo?.gpuAvailable ? 'GPU' : 'CPU'}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-orange-500" />
                <div>
                  <div className="font-medium">Models</div>
                  <div className="text-sm text-gray-600">
                    {serverInfo.models.length} available
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Test Results */}
          <div className="space-y-3">
            <h3 className="font-medium text-lg">Test Results</h3>
            
            {tests.map((test, index) => (
              <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
                <div className="mt-1">
                  {getStatusIcon(test.status)}
                </div>
                
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{test.name}</span>
                    {isRunning && test.status === 'pending' && (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    )}
                  </div>
                  
                  <div className={`text-sm ${getStatusColor(test.status)}`}>
                    {test.message}
                  </div>
                  
                  {test.details && (
                    <div className="text-xs text-gray-500 mt-1">
                      {test.details}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Troubleshooting */}
          {tests.some(t => t.status === 'error') && !isRunning && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <h4 className="font-medium text-red-800 mb-2">Troubleshooting</h4>
              <div className="text-sm text-red-700 space-y-1">
                <p>• Make sure IOPaint server is running: <code>./start-iopaint.sh</code></p>
                <p>• Check if port 8080 is available: <code>netstat -an | grep 8080</code></p>
                <p>• Verify server URL in environment: <code>REACT_APP_IOPAINT_SERVER_URL</code></p>
                <p>• Check server logs for errors</p>
              </div>
            </div>
          )}

          {/* Success Message */}
          {tests.every(t => t.status === 'success') && !isRunning && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2 text-green-800">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">All tests passed!</span>
              </div>
              <p className="text-sm text-green-700 mt-1">
                IOPaint integration is working correctly. You can now use the Image Inpainting Studio.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default IOPaintHealthCheck;
