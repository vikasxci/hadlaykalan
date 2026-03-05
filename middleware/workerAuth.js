const jwt = require('jsonwebtoken');
const WorkerUser = require('../models/WorkerUser');

// Middleware to authenticate worker users (public users using phone login)
module.exports = async function(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'लॉगिन आवश्यक है। कृपया पहले लॉगिन करें।' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'hadlay-kalan-secret-key');
    const user = await WorkerUser.findById(decoded.userId);
    if (!user || user.token !== token) {
      return res.status(401).json({ message: 'सत्र समाप्त हो गया है। कृपया फिर से लॉगिन करें।' });
    }
    req.workerUser = user;
    next();
  } catch (err) {
    res.status(401).json({ message: 'अमान्य टोकन। कृपया फिर से लॉगिन करें।' });
  }
};
