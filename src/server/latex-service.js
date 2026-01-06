const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3001;

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/compile') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { latex } = JSON.parse(body);
        
        if (!latex) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No LaTeX code provided' }));
          return;
        }

        // Create temp directory
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-'));
        const texFile = path.join(tempDir, 'document.tex');
        const pdfFile = path.join(tempDir, 'document.pdf');

        // Write LaTeX file
        fs.writeFileSync(texFile, latex, 'utf8');

        // Compile with pdflatex (run twice for references)
        const compileCmd = `cd "${tempDir}" && pdflatex -interaction=nonstopmode -halt-on-error document.tex && pdflatex -interaction=nonstopmode -halt-on-error document.tex`;

        exec(compileCmd, { timeout: 60000 }, (error, stdout, stderr) => {
          if (error) {
            // Parse LaTeX errors
            const logFile = path.join(tempDir, 'document.log');
            let errorMsg = 'LaTeX compilation failed';
            
            if (fs.existsSync(logFile)) {
              const log = fs.readFileSync(logFile, 'utf8');
              const errorMatch = log.match(/!(.*?)(?=\n\n|\nl\.\d)/gs);
              if (errorMatch) {
                errorMsg = errorMatch.slice(0, 5).join('\n').substring(0, 2000);
              }
            }

            // Cleanup
            fs.rmSync(tempDir, { recursive: true, force: true });

            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: errorMsg,
              stdout: stdout?.substring(0, 1000),
              stderr: stderr?.substring(0, 1000)
            }));
            return;
          }

          // Check if PDF was created
          if (!fs.existsSync(pdfFile)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'PDF file was not generated' }));
            return;
          }

          // Read PDF and send as base64
          const pdfBuffer = fs.readFileSync(pdfFile);
          const pdfBase64 = pdfBuffer.toString('base64');

          // Cleanup
          fs.rmSync(tempDir, { recursive: true, force: true });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            pdf: pdfBase64,
            success: true 
          }));
        });

      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'latex-compiler' }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`LaTeX compilation service running on port ${PORT}`);
});
