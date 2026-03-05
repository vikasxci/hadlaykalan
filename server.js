require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const cloudinary = require('cloudinary').v2;

const app = express();

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Middleware
// CORS configuration for deployment
const corsOptions = {
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Note: Frontend is deployed separately, no static files served from backend

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sliders', require('./routes/sliders'));
app.use('/api/notices', require('./routes/notices'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/farmer', require('./routes/farmer'));
app.use('/api/weather', require('./routes/weather'));
app.use('/api/village-info', require('./routes/villageInfo'));
app.use('/api/contest', require('./routes/contest'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/visitors', require('./routes/visitors'));

// Health check endpoint for deployment monitoring
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Hadlay Kalan API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint - API information
app.get('/', (req, res) => {
  res.json({ 
    message: 'Hadlay Kalan API Server',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      notices: '/api/notices',
      contacts: '/api/contacts',
      farmer: '/api/farmer',
      weather: '/api/weather',
      sliders: '/api/sliders',
      villageInfo: '/api/village-info',
      contest: '/api/contest',
      posts: '/api/posts',
      settings: '/api/settings'
    },
    note: 'Frontend is deployed separately'
  });
});

// Connect to MongoDB and start server
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('MongoDB Connected');
    // Seed admin user
    const Admin = require('./models/Admin');
    const existing = await Admin.findOne({ email: process.env.ADMIN_EMAIL });
    if (!existing) {
      await Admin.create({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
        name: 'Admin'
      });
      console.log('Default admin created');
    }
    app.listen(process.env.PORT || 5000, () => {
      console.log(`Server running on port ${process.env.PORT || 5000}`);
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
