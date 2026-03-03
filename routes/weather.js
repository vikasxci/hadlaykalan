const express = require('express');
const router = express.Router();

// Weather proxy - using free OpenMeteo API (no key needed)
router.get('/', async (req, res) => {
  try {
    // Hadlay Kalan approximate coordinates (Haryana region)
    const lat = req.query.lat || 29.0;
    const lon = req.query.lon || 76.5;
    
    // Return coordinates for frontend to use with OpenMeteo
    res.json({
      lat, lon,
      apiUrl: `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia/Kolkata&forecast_days=7`
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
