const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Your perfect working scripts!
app.post('/scrape/bikes', (req, res) => {
  console.log('🚀 Starting bikes scraper...');
  
  exec('node smart-bikes-scraper.js', (error, stdout, stderr) => {
    if (error) {
      console.error('Error:', error);
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    if (stderr) {
      console.error('Stderr:', stderr);
    }
    
    console.log('Bikes scraper completed!');
    res.json({ 
      success: true, 
      message: 'Bikes scraping completed successfully',
      output: stdout
    });
  });
});

app.post('/scrape/cars', (req, res) => {
  console.log('🚗 Starting cars scraper...');
  
  exec('node smart-cars-scraper.js', (error, stdout, stderr) => {
    if (error) {
      console.error('Error:', error);
      return res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
    
    if (stderr) {
      console.error('Stderr:', stderr);
    }
    
    console.log('Cars scraper completed!');
    res.json({ 
      success: true, 
      message: 'Cars scraping completed successfully', 
      output: stdout
    });
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Scraper server is running!' });
});

app.listen(PORT, () => {
  console.log(`🚀 Scraper server running on port ${PORT}`);
  console.log(`📁 Working directory: ${process.cwd()}`);
});
